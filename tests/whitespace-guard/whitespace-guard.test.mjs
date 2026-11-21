import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.dirname(path.dirname(TEST_DIRECTORY));
const HOOK = path.join(
  REPOSITORY,
  "plugins",
  "whitespace-guard",
  "hooks",
  "whitespace-guard.mjs",
);

function temporaryDirectory(t, prefix = "whitespace-guard-") {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    input: options.input,
    shell: false,
    windowsHide: true,
  });
  assert.equal(
    result.status,
    options.status ?? 0,
    `git ${args.join(" ")} exited ${result.status}: ${result.stderr}`,
  );
  return result;
}

function repository(t, { autocrlf = "false", eol } = {}) {
  const directory = temporaryDirectory(t);
  git(directory, ["init"]);
  git(directory, ["config", "core.autocrlf", autocrlf]);
  if (eol !== undefined) {
    git(directory, ["config", "core.eol", eol]);
  }
  return directory;
}

function commitAll(directory) {
  git(directory, ["add", "-A"]);
  git(directory, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  ]);
}

function runHook(input, extraEnv = {}) {
  const env = { ...process.env };
  for (const name of [
    "WHITESPACE_GUARD",
    "WHITESPACE_GUARD_EOL",
    "WHITESPACE_GUARD_INDENT",
  ]) {
    delete env[name];
  }
  Object.assign(env, extraEnv);
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: REPOSITORY,
    encoding: "utf8",
    env,
    input: typeof input === "string" ? input : JSON.stringify(input),
    shell: false,
    timeout: 20_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  assert.equal(result.stderr, "");
  return result.stdout;
}

function writeUpdate(directory, filename, originalFile, structuredPatch = []) {
  return {
    cwd: directory,
    hook_event_name: "PostToolUse",
    tool_input: { content: readFileSync(path.join(directory, filename), "utf8"), file_path: filename },
    tool_name: "Write",
    tool_response: {
      content: readFileSync(path.join(directory, filename), "utf8"),
      filePath: path.join(directory, filename),
      originalFile,
      structuredPatch,
      type: "update",
      userModified: false,
    },
    tool_use_id: "toolu_test",
  };
}

function editPayload(directory, filename, structuredPatch, newString = "") {
  return {
    cwd: directory,
    hook_event_name: "PostToolUse",
    tool_input: {
      file_path: filename,
      new_string: newString,
      old_string: "old",
      replace_all: false,
    },
    tool_name: "Edit",
    tool_response: {
      filePath: path.join(directory, filename),
      newString,
      oldString: "old",
      originalFile: "old\n",
      structuredPatch,
      userModified: false,
    },
    tool_use_id: "toolu_test",
  };
}

function createPayload(directory, filename) {
  return {
    cwd: directory,
    hook_event_name: "PostToolUse",
    tool_input: { content: readFileSync(path.join(directory, filename), "utf8"), file_path: filename },
    tool_name: "Write",
    tool_response: {
      content: readFileSync(path.join(directory, filename), "utf8"),
      filePath: path.join(directory, filename),
      originalFile: null,
      structuredPatch: [],
      type: "create",
      userModified: false,
    },
    tool_use_id: "toolu_test",
  };
}

test("autocrlf=true restores CRLF after a Write update", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filename = "tracked.txt";
  const filePath = path.join(directory, filename);
  writeFileSync(filePath, "one\ntwo\n");
  commitAll(directory);
  writeFileSync(filePath, "one\ntwo changed\n");

  const stdout = runHook(writeUpdate(directory, filename, "one\ntwo\n"));

  assert.equal(stdout, "");
  assert.deepEqual(readFileSync(filePath), Buffer.from("one\r\ntwo changed\r\n"));
});

test("a tracked CRLF index blob selects CRLF when autocrlf=false", (t) => {
  const directory = repository(t);
  const filename = "tracked.txt";
  const filePath = path.join(directory, filename);
  writeFileSync(filePath, "one\r\ntwo\r\n");
  commitAll(directory);
  writeFileSync(filePath, "one\ntwo changed\n");

  const stdout = runHook(writeUpdate(directory, filename, "one\ntwo\n"));

  assert.equal(stdout, "");
  assert.deepEqual(readFileSync(filePath), Buffer.from("one\r\ntwo changed\r\n"));
});

