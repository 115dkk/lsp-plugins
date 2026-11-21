import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

function targetSnapshot(payload) {
  const inputPath = payload?.tool_input?.file_path;
  if (typeof inputPath !== "string") {
    return null;
  }
  const cwd = typeof payload.cwd === "string" ? payload.cwd : REPOSITORY;
  const filePath = path.resolve(cwd, inputPath);
  if (!existsSync(filePath)) {
    return null;
  }
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    return null;
  }
  return { bytes: readFileSync(filePath), filePath, mtimeMs: stats.mtimeMs };
}

function runHook(payload, extraEnv = {}) {
  const snapshot = targetSnapshot(payload);
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
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    shell: false,
    timeout: 20_000,
    windowsHide: true,
  });

  if (snapshot !== null) {
    assert.deepEqual(readFileSync(snapshot.filePath), snapshot.bytes, "the hook changed target bytes");
    assert.equal(
      statSync(snapshot.filePath).mtimeMs,
      snapshot.mtimeMs,
      "the hook changed the target mtime",
    );
  }
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  assert.equal(result.stderr, "");
  return result.stdout === "" ? "" : JSON.parse(result.stdout);
}

function runPre(payload, extraEnv = {}) {
  return runHook({ ...payload, hook_event_name: "PreToolUse" }, extraEnv);
}

function runPost(payload, extraEnv = {}) {
  return runHook({ ...payload, hook_event_name: "PostToolUse" }, extraEnv);
}

function prePayload(directory, filename, content, toolName = "Write") {
  return {
    cwd: directory,
    permission_mode: "default",
    tool_input: { content, file_path: filename },
    tool_name: toolName,
    tool_use_id: "toolu_test",
  };
}

function writeUpdate(directory, filename, originalFile, structuredPatch = []) {
  return {
    cwd: directory,
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

function updatedContent(result) {
  return result.hookSpecificOutput.updatedInput.content;
}

test("autocrlf=true gives a tracked Write update CRLF content without approving it", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filename = "tracked.txt";
  writeFileSync(path.join(directory, filename), "one\ntwo\n");
  commitAll(directory);

  const result = runPre(prePayload(directory, filename, "one\ntwo changed\n"));

  assert.equal(updatedContent(result), "one\r\ntwo changed\r\n");
  assert.equal(result.hookSpecificOutput.updatedInput.file_path, filename);
  assert.equal(JSON.stringify(result).includes("permissionDecision"), false);
});

test("a tracked CRLF index blob selects CRLF when autocrlf=false", (t) => {
  const directory = repository(t);
  const filename = "tracked.txt";
  writeFileSync(path.join(directory, filename), "one\r\ntwo\r\n");
  commitAll(directory);

  const result = runPre(prePayload(directory, filename, "one\ntwo changed\n"));

  assert.equal(updatedContent(result), "one\r\ntwo changed\r\n");
});

test("a tracked LF file needs no updated input", (t) => {
  const directory = repository(t);
  const filename = "tracked.txt";
  writeFileSync(path.join(directory, filename), "one\ntwo\n");
  commitAll(directory);

  assert.equal(runPre(prePayload(directory, filename, "one\ntwo changed\n")), "");
});

test("an eol=lf attribute overrides autocrlf=true", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  writeFileSync(path.join(directory, ".gitattributes"), "*.sh text eol=lf\n");
  const filename = "script.sh";
  writeFileSync(path.join(directory, filename), "#!/bin/sh\nprintf ok\n");
  commitAll(directory);

  const result = runPre(prePayload(directory, filename, "#!/bin/sh\r\nprintf changed\r\n"));

  assert.equal(updatedContent(result), "#!/bin/sh\nprintf changed\n");
});

test("a -text attribute skips line-ending conversion", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  writeFileSync(path.join(directory, ".gitattributes"), "*.dat -text\n");
  const filename = "opaque.dat";
  writeFileSync(path.join(directory, filename), "one\ntwo\n");
  commitAll(directory);

  assert.equal(runPre(prePayload(directory, filename, "one\ntwo changed\n")), "");
});

