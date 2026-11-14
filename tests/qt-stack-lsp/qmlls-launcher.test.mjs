import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.dirname(path.dirname(TEST_DIRECTORY));
const LAUNCHER = path.join(
  REPOSITORY,
  "plugins",
  "qt-stack-lsp",
  "scripts",
  "qmlls-launcher.mjs",
);
const CHILD_STUB = path.join(TEST_DIRECTORY, "fixtures", "stubs", "qmlls-child.js");

function runLauncher(t, { args = [], env = {}, input = "", override = true } = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "qt-stack-launcher-"));
  t.after(() => rmSync(cwd, { force: true, recursive: true }));

  return new Promise((resolve, reject) => {
    const childEnv = {
      ...process.env,
      HOME: cwd,
      PATH: "",
      USERPROFILE: cwd,
      ...env,
    };
    delete childEnv.QTDIR;
    delete childEnv.QT_ROOT_DIR;
    delete childEnv.QT_STACK_QT_BIN;
    delete childEnv.QT_STACK_QMLLS_OVERRIDE;
    if (override) {
      childEnv.QT_STACK_QMLLS_OVERRIDE = CHILD_STUB;
    }

    const child = spawn(process.execPath, [LAUNCHER, ...args], {
      cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stderr, stdout }));
    child.stdin.end(input);
  });
}

test("the override child inherits stdin and stdout and receives extra arguments", async (t) => {
  const result = await runLauncher(t, {
    args: ["--write-defaults", "value"],
    input: "LSP payload\n",
  });

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, 'argv:["--write-defaults","value"]\nLSP payload\n');
});

test("the launcher propagates the child exit code", async (t) => {
  const result = await runLauncher(t, {
    env: { STUB_EXIT_CODE: "7" },
  });

  assert.equal(result.code, 7);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
});

test("a missing qmlls reports one stderr line and leaves stdout empty", async (t) => {
  const result = await runLauncher(t, { override: false });

  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "qt-stack-lsp: qmlls not found. Set QT_STACK_QT_BIN to your Qt bin directory or put qmlls on PATH.\n",
  );
});
