import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.dirname(path.dirname(TEST_DIRECTORY));
const HOOK = path.join(REPOSITORY, "plugins", "qt-stack-lsp", "hooks", "qt-check.mjs");
const STUBS = path.join(TEST_DIRECTORY, "fixtures", "stubs");

function projectWorkspace(t) {
  const project = mkdtempSync(path.join(os.tmpdir(), "qt-stack-check-"));
  t.after(() => rmSync(project, { force: true, recursive: true }));
  mkdirSync(path.join(project, ".git"));
  mkdirSync(path.join(project, "forms"));
  mkdirSync(path.join(project, "qml"));
  mkdirSync(path.join(project, "resources"));
  writeFileSync(path.join(project, "forms", "main.ui"), "<ui/>\n");
  writeFileSync(path.join(project, "qml", "Good.qml"), "Item {}\n");
  writeFileSync(path.join(project, "qml", "Imp.qml"), "import My.Missing.Module\n");
  writeFileSync(path.join(project, "qml", "Main.QML"), "Item {}\n");
  writeFileSync(path.join(project, "qml", "Syntax.qml"), "Item {\n");
  writeFileSync(path.join(project, "resources", "app.qrc"), "<RCC/>\n");
  writeFileSync(path.join(project, "notes.txt"), "not Qt input\n");
  return project;
}

function payload(project, filePath) {
  return {
    cwd: project,
    hook_event_name: "PostToolUse",
    tool_input: { file_path: filePath },
    tool_name: "Edit",
  };
}