test("untracked new files follow autocrlf=true and have no target with autocrlf=false", (t) => {
  const crlfDirectory = repository(t, { autocrlf: "true" });
  const crlfResult = runPre(prePayload(crlfDirectory, "new.txt", "one\ntwo\n"));
  assert.equal(updatedContent(crlfResult), "one\r\ntwo\r\n");

  const noRuleDirectory = repository(t);
  assert.equal(runPre(prePayload(noRuleDirectory, "new.txt", "one\ntwo\n")), "");
});

test("untracked text=auto files follow core.eol", (t) => {
  const lfDirectory = repository(t, { eol: "lf" });
  writeFileSync(path.join(lfDirectory, ".gitattributes"), "* text=auto\n");
  commitAll(lfDirectory);
  assert.equal(runPre(prePayload(lfDirectory, "new.txt", "one\ntwo\n")), "");
  assert.equal(
    updatedContent(runPre(prePayload(lfDirectory, "new.txt", "one\r\ntwo\r\n"))),
    "one\ntwo\n",
  );

  const crlfDirectory = repository(t, { eol: "crlf" });
  writeFileSync(path.join(crlfDirectory, ".gitattributes"), "* text=auto\n");
  commitAll(crlfDirectory);
  assert.equal(
    updatedContent(runPre(prePayload(crlfDirectory, "new.txt", "one\ntwo\n"))),
    "one\r\ntwo\r\n",
  );
});

test("a new file under a missing directory uses repository line endings", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filename = path.join("not-created", "nested", "new.txt");

  const result = runPre(prePayload(directory, filename, "one\ntwo\n"));

  assert.equal(updatedContent(result), "one\r\ntwo\r\n");
  assert.equal(existsSync(path.join(directory, "not-created")), false);
});

test("outside git, existing endings are preserved in input and new files have no target", (t) => {
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

  writeFileSync(path.join(directory, "crlf.txt"), "one\r\ntwo\r\n");
  assert.equal(
    updatedContent(runPre(prePayload(directory, "crlf.txt", "one\ntwo changed\n"))),
    "one\r\ntwo changed\r\n",
  );

  writeFileSync(path.join(directory, "mixed.txt"), "one\r\ntwo\r\nthree\r\nfour\n");
  assert.equal(
    updatedContent(runPre(prePayload(directory, "mixed.txt", "one\ntwo\nthree\nfour changed\n"))),
    "one\r\ntwo\r\nthree\r\nfour changed\r\n",
  );

  assert.equal(runPre(prePayload(directory, "new.txt", "one\ntwo\n")), "");
});

test("conversion preserves lone CR, a missing final newline, and Korean text", (t) => {
  const directory = repository(t, { autocrlf: "true" });

  const result = runPre(prePayload(directory, "bytes.txt", "한글\rlone\nlast\n끝"));

  assert.equal(updatedContent(result), "한글\rlone\r\nlast\r\n끝");
});

test("content containing NUL is ignored", (t) => {
  const directory = repository(t, { autocrlf: "true" });

  assert.equal(runPre(prePayload(directory, "binary.bin", "one\n\0two\n")), "");
});

test("PreToolUse environment switches apply to their own stages", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const payload = prePayload(directory, "new.txt", "one\ntwo\n");

  assert.equal(runPre(payload, { WHITESPACE_GUARD: "0" }), "");
  assert.equal(runPre(payload, { WHITESPACE_GUARD_EOL: "0" }), "");
  assert.equal(
    updatedContent(runPre(payload, { WHITESPACE_GUARD_INDENT: "0" })),
    "one\r\ntwo\r\n",
  );
});

test("a PreToolUse payload for Edit is ignored", (t) => {
  const directory = repository(t, { autocrlf: "true" });

  assert.equal(runPre(prePayload(directory, "new.txt", "one\ntwo\n", "Edit")), "");
});

