#!/usr/bin/env node

/**
 * Runs the edited project's local ESLint and reports real rule findings.
 * Set WEB_JS_STACK_ESLINT=0/false/off to disable it, or
 * WEB_JS_STACK_ESLINT_TIMEOUT_MS to change the 40-second timeout.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".svelte",
]);
const SKIPPED_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  ".svelte-kit",
  ".vite",
]);
const DEFAULT_TIMEOUT_MS = 40_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

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

function hasSkippedSegment(filePath) {
  return filePath
    .split(/[\\/]+/)
    .some((segment) => SKIPPED_SEGMENTS.has(segment.toLowerCase()));
}

function findLocalEslint(startDirectory) {
  let directory = startDirectory;

  while (true) {
    const eslintPath = path.join(directory, "node_modules", "eslint", "bin", "eslint.js");
    if (existsSync(eslintPath)) {
      return { projectDirectory: directory, eslintPath };
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

function getTimeoutMs(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return DEFAULT_TIMEOUT_MS;
  }

  const timeout = Number(value);
  return Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2_147_483_647
    ? timeout
    : DEFAULT_TIMEOUT_MS;
}

function runEslint(eslintPath, filePath, projectDirectory, timeout) {
  const args = [eslintPath, "--format", "json", filePath];

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      {
        cwd: projectDirectory,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER_BYTES,
        shell: false,
        timeout,
        windowsHide: true,
      },
      (error, stdout) => {
        if (!error) {
          resolve({ exitCode: 0, stdout });
          return;
        }

        if (error.code === 1 && !error.killed && !error.signal) {
          resolve({ exitCode: 1, stdout });
          return;
        }

        resolve(null);
      },
    );
  });
}

function normalizeMessage(message) {
  if (!message || message.ruleId == null || ![1, 2].includes(message.severity)) {
    return null;
  }

  return {
    column: Number.isFinite(message.column) ? message.column : 0,
    line: Number.isFinite(message.line) ? message.line : 0,
    message: String(message.message ?? "").replace(/\s*[\r\n]+\s*/g, " "),
    ruleId: String(message.ruleId),
    severity: message.severity,
  };
}

function collectMessages(results) {
  const messages = [];

  for (const result of results) {
    if (!result || !Array.isArray(result.messages)) {
      continue;
    }
    for (const message of result.messages) {
      const normalized = normalizeMessage(message);
      if (normalized) {
        messages.push(normalized);
      }
    }
  }

  return messages.sort(
    (left, right) =>
      right.severity - left.severity ||
      left.line - right.line ||
      left.column - right.column,
  );
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatFindings(relativePath, messages) {
  const errorCount = messages.filter((message) => message.severity === 2).length;
  const warningCount = messages.length - errorCount;
  const lines = [
    `ESLint (web-js-stack-lsp) on ${relativePath}: ${countLabel(errorCount, "error", "errors")}, ${countLabel(warningCount, "warning", "warnings")}`,
  ];

  for (const message of messages.slice(0, 30)) {
    const severity = message.severity === 2 ? "error" : "warning";
    lines.push(
      `${relativePath}:${message.line}:${message.column} ${severity} ${message.ruleId} ${message.message}`,
    );
  }

  if (messages.length > 30) {
    lines.push(`... and ${messages.length - 30} more`);
  }

  return { errorCount, text: lines.join("\n") };
}

async function main() {
  try {
    const payload = JSON.parse(await readStdin());
    const filePath = payload?.tool_input?.file_path;
    if (typeof filePath !== "string" || isDisabled(process.env.WEB_JS_STACK_ESLINT)) {
      return;
    }

    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    const absolutePath = path.resolve(cwd, filePath);
    if (
      !SUPPORTED_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()) ||
      !existsSync(absolutePath)
    ) {
      return;
    }

    const eslint = findLocalEslint(path.dirname(absolutePath));
    if (!eslint) {
      return;
    }

    // Only the part inside the project counts: a project that itself sits
    // under a folder named build or dist is still linted.
    const relativePath = path.relative(eslint.projectDirectory, absolutePath).replaceAll("\\", "/");
    if (hasSkippedSegment(relativePath)) {
      return;
    }

    const run = await runEslint(
      eslint.eslintPath,
      absolutePath,
      eslint.projectDirectory,
      getTimeoutMs(process.env.WEB_JS_STACK_ESLINT_TIMEOUT_MS),
    );
    if (!run || ![0, 1].includes(run.exitCode)) {
      return;
    }

    let results;
    try {
      results = JSON.parse(run.stdout);
    } catch {
      return;
    }
    if (!Array.isArray(results)) {
      return;
    }

    const messages = collectMessages(results);
    if (messages.length === 0) {
      return;
    }

    const findings = formatFindings(relativePath, messages);
    const output =
      findings.errorCount > 0
        ? { decision: "block", reason: findings.text }
        : {
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: findings.text,
            },
          };

    process.stdout.write(JSON.stringify(output));
  } catch {
    // Hooks must stay silent when an unexpected infrastructure failure occurs.
  }
}

void main().catch(() => {});
