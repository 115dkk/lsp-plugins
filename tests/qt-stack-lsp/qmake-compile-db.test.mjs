import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.dirname(path.dirname(TEST_DIRECTORY));
const CLI = path.join(
  REPOSITORY,
  "plugins",
  "qt-stack-lsp",
  "skills",
  "qmake-compile-db",
  "qmake-compile-db.mjs",
);
const FIXTURE_TREE = path.join(TEST_DIRECTORY, "fixtures", "qmake-tree");

function temporaryDirectory(t, prefix = "qt-stack-qmake-") {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function copyFixture(t) {
  const temporary = temporaryDirectory(t);
  const root = path.join(temporary, "project");
  cpSync(FIXTURE_TREE, root, { recursive: true });

  const now = Date.now() / 1000;
  const oldDirectory = path.join(root, "build-editor-old");
  const newDirectory = path.join(root, "build-editor-new");
  utimesSync(path.join(oldDirectory, "Makefile.Release"), now - 200, now - 200);
  utimesSync(path.join(newDirectory, "Makefile.Release"), now, now);
  utimesSync(path.join(newDirectory, "Makefile.Debug"), now + 50, now + 50);
  utimesSync(oldDirectory, now - 200, now - 200);
  utimesSync(newDirectory, now, now);
  return root;
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPOSITORY,
      stdio: ["ignore", "pipe", "pipe"],
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
  });
}

test("the CLI writes expanded entries from the selected qmake Makefiles", async (t) => {
  const root = copyFixture(t);
  const output = path.join(root, "clangd", "compile_commands.json");
  mkdirSync(path.dirname(output));
  const result = await runCli(["--root", root, "--output", output]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(output), true);
  const raw = readFileSync(output, "utf8");
  assert.equal(raw.endsWith("\n"), true);
  const entries = JSON.parse(raw);
  assert.equal(entries.length, 5);

  const editorMain = entries.find((entry) => entry.file.endsWith(path.join("Editor", "main.cpp")));
  assert.ok(editorMain);
  assert.equal(editorMain.directory, path.normalize(path.join(root, "build-editor-new")));
  assert.equal(editorMain.file, path.normalize(path.join(root, "Editor", "main.cpp")));
  assert.ok(editorMain.command.startsWith("cl "));
  assert.ok(editorMain.command.includes(String.raw`-DEAPO_UPDATE_CHANNEL=\"x64-avx2\"`));
  assert.ok(editorMain.command.includes("-DNDEBUG"));
  assert.ok(editorMain.command.includes(String.raw`-c ..\Editor\main.cpp`));
  assert.equal(editorMain.command.includes("OLD_BUILD"), false);
  assert.equal(editorMain.command.includes("DEBUG_BUILD"), false);

  const spaced = entries.find((entry) => entry.file.endsWith(path.join("Editor", "Source With Space.cpp")));
  assert.ok(spaced);
  assert.ok(spaced.command.endsWith(String.raw`-c "..\Editor\Source With Space.cpp"`));

  const cEntry = entries.find((entry) => entry.file.endsWith(path.join("Helper", "helper.c")));
  assert.ok(cEntry);
  assert.ok(cEntry.command.startsWith("clang -Wall -DHELPER "));
  assert.equal(cEntry.command.startsWith("clang++"), false);

  const unixEntry = entries.find((entry) => entry.file.endsWith(path.join("Unix", "main.cpp")));
  assert.ok(unixEntry);
  assert.ok(unixEntry.command.startsWith("g++ -std=c++20 -DUNIX_TOOL "));

  assert.match(result.stdout, /Makefile\.Release \(2 entries\)/);
  assert.match(result.stdout, /Total entries: 5/);
  assert.match(result.stdout, new RegExp(`Output: ${output.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("the newer build directory wins while Release wins within that directory", async (t) => {
  const root = copyFixture(t);
  const output = path.join(root, "compile_commands.json");
  const result = await runCli(["--root", root, "--output", output]);
  const entries = JSON.parse(readFileSync(output, "utf8"));
  const editorEntries = entries.filter((entry) => entry.file.includes(`${path.sep}Editor${path.sep}`));

  assert.equal(result.code, 0);
  assert.equal(editorEntries.length, 2);
  for (const entry of editorEntries) {
    assert.equal(entry.directory, path.normalize(path.join(root, "build-editor-new")));
    assert.ok(entry.command.startsWith("cl "));
  }
  assert.equal(result.stdout.includes(path.join("build-editor-old", "Makefile.Release")), false);
  assert.equal(result.stdout.includes(path.join("build-editor-new", "Makefile.Debug")), false);
  assert.equal(result.stdout.includes(path.join("build-editor-new", "Makefile.Release")), true);
});

test("a root without qmake Makefiles exits 1 with guidance", async (t) => {
  const root = temporaryDirectory(t, "qt-stack-empty-");
  const result = await runCli(["--root", root]);

  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    `No qmake-generated Makefile with SOURCES found under ${path.resolve(root)}. Run qmake for the project first.\n`,
  );
});

test("dry-run prints a summary without writing the output", async (t) => {
  const root = copyFixture(t);
  const output = path.join(root, "would-be-created.json");
  const result = await runCli(["--root", root, "--output", output, "--dry-run"]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(output), false);
  assert.match(result.stdout, /Total entries: 5/);
  assert.match(result.stdout, /\(dry run\)\n$/);
});
