process.stdout.write(`argv:${JSON.stringify(process.argv.slice(2))}\n`);
process.stdin.pipe(process.stdout);
const exitCode = Number(process.env.STUB_EXIT_CODE ?? "0");
process.exitCode = Number.isInteger(exitCode) ? exitCode : 0;
