#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_GIT_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_SIBLING_BYTES = 1024 * 1024;
const MAX_SIBLING_READ_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 5_000;

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

function isDisabled(value) {
  return typeof value === "string" && ["0", "false", "off"].includes(value.toLowerCase());
}

function findProjectRoot(startDirectory) {
  let directory = path.resolve(startDirectory);
  while (true) {
    if (existsSync(path.join(directory, ".git"))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return path.resolve(startDirectory);
    }
    directory = parent;
  }
}

function runGit(args, cwd, maxBuffer = MAX_GIT_BUFFER_BYTES) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: null,
        maxBuffer,
        shell: false,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stderr, stdout });
          return;
        }
        if (
          typeof error.code === "number" &&
          !error.killed &&
          !error.signal
        ) {
          const exitCode = error.code > 0x7fffffff ? error.code - 0x100000000 : error.code;
          resolve({ exitCode, stderr, stdout });
          return;
        }
        resolve(null);
      },
    );
  });
}

function countLineEndings(text) {
  let crlf = 0;
  let bareLf = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") {
      continue;
    }
    if (index > 0 && text[index - 1] === "\r") {
      crlf += 1;
    } else {
      bareLf += 1;
    }
  }
  return { bareLf, crlf };
}

function classifyLineEndings(buffer) {
  const { bareLf, crlf } = countLineEndings(buffer.toString("latin1"));
  if (crlf > 0 && bareLf === 0) {
    return "crlf";
  }
  if (bareLf > 0 && crlf === 0) {
    return "lf";
  }
  return null;
}

function parseAttributeOutput(output) {
  const attributes = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/: (text|eol): (.+)$/i);
    if (match) {
      attributes.set(match[1].toLowerCase(), match[2].trim().toLowerCase());
    }
  }
  return attributes;
}

function parseConfigOutput(output) {
  const config = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(core\.(?:autocrlf|eol))\s+(.+)$/i);
    if (match) {
      config.set(match[1].toLowerCase(), match[2].trim().toLowerCase());
    }
  }
  return config;
}

