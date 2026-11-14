import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.STUB_LOG) {
  writeFileSync(process.env.STUB_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }));
}

const qmlPath = (args[0] ?? "").replaceAll("\\", "/");
if (process.env.STUB_MODE === "warnings") {
  process.stderr.write(
    [
      `Warning: ${qmlPath}:5:5: Could not find property "radiuss". [missing-property]`,
      "    radiuss: 4",
      "    ^^^^^^^",
      "Info: Did you mean \"radius\"?",
      "Suggested change:",
      "    radius: 4",
      "    ^^^^^^",
      "",
    ].join("\n"),
  );
  process.stdout.write(
    [
      `Warning: ${qmlPath}:7:5: Could not find property "opacty". [missing-property]`,
      "    opacty: 0.5",
      "    ^^^^^^",
      "Info: Did you mean \"opacity\"?",
      "Suggested change:",
      "    opacity: 0.5",
      "    ^^^^^^^",
      "",
    ].join("\n"),
  );
} else if (process.env.STUB_MODE === "syntax") {
  process.stderr.write(`Warning: ${qmlPath}:6:1: Expected token \`}' [syntax]\n`);
  process.exitCode = 255;
} else if (process.env.STUB_MODE === "import") {
  process.stdout.write(
    [
      `Warning: ${qmlPath}:1:1: Warnings occurred while importing module "My.Missing.Module": [import]`,
      "import My.Missing.Module",
      "^^^^^^",
      "---",
      "Warning: 1:1: Failed to import My.Missing.Module. Are your import paths set up properly? [import]",
      "---",
      "",
    ].join("\n"),
  );
} else if (process.env.STUB_MODE === "sleep") {
  setTimeout(() => {}, 5_000);
}