test("a tracked LF file is not rewritten", (t) => {
  const directory = repository(t);
  const filename = "tracked.txt";
  const filePath = path.join(directory, filename);
  writeFileSync(filePath, "one\ntwo\n");
  commitAll(directory);
  const oldTime = new Date("2001-02-03T04:05:06Z");
  utimesSync(filePath, oldTime, oldTime);
  const before = statSync(filePath).mtimeMs;
  const bytes = readFileSync(filePath);

  const stdout = runHook(writeUpdate(directory, filename, "one\ntwo\n"));

  assert.equal(stdout, "");
  assert.deepEqual(readFileSync(filePath), bytes);
  assert.equal(statSync(filePath).mtimeMs, before);
});

test("an eol=lf attribute overrides autocrlf=true", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  writeFileSync(path.join(directory, ".gitattributes"), "*.sh text eol=lf\n");
  const filename = "script.sh";
  const filePath = path.join(directory, filename);
  writeFileSync(filePath, "#!/bin/sh\nprintf ok\n");
  commitAll(directory);
  writeFileSync(filePath, "#!/bin/sh\r\nprintf changed\r\n");

  const stdout = runHook(writeUpdate(directory, filename, "#!/bin/sh\nprintf ok\n"));

  assert.equal(stdout, "");
  assert.deepEqual(readFileSync(filePath), Buffer.from("#!/bin/sh\nprintf changed\n"));
});

test("a tracked -text file skips line endings and indentation", (t) => {
  const directory = repository(t);
  writeFileSync(path.join(directory, ".gitattributes"), "*.dat -text\n");
  const filename = "opaque.dat";
  const filePath = path.join(directory, filename);
  writeFileSync(filePath, "root\n\tone\n\ttwo\n\tthree\n\tfour\n\tfive\n");
  commitAll(directory);
  const bytes = Buffer.from("root\r\n\tone\r\n\ttwo\r\n\tthree\r\n\tfour\r\n\tfive\n    bad\n");
  writeFileSync(filePath, bytes);
  const patch = [{ lines: ["+    bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];

  const stdout = runHook(editPayload(directory, filename, patch, "    bad"));

  assert.equal(stdout, "");
  assert.deepEqual(readFileSync(filePath), bytes);
});

test("untracked files follow autocrlf=true and stay untouched with no rule", (t) => {
  const crlfDirectory = repository(t, { autocrlf: "true" });
  const crlfPath = path.join(crlfDirectory, "new.txt");
  writeFileSync(crlfPath, "one\ntwo\n");
  assert.equal(runHook(createPayload(crlfDirectory, "new.txt")), "");
  assert.deepEqual(readFileSync(crlfPath), Buffer.from("one\r\ntwo\r\n"));

  const noRuleDirectory = repository(t);
  const noRulePath = path.join(noRuleDirectory, "new.txt");
  writeFileSync(noRulePath, "one\ntwo\n");
  const before = readFileSync(noRulePath);
  assert.equal(runHook(createPayload(noRuleDirectory, "new.txt")), "");
  assert.deepEqual(readFileSync(noRulePath), before);
});

test("untracked text=auto files follow core.eol", (t) => {
  for (const eol of ["lf", "crlf"]) {
    const directory = repository(t, { eol });
    writeFileSync(path.join(directory, ".gitattributes"), "* text=auto\n");
    const filePath = path.join(directory, `${eol}.txt`);
    writeFileSync(filePath, "one\r\ntwo\n");

    assert.equal(runHook(createPayload(directory, `${eol}.txt`)), "");
    const expected = eol === "lf" ? "one\ntwo\n" : "one\r\ntwo\r\n";
    assert.deepEqual(readFileSync(filePath), Buffer.from(expected));
  }
});

test("outside git, mixed endings use their majority and uniform LF stays unchanged", (t) => {
  const directory = temporaryDirectory(t, "whitespace-guard-outside-");
  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: directory,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (probe.status === 0) {
    t.skip("the operating-system temporary directory is inside a git worktree");
    return;
  }

  const mixedPath = path.join(directory, "mixed.txt");
  writeFileSync(mixedPath, "one\r\ntwo\r\nthree\r\nfour\n");
  assert.equal(runHook(createPayload(directory, "mixed.txt")), "");
  assert.deepEqual(readFileSync(mixedPath), Buffer.from("one\r\ntwo\r\nthree\r\nfour\r\n"));

  const lfPath = path.join(directory, "lf.txt");
  writeFileSync(lfPath, "one\ntwo\n");
  const before = readFileSync(lfPath);
  assert.equal(runHook(createPayload(directory, "lf.txt")), "");
  assert.deepEqual(readFileSync(lfPath), before);
});

test("normalization preserves lone CR, final-newline state and non-ASCII bytes", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filePath = path.join(directory, "bytes.txt");
  const bytes = Buffer.concat([
    Buffer.from("caf", "ascii"),
    Buffer.from([0xc3, 0xa9]),
    Buffer.from("\rlone\r\nlast\nno-final", "latin1"),
  ]);
  writeFileSync(filePath, bytes);

  assert.equal(runHook(createPayload(directory, "bytes.txt")), "");
  const expected = Buffer.concat([
    Buffer.from("caf", "ascii"),
    Buffer.from([0xc3, 0xa9]),
    Buffer.from("\rlone\r\nlast\r\nno-final", "latin1"),
  ]);
  assert.deepEqual(readFileSync(filePath), expected);
});

test("a NUL byte skips all processing", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filePath = path.join(directory, "binary.bin");
  const bytes = Buffer.from("one\n\0two\n", "latin1");
  writeFileSync(filePath, bytes);

  assert.equal(runHook(createPayload(directory, "binary.bin")), "");
  assert.deepEqual(readFileSync(filePath), bytes);
});

test("two Edit hunks report the actual changed line in a tab file", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "tab.cpp";
  writeFileSync(
    path.join(directory, filename),
    ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", "\tsix", "middle", "    bad", "end", ""].join("\n"),
  );
  const patch = [
    { lines: ["-  old", "+  one", "   context"], newLines: 2, newStart: 2, oldLines: 2, oldStart: 2 },
    { lines: ["+    bad"], newLines: 1, newStart: 9, oldLines: 0, oldStart: 9 },
  ];

  const result = JSON.parse(runHook(editPayload(directory, filename, patch, "\tone\n    bad")));

  assert.equal(result.decision, "block");
  assert.match(result.reason, /tabs/);
  assert.match(result.reason, /: 9\./);
  assert.doesNotMatch(result.reason, /: 2/);
});

