/* Graphene test runner — node test/run.js */
const { execFileSync } = require("child_process");
const path = require("path");
const suites = ["boolean.test.js", "trace.test.js", "distort.test.js", "app.smoke.js", "interaction.test.js", "pdf.test.js", "png.test.js", "mesh.test.js", "sw.test.js"];
let failed = 0;
for (const s of suites) {
  console.log(`\n\x1b[1m▶ ${s}\x1b[0m`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: "inherit" });
  } catch (e) { failed++; }
}
console.log(failed ? `\n\x1b[31m${failed} suite(s) failed\x1b[0m` : "\n\x1b[32mAll suites passed\x1b[0m");
process.exit(failed ? 1 : 0);