function nearestExistingDirectory(filePath) {
  let directory = path.dirname(filePath);
  while (true) {
    try {
      if (statSync(directory).isDirectory()) {
        return directory;
      }
    } catch {
      // Write can create missing parent directories, so keep walking upward.
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

async function lineEndingTarget(filePath) {
  const cwd = nearestExistingDirectory(filePath);
  if (cwd === null) {
    return null;
  }
  const relativePath = path.relative(cwd, filePath).replaceAll("\\", "/");
  const tracked = await runGit(["ls-files", "--eol", "--", relativePath], cwd);
  if (!tracked || tracked.exitCode !== 0) {
    return null;
  }

  const trackedOutput = tracked.stdout.toString("utf8");
  if (trackedOutput.trim() !== "") {
    const firstLine = trackedOutput.split(/\r?\n/, 1)[0];
    const tabIndex = firstLine.indexOf("\t");
    const metadata = tabIndex === -1 ? firstLine : firstLine.slice(0, tabIndex);
    const attributeIndex = metadata.indexOf("attr/");
    const attributes = attributeIndex === -1 ? "" : metadata.slice(attributeIndex + 5);
    if (/\bi\/-text(?:\s|$)/.test(metadata) || /(?:^|\s)-text(?:\s|$)/.test(attributes)) {
      return "skip";
    }
    if (/(?:^|\s)eol=crlf(?:\s|$)/i.test(attributes)) {
      return "crlf";
    }
    if (/(?:^|\s)eol=lf(?:\s|$)/i.test(attributes)) {
      return "lf";
    }

    const filtered = await runGit(
      ["cat-file", "--filters", `:./${relativePath}`],
      cwd,
      MAX_GIT_BUFFER_BYTES,
    );
    if (!filtered || filtered.exitCode !== 0) {
      return null;
    }
    return classifyLineEndings(filtered.stdout);
  }

  const [attributeResult, configResult] = await Promise.all([
    runGit(["check-attr", "text", "eol", "--", relativePath], cwd),
    runGit(["config", "--get-regexp", "^core\\.(autocrlf|eol)$"], cwd),
  ]);
  if (!attributeResult || attributeResult.exitCode !== 0 || !configResult) {
    return null;
  }
  if (configResult.exitCode !== 0 && configResult.exitCode !== 1) {
    return null;
  }

  const attributes = parseAttributeOutput(attributeResult.stdout.toString("utf8"));
  const config = parseConfigOutput(configResult.stdout.toString("utf8"));
  const textAttribute = attributes.get("text");
  const eolAttribute = attributes.get("eol");
  const autoCrlf = config.get("core.autocrlf");
  const coreEol = config.get("core.eol");

  if (textAttribute === "unset") {
    return "skip";
  }
  if (eolAttribute === "crlf" || eolAttribute === "lf") {
    return eolAttribute;
  }
  if (autoCrlf === "true") {
    return "crlf";
  }
  if (autoCrlf === "input") {
    return "lf";
  }
  if (textAttribute === "set" || textAttribute === "auto") {
    if (coreEol === "crlf" || coreEol === "lf") {
      return coreEol;
    }
    if (coreEol === undefined || coreEol === "native") {
      return process.platform === "win32" ? "crlf" : "lf";
    }
  }
  return null;
}

function normalizedText(text, target) {
  const lf = text.replaceAll("\r\n", "\n");
  return target === "crlf" ? lf.replaceAll("\n", "\r\n") : lf;
}

function lineEndingTargetFromContents(text) {
  const { bareLf, crlf } = countLineEndings(text);
  if (crlf > 0 && bareLf === 0) {
    return "crlf";
  }
  if (bareLf > 0 && crlf === 0) {
    return "lf";
  }
  if (bareLf === crlf) {
    return null;
  }
  return crlf > bareLf ? "crlf" : "lf";
}

function existingFileLineEndingTarget(filePath) {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
      return null;
    }
    const buffer = readFileSync(filePath);
    if (buffer.subarray(0, 8_000).includes(0)) {
      return null;
    }
    return lineEndingTargetFromContents(buffer.toString("latin1"));
  } catch {
    return null;
  }
}

function changedLineNumbers(structuredPatch) {
  if (!Array.isArray(structuredPatch)) {
    return null;
  }
  const changed = new Set();
  for (const hunk of structuredPatch) {
    if (!Number.isInteger(hunk?.newStart) || !Array.isArray(hunk.lines)) {
      return null;
    }
    let lineNumber = hunk.newStart;
    for (const patchLine of hunk.lines) {
      if (typeof patchLine !== "string" || patchLine.length === 0) {
        return null;
      }
      if (patchLine[0] === "+") {
        changed.add(lineNumber);
        lineNumber += 1;
      } else if (patchLine[0] === " ") {
        lineNumber += 1;
      } else if (patchLine[0] !== "-" && patchLine[0] !== "\\") {
        return null;
      }
    }
  }
  return changed;
}

function insertedLines(payload) {
  const toolName = payload?.tool_name;
  if (toolName === "Edit") {
    return typeof payload?.tool_input?.new_string === "string"
      ? payload.tool_input.new_string.split(/\r?\n/)
      : [];
  }
  if (toolName === "MultiEdit" && Array.isArray(payload?.tool_input?.edits)) {
    return payload.tool_input.edits.flatMap((edit) =>
      typeof edit?.new_string === "string" ? edit.new_string.split(/\r?\n/) : [],
    );
  }
  return [];
}

function classifyIndentation(lines) {
  let tabLines = 0;
  let spaceLines = 0;
  for (const line of lines) {
    if (!/\S/.test(line)) {
      continue;
    }
    if (line.startsWith("\t")) {
      tabLines += 1;
    } else if (/^ {2}/.test(line)) {
      spaceLines += 1;
    }
  }
  const total = tabLines + spaceLines;
  if (total < 5) {
    return null;
  }
  if (tabLines / total >= 0.9) {
    return { evidence: tabLines, style: "tab", total };
  }
  if (spaceLines / total >= 0.9) {
    return { evidence: spaceLines, style: "space", total };
  }
  return null;
}

function linesWithoutInsertedText(lines, inserted) {
  const remaining = new Map();
  for (const line of inserted) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  return lines.filter((line) => {
    const count = remaining.get(line) ?? 0;
    if (count === 0) {
      return true;
    }
    remaining.set(line, count - 1);
    return false;
  });
}

function siblingBaseline(filePath) {
  const extension = path.extname(filePath);
  if (extension === "") {
    return null;
  }
  const directory = path.dirname(filePath);
  const currentName = path.basename(filePath).toLowerCase();
  const lines = [];
  let fileCount = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (fileCount >= 8) {
      break;
    }
    if (!entry.isFile() || entry.name.toLowerCase() === currentName) {
      continue;
    }
    if (path.extname(entry.name).toLowerCase() !== extension.toLowerCase()) {
      continue;
    }
    const siblingPath = path.join(directory, entry.name);
    try {
      const stats = statSync(siblingPath);
      if (!stats.isFile() || stats.size > MAX_SIBLING_BYTES) {
        continue;
      }
      const buffer = readFileSync(siblingPath).subarray(0, MAX_SIBLING_READ_BYTES);
      if (buffer.subarray(0, 8_000).includes(0)) {
        continue;
      }
      lines.push(...buffer.toString("latin1").split(/\r?\n/));
      fileCount += 1;
    } catch {
      // An unreadable neighbor is not evidence about this file's indentation.
    }
  }
  return fileCount === 0 ? null : { extension, fileCount, lines };
}

