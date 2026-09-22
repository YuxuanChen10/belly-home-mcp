import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helper = process.env.BELLY_DESKTOP_HELPER_PATH
  || join(gatewayRoot, "native", "desktop-helper", "bin", "BellyHomeDesktopHelper.app", "Contents", "MacOS", "belly-desktop-helper");

await access(helper).catch(() => {
  throw new Error("Desktop Helper is not built. Run npm run desktop:build first.");
});

const result = await new Promise((resolve, reject) => {
  const child = spawn(helper, ["authorize"], { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.once("error", reject);
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.once("exit", (code) => resolve({
    code,
    stdout: Buffer.concat(stdout).toString("utf8").trim(),
    stderr: Buffer.concat(stderr).toString("utf8").trim()
  }));
});

let response;
try {
  response = JSON.parse(result.stdout);
} catch {
  console.error(result.stderr || "Desktop authorization returned an invalid response.");
  process.exitCode = 1;
}

if (response) {
  if (result.code === 0 && response.status === "authorized") {
    console.log("Belly Home is authorized for the macOS Desktop workspace.");
  } else if (result.code === 0 && response.status === "cancelled") {
    console.log("Desktop authorization was cancelled; no permission was stored.");
  } else {
    console.error(`Desktop authorization failed [${response.code || "UNKNOWN"}]: ${response.message || "Unknown error"}`);
    process.exitCode = 1;
  }
}