function runHook(input, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const name of [
      "QT_STACK_CHECK",
      "QT_STACK_CHECK_TIMEOUT_MS",
      "QT_STACK_TOOL_OVERRIDE_DIR",
      "STUB_LOG",
      "STUB_MODE",
    ]) {
      delete env[name];
    }
    Object.assign(env, { QT_STACK_TOOL_OVERRIDE_DIR: STUBS }, extraEnv);

    const startedAt = Date.now();
    const child = spawn(process.execPath, [HOOK], {
      cwd: REPOSITORY,
      env,
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
    child.on("close", (code, signal) => {
      try {
        assert.equal(code, 0, `hook exited with ${code}; stderr: ${stderr}`);
        assert.equal(signal, null);
        assert.equal(stderr, "");
        resolve({ durationMs: Date.now() - startedAt, stdout });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

test("a successful uic check is silent", async (t) => {
  const project = projectWorkspace(t);
  const { stdout } = await runHook(payload(project, path.join("forms", "main.ui")), {
    STUB_MODE: "ok",
  });
  assert.equal(stdout, "");
});

test("uic failures block with a relative path and stderr lines", async (t) => {
  const project = projectWorkspace(t);
  const { stdout } = await runHook(payload(project, path.join("forms", "main.ui")), {
    STUB_MODE: "fail",
  });

  assert.deepEqual(JSON.parse(stdout), {
    decision: "block",
    reason: [
      "uic (qt-stack-lsp) on forms/main.ui: exit 1",
      "first UI error",
      "second UI error",
    ].join("\n"),
  });
  assert.equal(stdout.includes(String.fromCodePoint(0x2014)), false);
});

test("rcc runs in the resource directory and its temporary output is removed", async (t) => {
  const project = projectWorkspace(t);
  const logPath = path.join(project, "rcc-log.json");
  const qrc = path.join(project, "resources", "app.qrc");
  const { stdout } = await runHook(payload(project, qrc), {
    STUB_LOG: logPath,
    STUB_MODE: "fail",
  });
  const log = JSON.parse(readFileSync(logPath, "utf8"));
  const outputIndex = log.argv.indexOf("-o");

  assert.equal(JSON.parse(stdout).reason.split("\n")[0], "rcc (qt-stack-lsp) on resources/app.qrc: exit 1");
  assert.equal(log.cwd, path.dirname(qrc));
  assert.equal(log.argv[0], qrc);
  assert.ok(outputIndex >= 0);
  assert.equal(existsSync(log.argv[outputIndex + 1]), false);
});

test("qmllint warnings add condensed context and use the file directory", async (t) => {
  const project = projectWorkspace(t);
  const logPath = path.join(project, "qmllint-log.json");
  const qml = path.join(project, "qml", "Main.QML");
  const { stdout } = await runHook(payload(project, qml), {
    STUB_LOG: logPath,
    STUB_MODE: "warnings",
  });
  const log = JSON.parse(readFileSync(logPath, "utf8"));
  const result = JSON.parse(stdout);
  const context = result.hookSpecificOutput.additionalContext;

  assert.deepEqual(result, {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: [
        "qmllint (qt-stack-lsp) on qml/Main.QML: 2 warnings",
        'Warning: qml/Main.QML:5:5: Could not find property "radiuss". [missing-property]',
        'Info: Did you mean "radius"?',
        'Warning: qml/Main.QML:7:5: Could not find property "opacty". [missing-property]',
        'Info: Did you mean "opacity"?',
      ].join("\n"),
    },
  });
  assert.equal(log.cwd, path.dirname(qml));
  assert.deepEqual(log.argv, [qml]);
  assert.equal(log.argv.includes("-o"), false);
  assert.equal(context.includes("Suggested change:"), false);
  assert.equal(context.split("\n").includes("radiuss: 4"), false);
  assert.equal(context.split("\n").some((line) => /^\^+$/.test(line)), false);
});

test("a qmllint syntax failure blocks with its numeric exit code", async (t) => {
  const project = projectWorkspace(t);
  const { stdout } = await runHook(payload(project, "qml/Syntax.qml"), {
    STUB_MODE: "syntax",
  });

  assert.deepEqual(JSON.parse(stdout), {
    decision: "block",
    reason: [
      "qmllint (qt-stack-lsp) on qml/Syntax.qml: exit 255",
      "Warning: qml/Syntax.qml:6:1: Expected token `}' [syntax]",
    ].join("\n"),
  });
});

test("a clean qmllint check is silent", async (t) => {
  const project = projectWorkspace(t);
  const { stdout } = await runHook(payload(project, "qml/Good.qml"), {
    STUB_MODE: "clean",
  });

  assert.equal(stdout, "");
});

test("qmllint import warnings retain both warning lines", async (t) => {
  const project = projectWorkspace(t);
  const { stdout } = await runHook(payload(project, "qml/Imp.qml"), {
    STUB_MODE: "import",
  });

  assert.deepEqual(JSON.parse(stdout), {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: [
        "qmllint (qt-stack-lsp) on qml/Imp.qml: 2 warnings",
        'Warning: qml/Imp.qml:1:1: Warnings occurred while importing module "My.Missing.Module": [import]',
        "Warning: 1:1: Failed to import My.Missing.Module. Are your import paths set up properly? [import]",
      ].join("\n"),
    },
  });
  assert.equal(stdout.includes("---"), false);
});

test("a timed-out qmllint check is silent and ends promptly", async (t) => {
  const project = projectWorkspace(t);
  const { durationMs, stdout } = await runHook(payload(project, "qml/Main.QML"), {
    QT_STACK_CHECK_TIMEOUT_MS: "500",
    STUB_MODE: "sleep",
  });

  assert.equal(stdout, "");
  assert.ok(durationMs < 3_000, `timed-out hook took ${durationMs} ms`);
});

test("a timed-out tool is silent and ends promptly", async (t) => {
  const project = projectWorkspace(t);
  const { durationMs, stdout } = await runHook(payload(project, "forms/main.ui"), {
    QT_STACK_CHECK_TIMEOUT_MS: "500",
    STUB_MODE: "sleep",
  });

  assert.equal(stdout, "");
  assert.ok(durationMs < 3_000, `timed-out hook took ${durationMs} ms`);
});

test("the QT_STACK_CHECK kill switch skips the tool", async (t) => {
  const project = projectWorkspace(t);
  const logPath = path.join(project, "disabled-log.json");
  const { stdout } = await runHook(payload(project, "forms/main.ui"), {
    QT_STACK_CHECK: "OFF",
    STUB_LOG: logPath,
    STUB_MODE: "fail",
  });

  assert.equal(stdout, "");
  assert.equal(existsSync(logPath), false);
});

test("other extensions never invoke a Qt tool", async (t) => {
  const project = projectWorkspace(t);
  const logPath = path.join(project, "other-log.json");
  const { stdout } = await runHook(payload(project, "notes.txt"), {
    STUB_LOG: logPath,
    STUB_MODE: "fail",
  });

  assert.equal(stdout, "");
  assert.equal(existsSync(logPath), false);
});

test("a nonexistent input file is silent", async (t) => {
  const project = projectWorkspace(t);
  const logPath = path.join(project, "missing-log.json");
  const { stdout } = await runHook(payload(project, "forms/missing.ui"), {
    STUB_LOG: logPath,
    STUB_MODE: "fail",
  });

  assert.equal(stdout, "");
  assert.equal(existsSync(logPath), false);
});

test("invalid stdin is silent", async () => {
  const { stdout } = await runHook("{not-json");
  assert.equal(stdout, "");
});
