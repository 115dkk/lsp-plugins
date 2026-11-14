import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.dirname(path.dirname(TEST_DIRECTORY));
const HOOK = path.join(REPOSITORY, "plugins", "web-js-stack-lsp", "hooks", "eslint-after-edit.mjs");
const FIXTURES = path.join(TEST_DIRECTORY, "fixtures");
const PROJECT = path.join(FIXTURES, "proj");
const NO_ESLINT_PROJECT = path.join(FIXTURES, "no-eslint");
const APP = path.join(PROJECT, "src", "App.tsx");
const SVELTE_COMPONENT = path.join(PROJECT, "src", "Comp.svelte");

function payload(filePath = APP, cwd = PROJECT) {
  return {
    session_id: "fixture-session",
    cwd,
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
    tool_response: {},
  };
}

function runHook(input, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.STUB_ESLINT_LOG;
    delete env.STUB_ESLINT_MODE;
    delete env.WEB_JS_STACK_ESLINT;
    delete env.WEB_JS_STACK_ESLINT_TIMEOUT_MS;
    Object.assign(env, extraEnv);

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
        resolve({ durationMs: Date.now() - startedAt, stderr, stdout });
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

function fixtureLog(name) {
  const logPath = path.join(FIXTURES, `${name}.json`);
  rmSync(logPath, { force: true });
  return logPath;
}

test("errors block with sorted, formatted findings", async () => {
  const { stdout } = await runHook(payload(), { STUB_ESLINT_MODE: "errors" });

  assert.deepEqual(JSON.parse(stdout), {
    decision: "block",
    reason: [
      "ESLint (web-js-stack-lsp) on src/App.tsx: 1 error, 1 warning",
      "src/App.tsx:3:5 error react-hooks/rules-of-hooks Hooks must be called at the top level.",
      "src/App.tsx:1:8 warning react-refresh/only-export-components Fast refresh only works when a file only exports components.",
    ].join("\n"),
  });
});

test("warnings add PostToolUse context", async () => {
  const { stdout } = await runHook(payload(), { STUB_ESLINT_MODE: "warnings" });

  assert.deepEqual(JSON.parse(stdout), {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: [
        "ESLint (web-js-stack-lsp) on src/App.tsx: 0 errors, 2 warnings",
        "src/App.tsx:2:1 warning react-hooks/exhaustive-deps A dependency is missing.",
        "src/App.tsx:8:2 warning svelte/no-at-html-tags Avoid @html.",
      ].join("\n"),
    },
  });
});

for (const mode of ["ignored", "fatal", "crash", "garbage"]) {
  test(`${mode} output is silent`, async () => {
    const { stdout } = await runHook(payload(), { STUB_ESLINT_MODE: mode });
    assert.equal(stdout, "");
  });
}

test("a timed-out ESLint run is silent and ends promptly", async () => {
  const { durationMs, stdout } = await runHook(payload(), {
    STUB_ESLINT_MODE: "sleep",
    WEB_JS_STACK_ESLINT_TIMEOUT_MS: "500",
  });

  assert.equal(stdout, "");
  assert.ok(durationMs < 3_000, `timed-out hook took ${durationMs} ms`);
});

test("findings are capped at 30 message lines", async () => {
  const { stdout } = await runHook(payload(), { STUB_ESLINT_MODE: "many" });
  const output = JSON.parse(stdout);
  const lines = output.reason.split("\n");

  assert.equal(output.decision, "block");
  assert.equal(lines.length, 32);
  assert.equal(lines[0], "ESLint (web-js-stack-lsp) on src/App.tsx: 35 errors, 0 warnings");
  for (let line = 1; line <= 30; line += 1) {
    assert.equal(lines[line], `src/App.tsx:${line}:1 error test/many Finding ${line}`);
  }
  assert.equal(lines.at(-1), "... and 5 more");
});

