import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.STUB_LOG) {
  writeFileSync(process.env.STUB_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }));
}
const outputIndex = args.indexOf("-o");
if (outputIndex >= 0 && args[outputIndex + 1] && process.env.STUB_MODE !== "sleep") {
  writeFileSync(args[outputIndex + 1], "generated");
}
if (process.env.STUB_MODE === "fail") {
  process.stderr.write("first UI error\nsecond UI error\n");
  process.exitCode = 1;
} else if (process.env.STUB_MODE === "sleep") {
  setTimeout(() => {}, 5_000);
}
