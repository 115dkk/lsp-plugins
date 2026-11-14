#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { findQtTool } from "./find-qt-bin.mjs";

const NOT_FOUND_MESSAGE =
  "qt-stack-lsp: qmlls not found. Set QT_STACK_QT_BIN to your Qt bin directory or put qmlls on PATH.\n";

function launch() {
  const override = process.env.QT_STACK_QMLLS_OVERRIDE;
  const qmlls = override ? path.resolve(override) : findQtTool("qmlls", { startDir: process.cwd() });
  if (!qmlls) {
    process.stderr.write(NOT_FOUND_MESSAGE);
    process.exitCode = 1;
    return;
  }

  const command = override ? process.execPath : qmlls;
  const args = override
    ? [qmlls, ...process.argv.slice(2)]
    : process.argv.slice(2);

  let finished = false;
  let child;
  try {
    child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {
    process.exitCode = 1;
    return;
  }

  const forwardSignal = (signal) => {
    if (!finished) {
      try {
        child.kill(signal);
      } catch {
        // The child may have exited between the signal and this handler.
      }
    }
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  child.once("error", () => {
    if (!finished) {
      finished = true;
      process.exitCode = 1;
    }
  });
  child.once("close", (code, signal) => {
    finished = true;
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

try {
  launch();
} catch {
  process.exitCode = 1;
}