test("tab-style exceptions for comment continuation and alignment are allowed", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "tab.cpp";
  writeFileSync(
    path.join(directory, filename),
    ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", " * comment", "\t\t  aligned", ""].join("\n"),
  );
  const patch = [
    { lines: ["+ * comment", "+      aligned"], newLines: 2, newStart: 7, oldLines: 0, oldStart: 7 },
  ];

  assert.equal(runHook(editPayload(directory, filename, patch, " * comment\n\t\t  aligned")), "");
});

test("a tab in a changed line violates a space-style file", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "space.cpp";
  writeFileSync(
    path.join(directory, filename),
    ["root", "    one", "    two", "    three", "    four", "    five", "\tbad", ""].join("\n"),
  );
  const patch = [{ lines: ["+  bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];

  const result = JSON.parse(runHook(editPayload(directory, filename, patch, "\tbad")));

  assert.equal(result.decision, "block");
  assert.match(result.reason, /indents with spaces/);
  assert.match(result.reason, /: 7\./);
});

test("ambiguous and undersized indentation samples do not report", (t) => {
  const directory = temporaryDirectory(t);
  const ambiguous = "ambiguous.cpp";
  writeFileSync(
    path.join(directory, ambiguous),
    [
      "root",
      "\tt1", "\tt2", "\tt3", "\tt4", "\tt5",
      "    s1", "    s2", "    s3", "    s4", "    s5",
      "    changed",
      "",
    ].join("\n"),
  );
  const ambiguousPatch = [{ lines: ["+    changed"], newLines: 1, newStart: 12, oldLines: 0, oldStart: 12 }];
  assert.equal(runHook(editPayload(directory, ambiguous, ambiguousPatch, "    changed")), "");

  const small = "small.cpp";
  writeFileSync(
    path.join(directory, small),
    ["root", "\tone", "\ttwo", "\tthree", "\tfour", "    changed", ""].join("\n"),
  );
  const smallPatch = [{ lines: ["+    changed"], newLines: 1, newStart: 6, oldLines: 0, oldStart: 6 }];
  assert.equal(runHook(editPayload(directory, small, smallPatch, "    changed")), "");
});

test("Write update uses originalFile as the indentation baseline", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "rewrite.cpp";
  const original = ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", ""].join("\n");
  writeFileSync(path.join(directory, filename), `${original}    bad\n`);
  const patch = [{ lines: ["+    bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];

  const result = JSON.parse(runHook(writeUpdate(directory, filename, original, patch)));

  assert.equal(result.decision, "block");
  assert.match(result.reason, /in the previous version of the file/);
  assert.match(result.reason, /tabs/);
});

test("Write create uses same-extension sibling files as its baseline", (t) => {
  const directory = temporaryDirectory(t);
  const sibling = ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", ""].join("\n");
  writeFileSync(path.join(directory, "one.cpp"), sibling);
  writeFileSync(path.join(directory, "two.CPP"), sibling);
  writeFileSync(path.join(directory, "new.cpp"), "root\n    one\n    two\n");

  const result = JSON.parse(runHook(createPayload(directory, "new.cpp")));

  assert.equal(result.decision, "block");
  assert.match(result.reason, /The other \.cpp files in this folder indent with tabs/);
  assert.match(result.reason, /in those 2 files start with a tab/);
  assert.match(result.reason, /2 lines you just wrote start with spaces: 2-3\./);

  const aloneDirectory = temporaryDirectory(t);
  writeFileSync(path.join(aloneDirectory, "alone.cpp"), "root\n    one\n    two\n");
  assert.equal(runHook(createPayload(aloneDirectory, "alone.cpp")), "");
});

test("Edit without structuredPatch reports inserted text without line numbers", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "fallback.cpp";
  writeFileSync(
    path.join(directory, filename),
    ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", "    bad", ""].join("\n"),
  );
  const payload = editPayload(directory, filename, undefined, "    bad");
  delete payload.tool_response.structuredPatch;

  const result = JSON.parse(runHook(payload));

  assert.equal(result.decision, "block");
  assert.match(result.reason, /in the text you just inserted/);
  assert.doesNotMatch(result.reason, /: 7\./);
});

test("WHITESPACE_GUARD disables both fixes", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filename = "switch.cpp";
  const filePath = path.join(directory, filename);
  const original = ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", ""].join("\n");
  writeFileSync(filePath, original);
  commitAll(directory);
  const current = `${original}    bad\n`;
  writeFileSync(filePath, current);
  const patch = [{ lines: ["+    bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];

  assert.equal(runHook(writeUpdate(directory, filename, original, patch), { WHITESPACE_GUARD: "OFF" }), "");
  assert.deepEqual(readFileSync(filePath), Buffer.from(current));
});

test("WHITESPACE_GUARD_EOL leaves endings alone but still reports", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filename = "switch.cpp";
  const filePath = path.join(directory, filename);
  const original = ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", ""].join("\n");
  writeFileSync(filePath, original);
  commitAll(directory);
  const current = `${original}    bad\n`;
  writeFileSync(filePath, current);
  const patch = [{ lines: ["+    bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];

  const result = JSON.parse(
    runHook(writeUpdate(directory, filename, original, patch), { WHITESPACE_GUARD_EOL: "false" }),
  );
  assert.equal(result.decision, "block");
  assert.deepEqual(readFileSync(filePath), Buffer.from(current));
});

test("WHITESPACE_GUARD_INDENT fixes endings without reporting", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filename = "switch.cpp";
  const filePath = path.join(directory, filename);
  const original = ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", ""].join("\n");
  writeFileSync(filePath, original);
  commitAll(directory);
  writeFileSync(filePath, `${original}    bad\n`);
  const patch = [{ lines: ["+    bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];

  const stdout = runHook(
    writeUpdate(directory, filename, original, patch),
    { WHITESPACE_GUARD_INDENT: "0" },
  );
  assert.equal(stdout, "");
  assert.equal(readFileSync(filePath, "latin1").includes("\r\n"), true);
});

test("malformed stdin and a missing file are silent", (t) => {
  assert.equal(runHook("{not-json"), "");
  const directory = temporaryDirectory(t);
  assert.equal(runHook(editPayload(directory, "missing.txt", [], "text")), "");
});

test("violation line numbers are compressed into ranges", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "ranges.cpp";
  writeFileSync(
    path.join(directory, filename),
    [
      "root",
      "\tone",
      "    bad3",
      "    bad4",
      "    bad5",
      "\ttwo",
      "\tthree",
      "\tfour",
      "    bad9",
      "\tfive",
      "\tsix",
      "",
    ].join("\n"),
  );
  const patch = [
    { lines: ["+    bad3", "+    bad4", "+    bad5"], newLines: 3, newStart: 3, oldLines: 0, oldStart: 3 },
    { lines: ["+    bad9"], newLines: 1, newStart: 9, oldLines: 0, oldStart: 9 },
  ];

  const result = JSON.parse(runHook(editPayload(directory, filename, patch, "    bad3\n    bad4\n    bad5\n    bad9")));

  assert.equal(result.decision, "block");
  assert.match(result.reason, /3-5, 9/);
});
