import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = join(gatewayRoot, "test");
const nativeTest = join(testDirectory, "desktop-native-helper.test.mjs");
const nodeTests = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".test.mjs") && name !== "desktop-native-helper.test.mjs")
  .sort()
  .map((name) => join(testDirectory, name));

function run(files) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...files], {
      cwd: gatewayRoot,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`Test phase exited with ${code}`)));
  });
}

await run(nodeTests);
await run([nativeTest]);
