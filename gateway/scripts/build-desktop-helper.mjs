import { copyFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(gatewayRoot, "native", "desktop-helper", "main.swift");
const entitlements = join(gatewayRoot, "native", "desktop-helper", "DesktopHelper.entitlements");
const infoPlist = join(gatewayRoot, "native", "desktop-helper", "Info.plist");
const debug = process.argv.includes("--debug");
const outputArgument = process.argv.find((value) => value.startsWith("--output="));
const output = outputArgument
  ? resolve(outputArgument.slice("--output=".length))
  : join(gatewayRoot, "native", "desktop-helper", "bin", "BellyHomeDesktopHelper.app");
const executable = debug
  ? output
  : join(output, "Contents", "MacOS", "belly-desktop-helper");
const moduleCache = join(tmpdir(), "belly-home-swift-module-cache");

await rm(output, { recursive: true, force: true });
await mkdir(dirname(executable), { recursive: true });
await mkdir(moduleCache, { recursive: true });

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

const swiftArguments = [
  "swiftc",
  source,
  "-o",
  executable,
  "-module-cache-path",
  moduleCache,
  "-framework",
  "Foundation",
  "-framework",
  "AppKit"
];
if (debug) {
  swiftArguments.push("-D", "DEBUG", "-Onone", "-g");
} else {
  swiftArguments.push("-O");
}

await run("xcrun", swiftArguments);

if (!debug) {
  await copyFile(infoPlist, join(output, "Contents", "Info.plist"));
  const identity = process.env.BELLY_DESKTOP_SIGNING_IDENTITY || "-";
  await run("codesign", [
    "--force",
    "--sign",
    identity,
    "--entitlements",
    entitlements,
    "--options",
    "runtime",
    output
  ]);
  await run("codesign", ["--verify", "--strict", "--verbose=2", output]);
  if (identity === "-") {
    console.warn("Desktop Helper uses ad-hoc signing. Reauthorize Desktop after rebuilding, or set BELLY_DESKTOP_SIGNING_IDENTITY to a stable certificate.");
  }
}

console.log(`Built Desktop Helper at ${output}`);