test("PostToolUse never changes LF bytes in an autocrlf=true repository", (t) => {
  const directory = repository(t, { autocrlf: "true" });
  const filename = "tracked.txt";
  writeFileSync(path.join(directory, filename), "one\ntwo\n");
  commitAll(directory);

  assert.equal(runPost(editPayload(directory, filename, [], "two")), "");
  assert.deepEqual(readFileSync(path.join(directory, filename)), Buffer.from("one\ntwo\n"));
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

  const result = runPost(editPayload(directory, filename, patch, "\tone\n    bad"));

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

  assert.equal(runPost(editPayload(directory, filename, patch, " * comment\n\t\t  aligned")), "");
});

test("a tab in a changed line violates a space-style file", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "space.cpp";
  writeFileSync(
    path.join(directory, filename),
    ["root", "    one", "    two", "    three", "    four", "    five", "\tbad", ""].join("\n"),
  );
  const patch = [{ lines: ["+  bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];

  const result = runPost(editPayload(directory, filename, patch, "\tbad"));

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
  assert.equal(runPost(editPayload(directory, ambiguous, ambiguousPatch, "    changed")), "");

  const small = "small.cpp";
  writeFileSync(
    path.join(directory, small),
    ["root", "\tone", "\ttwo", "\tthree", "\tfour", "    changed", ""].join("\n"),
  );
  const smallPatch = [{ lines: ["+    changed"], newLines: 1, newStart: 6, oldLines: 0, oldStart: 6 }];
  assert.equal(runPost(editPayload(directory, small, smallPatch, "    changed")), "");
});

test("Write update uses originalFile as the indentation baseline", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "rewrite.cpp";
  const original = ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", ""].join("\n");
  writeFileSync(path.join(directory, filename), `${original}    bad\n`);
  const patch = [{ lines: ["+    bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];

  const result = runPost(writeUpdate(directory, filename, original, patch));

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

  const result = runPost(createPayload(directory, "new.cpp"));

  assert.equal(result.decision, "block");
  assert.match(result.reason, /The other \.cpp files in this folder indent with tabs/);
  assert.match(result.reason, /in those 2 files start with a tab/);
  assert.match(result.reason, /2 lines you just wrote start with spaces: 2-3\./);

  const aloneDirectory = temporaryDirectory(t);
  writeFileSync(path.join(aloneDirectory, "alone.cpp"), "root\n    one\n    two\n");
  assert.equal(runPost(createPayload(aloneDirectory, "alone.cpp")), "");
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

  const result = runPost(payload);

  assert.equal(result.decision, "block");
  assert.match(result.reason, /in the text you just inserted/);
  assert.doesNotMatch(result.reason, /: 7\./);
});

test("PostToolUse environment switches only disable their own stages", (t) => {
  const directory = temporaryDirectory(t);
  const filename = "switch.cpp";
  writeFileSync(
    path.join(directory, filename),
    ["root", "\tone", "\ttwo", "\tthree", "\tfour", "\tfive", "    bad", ""].join("\n"),
  );
  const patch = [{ lines: ["+    bad"], newLines: 1, newStart: 7, oldLines: 0, oldStart: 7 }];
  const payload = editPayload(directory, filename, patch, "    bad");

  assert.equal(runPost(payload, { WHITESPACE_GUARD: "OFF" }), "");
  assert.equal(runPost(payload, { WHITESPACE_GUARD_INDENT: "false" }), "");
  assert.equal(runPost(payload, { WHITESPACE_GUARD_EOL: "false" }).decision, "block");
});

test("malformed stdin and a missing file are silent", (t) => {
  assert.equal(runHook("{not-json"), "");
  const directory = temporaryDirectory(t);
  assert.equal(runPost(editPayload(directory, "missing.txt", [], "text")), "");
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

  const result = runPost(editPayload(directory, filename, patch, "    bad3\n    bad4\n    bad5\n    bad9"));

  assert.equal(result.decision, "block");
  assert.match(result.reason, /3-5, 9/);
});