test("newlines in a message collapse to spaces", async () => {
  const { stdout } = await runHook(payload(), { STUB_ESLINT_MODE: "multiline" });
  const output = JSON.parse(stdout);

  assert.equal(
    output.reason,
    [
      "ESLint (web-js-stack-lsp) on src/App.tsx: 1 error, 0 warnings",
      "src/App.tsx:4:3 error test/multiline First line second line third line",
    ].join("\n"),
  );
});

test("unsupported extensions do not invoke ESLint", async (t) => {
  const logPath = fixtureLog("css-not-called");
  t.after(() => rmSync(logPath, { force: true }));

  const { stdout } = await runHook(payload(path.join(PROJECT, "src", "style.css")), {
    STUB_ESLINT_LOG: logPath,
    STUB_ESLINT_MODE: "errors",
  });

  assert.equal(stdout, "");
  assert.equal(existsSync(logPath), false);
});

test("node_modules and dist paths do not invoke ESLint", async (t) => {
  const logPath = fixtureLog("excluded-not-called");
  t.after(() => rmSync(logPath, { force: true }));

  for (const filePath of [
    path.join(PROJECT, "node_modules", "pkg", "index.js"),
    path.join(PROJECT, "dist", "out.js"),
  ]) {
    const { stdout } = await runHook(payload(filePath), {
      STUB_ESLINT_LOG: logPath,
      STUB_ESLINT_MODE: "errors",
    });
    assert.equal(stdout, "");
  }

  assert.equal(existsSync(logPath), false);
});

test("the WEB_JS_STACK_ESLINT kill switch skips ESLint", async (t) => {
  const logPath = fixtureLog("disabled-not-called");
  t.after(() => rmSync(logPath, { force: true }));

  const { stdout } = await runHook(payload(), {
    STUB_ESLINT_LOG: logPath,
    STUB_ESLINT_MODE: "errors",
    WEB_JS_STACK_ESLINT: "0",
  });

  assert.equal(stdout, "");
  assert.equal(existsSync(logPath), false);
});

test("relative paths resolve against cwd and ESLint receives exact arguments", async (t) => {
  const logPath = fixtureLog("relative-invocation");
  t.after(() => rmSync(logPath, { force: true }));

  const { stdout } = await runHook(payload(path.join("src", "App.tsx")), {
    STUB_ESLINT_LOG: logPath,
    STUB_ESLINT_MODE: "warnings",
  });
  const log = JSON.parse(readFileSync(logPath, "utf8"));

  assert.notEqual(stdout, "");
  assert.deepEqual(log.argv, ["--format", "json", APP]);
  assert.equal(log.argv.includes("--no-warn-ignored"), false);
  assert.equal(log.cwd, PROJECT);
});

test("invalid JSON input exits silently", async () => {
  const { stdout } = await runHook("{not-json");
  assert.equal(stdout, "");
});

test("input without tool_input.file_path exits silently", async () => {
  const { stdout } = await runHook({ cwd: PROJECT, tool_input: {} });
  assert.equal(stdout, "");
});

test("a nonexistent edited file exits silently", async () => {
  const { stdout } = await runHook(payload(path.join(PROJECT, "src", "missing.ts")));
  assert.equal(stdout, "");
});

test("a project without local ESLint exits silently", async () => {
  const { stdout } = await runHook(
    payload(path.join(NO_ESLINT_PROJECT, "src", "a.ts"), NO_ESLINT_PROJECT),
  );
  assert.equal(stdout, "");
});

test("Svelte files invoke the project ESLint", async (t) => {
  const logPath = fixtureLog("svelte-invocation");
  t.after(() => rmSync(logPath, { force: true }));

  const { stdout } = await runHook(payload(SVELTE_COMPONENT), {
    STUB_ESLINT_LOG: logPath,
    STUB_ESLINT_MODE: "warnings",
  });
  const log = JSON.parse(readFileSync(logPath, "utf8"));

  assert.notEqual(stdout, "");
  assert.deepEqual(log.argv, ["--format", "json", SVELTE_COMPONENT]);
  assert.equal(log.cwd, PROJECT);
});
