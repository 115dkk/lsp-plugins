#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { findQtTool } from "../scripts/find-qt-bin.mjs";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const SUPPORTED_TOOLS = new Map([
  [".ui", "uic"],
  [".qrc", "rcc"],
  [".qml", "qmllint"],
]);

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

function timeoutFrom(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  const timeout = Number(value);
  return Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2_147_483_647
    ? timeout
    : DEFAULT_TIMEOUT_MS;
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

function runTool(tool, executable, filePath, temporaryPath, timeout, overrideScript) {
  const command = overrideScript ? process.execPath : executable;
  const toolArgs =
    tool === "qmllint" ? [filePath] : [filePath, "-o", temporaryPath];
  const args = overrideScript ? [overrideScript, ...toolArgs] : toolArgs;
  const options = {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    shell: false,
    timeout,
    windowsHide: true,
  };
  if (tool === "rcc" || tool === "qmllint") {
    options.cwd = path.dirname(filePath);
  }

  return new Promise((resolve) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (!error) {
        resolve({ exitCode: 0, stderr, stdout });
        return;
      }
      if (
        typeof error.code === "number" &&
        error.code !== 0 &&
        !error.killed &&
        !error.signal
      ) {
        // Windows reports a native exit code of -1 as 4294967295.
        const exitCode = error.code > 0x7fffffff ? error.code - 0x100000000 : error.code;
        resolve({ exitCode, stderr, stdout });
        return;
      }
      resolve(null);
    });
  });
}

function outputLines(stderr, stdout, temporaryPath) {
  const pathVariants = [temporaryPath, temporaryPath.replaceAll("\\", "/")];
  return `${stderr ?? ""}\n${stdout ?? ""}`
    .split(/\r?\n/)
    .map((line) => {
      let result = line.trim();
      for (const variant of pathVariants) {
        result = result.replaceAll(variant, "<temp>");
      }
      return result;
    })
    .filter(Boolean);
}

function formatFailure(tool, filePath, exitCode, stderr, stdout, temporaryPath) {
  const projectRoot = findProjectRoot(path.dirname(filePath));
  const relativePath = path.relative(projectRoot, filePath).replaceAll("\\", "/");
  const details = outputLines(stderr, stdout, temporaryPath);
  const lines = [
    `${tool} (qt-stack-lsp) on ${relativePath}: exit ${exitCode}`,
    ...details.slice(0, 30),
  ];
  if (details.length > 30) {
    lines.push(`... and ${details.length - 30} more`);
  }
  return lines.join("\n");
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceFilePath(line, filePath, relativePath) {
  const flags = process.platform === "win32" ? "gi" : "g";
  const variants = new Set([filePath, filePath.replaceAll("\\", "/")]);
  let result = line;
  for (const variant of variants) {
    result = result.replace(new RegExp(escapeRegularExpression(variant), flags), relativePath);
  }
  return result;
}

function formatQmlResult(filePath, exitCode, stderr, stdout) {
  const projectRoot = findProjectRoot(path.dirname(filePath));
  const relativePath = path.relative(projectRoot, filePath).replaceAll("\\", "/");
  const details = `${stderr ?? ""}\n${stdout ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:Warning|Critical|Error|Info):/.test(line))
    .map((line) => replaceFilePath(line, filePath, relativePath));
  const warningCount = details.filter((line) =>
    /^(?:Warning|Critical|Error):/.test(line),
  ).length;
  const header =
    exitCode !== 0
      ? `qmllint (qt-stack-lsp) on ${relativePath}: exit ${exitCode}`
      : `qmllint (qt-stack-lsp) on ${relativePath}: ${warningCount} warning${warningCount === 1 ? "" : "s"}`;
  const lines = [header, ...details.slice(0, 30)];
  if (details.length > 30) {
    lines.push(`... and ${details.length - 30} more`);
  }
  return { message: lines.join("\n"), warningCount };
}

async function main() {
  try {
    if (isDisabled(process.env.QT_STACK_CHECK)) {
      return;
    }

    const payload = JSON.parse(await readStdin());
    const inputPath = payload?.tool_input?.file_path;
    if (typeof inputPath !== "string") {
      return;
    }

    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    const filePath = path.resolve(cwd, inputPath);
    const tool = SUPPORTED_TOOLS.get(path.extname(filePath).toLowerCase());
    if (!tool || !existsSync(filePath)) {
      return;
    }

    const overrideDirectory = process.env.QT_STACK_TOOL_OVERRIDE_DIR;
    const overrideScript = overrideDirectory
      ? path.resolve(overrideDirectory, `${tool}.js`)
      : null;
    const executable = overrideScript
      ? process.execPath
      : findQtTool(tool, { startDir: path.dirname(filePath) });
    if (!executable) {
      return;
    }

    const suffix = tool === "uic" ? ".h" : ".cpp";
    const temporaryPath =
      tool === "qmllint"
        ? null
        : path.join(
            os.tmpdir(),
            `qt-stack-lsp-${tool}-${process.pid}-${randomUUID()}${suffix}`,
          );
    let run;
    try {
      run = await runTool(
        tool,
        executable,
        filePath,
        temporaryPath,
        timeoutFrom(process.env.QT_STACK_CHECK_TIMEOUT_MS),
        overrideScript,
      );
    } finally {
      if (temporaryPath) {
        try {
          rmSync(temporaryPath, { force: true });
        } catch {
          // Cleanup failure must not turn into an edit finding.
        }
      }
    }

    if (!run) {
      return;
    }

    if (tool === "qmllint") {
      const result = formatQmlResult(
        filePath,
        run.exitCode,
        run.stderr,
        run.stdout,
      );
      if (run.exitCode !== 0) {
        process.stdout.write(
          JSON.stringify({ decision: "block", reason: result.message }),
        );
      } else if (result.warningCount > 0) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: result.message,
            },
          }),
        );
      }
      return;
    }

    if (run.exitCode === 0) {
      return;
    }

    process.stdout.write(
      JSON.stringify({
        decision: "block",
        reason: formatFailure(
          tool,
          filePath,
          run.exitCode,
          run.stderr,
          run.stdout,
          temporaryPath,
        ),
      }),
    );
  } catch {
    // Hooks stay silent when input or infrastructure is unusable.
  }
}

void main().catch(() => {});