function indentationContext(payload, filePath, currentLines) {
  const toolName = payload?.tool_name;
  const response = payload?.tool_response;
  const isWriteCreate =
    toolName === "Write" && (response?.type === "create" || response?.originalFile == null);

  if (isWriteCreate) {
    const siblings = siblingBaseline(filePath);
    if (!siblings) {
      return null;
    }
    const files = siblings.fileCount === 1 ? "file" : "files";
    return {
      baseline: siblings.lines,
      changedLines: currentLines,
      changedNumbers: currentLines.map((_, index) => index + 1),
      evidenceLocation: `in those ${siblings.fileCount} ${files}`,
      fallback: false,
      subject: `The other ${siblings.extension} ${files} in this folder ${siblings.fileCount === 1 ? "indents" : "indent"}`,
    };
  }

  const numbers = changedLineNumbers(response?.structuredPatch);
  if (toolName === "Write") {
    if (typeof response?.originalFile !== "string" || numbers === null) {
      return null;
    }
    return {
      baseline: response.originalFile.split(/\r?\n/),
      changedLines: [...numbers].map((number) => currentLines[number - 1] ?? ""),
      changedNumbers: [...numbers],
      evidenceLocation: "in the previous version of the file",
      fallback: false,
    };
  }

  if (toolName !== "Edit" && toolName !== "MultiEdit") {
    return null;
  }
  if (numbers !== null) {
    return {
      baseline: currentLines.filter((_, index) => !numbers.has(index + 1)),
      changedLines: [...numbers].map((number) => currentLines[number - 1] ?? ""),
      changedNumbers: [...numbers],
      evidenceLocation: "elsewhere in the file",
      fallback: false,
    };
  }

  const inserted = insertedLines(payload);
  if (inserted.length === 0) {
    return null;
  }
  return {
    baseline: linesWithoutInsertedText(currentLines, inserted),
    changedLines: inserted,
    changedNumbers: null,
    evidenceLocation: "elsewhere in the file",
    fallback: true,
  };
}

function violatesStyle(line, style) {
  if (!/\S/.test(line)) {
    return false;
  }
  if (style === "tab") {
    return /^ {2}/.test(line);
  }
  return /^[ \t]*\t/.test(line);
}

function compressRanges(numbers) {
  const sorted = [...new Set(numbers)].sort((left, right) => left - right);
  const ranges = [];
  for (const number of sorted) {
    const previous = ranges.at(-1);
    if (previous && number === previous.end + 1) {
      previous.end = number;
    } else {
      ranges.push({ end: number, start: number });
    }
  }
  const shown = ranges.slice(0, 20).map(({ start, end }) =>
    start === end ? `${start}` : `${start}-${end}`,
  );
  if (ranges.length > 20) {
    shown.push(`and ${ranges.length - 20} more`);
  }
  return shown.join(", ");
}

function formatReason(filePath, context, style, violations) {
  const projectRoot = findProjectRoot(path.dirname(filePath));
  const relativePath = path.relative(projectRoot, filePath).replaceAll("\\", "/");
  const styleName = style.style === "tab" ? "tabs" : "spaces";
  const evidenceEnding = style.style === "tab" ? "start with a tab" : "start with spaces";
  const count = violations.length;
  let finding;
  if (context.fallback) {
    const wrong = style.style === "tab" ? "start with spaces" : "contain tabs";
    finding = `but ${count} line${count === 1 ? "" : "s"} in the text you just inserted ${count === 1 ? wrong.replace("start", "starts").replace("contain", "contains") : wrong}.`;
  } else {
    const wrong = style.style === "tab" ? "start with spaces" : "contain tabs";
    const numbers = violations.map((violation) => violation.number);
    finding = `but ${count} line${count === 1 ? "" : "s"} you just wrote ${count === 1 ? wrong.replace("start", "starts").replace("contain", "contains") : wrong}: ${compressRanges(numbers)}.`;
  }
  const action =
    style.style === "tab"
      ? "Re-indent those lines with tabs, one tab per indent level. If the spaces are intentional (inside a string literal or preformatted text), leave them."
      : "Re-indent those lines with spaces like the surrounding lines. If the tabs are intentional, leave them.";
  return [
    `whitespace-guard: ${relativePath}`,
    `${context.subject ?? "This file indents"} with ${styleName}: ${style.evidence} of ${style.total} indented lines ${context.evidenceLocation} ${evidenceEnding}, ${finding}`,
    action,
  ].join("\n");
}

async function setWriteLineEndings(payload) {
  if (isDisabled(process.env.WHITESPACE_GUARD_EOL) || payload?.tool_name !== "Write") {
    return;
  }
  const inputPath = payload?.tool_input?.file_path;
  const content = payload?.tool_input?.content;
  if (
    typeof inputPath !== "string" ||
    typeof content !== "string" ||
    content.length > MAX_FILE_BYTES ||
    content.includes("\0")
  ) {
    return;
  }

  const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
  const filePath = path.resolve(cwd, inputPath);
  const target = await lineEndingTarget(filePath);
  if (target === "skip") {
    return;
  }
  const effectiveTarget = target ?? existingFileLineEndingTarget(filePath);
  if (effectiveTarget === null) {
    return;
  }
  const updated = normalizedText(content, effectiveTarget);
  if (updated === content) {
    return;
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...payload.tool_input, content: updated },
      },
    }),
  );
}

function reportIndentation(payload) {
  if (isDisabled(process.env.WHITESPACE_GUARD_INDENT)) {
    return;
  }
  const inputPath = payload?.tool_input?.file_path;
  if (typeof inputPath !== "string") {
    return;
  }
  const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
  const filePath = path.resolve(cwd, inputPath);
  const stats = statSync(filePath);
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
    return;
  }

  const buffer = readFileSync(filePath);
  if (buffer.subarray(0, 8_000).includes(0)) {
    return;
  }
  const currentLines = buffer.toString("latin1").split(/\r?\n/);
  const context = indentationContext(payload, filePath, currentLines);
  if (!context) {
    return;
  }
  const style = classifyIndentation(context.baseline);
  if (!style) {
    return;
  }
  const violations = [];
  for (let index = 0; index < context.changedLines.length; index += 1) {
    if (violatesStyle(context.changedLines[index], style.style)) {
      violations.push({
        line: context.changedLines[index],
        number: context.changedNumbers?.[index] ?? null,
      });
    }
  }
  if (violations.length === 0) {
    return;
  }

  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: formatReason(filePath, context, style, violations),
    }),
  );
}

async function main() {
  try {
    if (isDisabled(process.env.WHITESPACE_GUARD)) {
      return;
    }

    const payload = JSON.parse(await readStdin());
    if (payload?.hook_event_name === "PreToolUse") {
      await setWriteLineEndings(payload);
    } else if (payload?.hook_event_name === "PostToolUse") {
      reportIndentation(payload);
    }
  } catch {
    // Hooks stay silent when input, git, or the filesystem is unusable.
  }
}

void main().catch(() => {});
