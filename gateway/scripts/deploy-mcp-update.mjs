import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(homedir(), "Library", "Application Support", "Belly Home Infra", "gateway");
const sourceEnv = await readFile(join(sourceRoot, ".env"), "utf8");
const sourcePort = sourceEnv.match(/^BELLY_HOME_PORT=(\d+)$/m)?.[1];
if (!sourcePort) throw new Error("Development .env must define BELLY_HOME_PORT");
const files = [
  "src/app.mjs",
  "src/audit-log.mjs",
  "src/config.mjs",
  "src/create-alarm-mcp.mjs",
  "src/document-store.mjs",
  "src/plugin-environment.mjs",
  "src/server.mjs",
  "src/store.mjs",
  "src/unified-http-server.mjs",
  "src/mcp-http-app.mjs",
  "test/document-store.test.mjs",
  "test/gateway.test.mjs",
  "test/launchd.test.mjs",
  "test/mcp-create.test.mjs",
  "scripts/mcp-e2e.mjs",
  ".env.example"
];

for (const relativePath of files) {
  const destination = join(runtimeRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(sourceRoot, relativePath), destination);
}

const runtimeEnvFile = join(runtimeRoot, ".env");
const runtimeEnv = await readFile(runtimeEnvFile, "utf8");
const removedKeys = new Set([
  "PORT",
  "ALARM_GATEWAY_URL",
  "ALARM_MCP_HTTP_HOST",
  "ALARM_MCP_HTTP_PORT",
  "ALARM_MCP_BEARER_TOKEN"
]);
const retainedLines = runtimeEnv
  .split(/\r?\n/)
  .filter((line) => !removedKeys.has(line.slice(0, line.indexOf("="))));
const withoutExistingPort = retainedLines.filter((line) => !line.startsWith("BELLY_HOME_PORT="));
const updatedRuntimeEnv = `BELLY_HOME_PORT=${sourcePort}\n${withoutExistingPort.join("\n").replace(/^\n+|\n+$/g, "")}\n`;
if (updatedRuntimeEnv !== runtimeEnv) await writeFile(runtimeEnvFile, updatedRuntimeEnv, { mode: 0o600 });

const uid = process.getuid();
function launchctl(args, stdio = "inherit") {
  return new Promise((resolve, reject) => {
    const child = spawn("launchctl", args, { stdio });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

await launchctl(["bootout", `gui/${uid}/com.belly.home.mcp-http`], "ignore");
await rm(join(homedir(), "Library", "LaunchAgents", "com.belly.home.mcp-http.plist"), { force: true });

const launchFailures = [];
for (const label of ["com.belly.home.gateway"]) {
  const service = `gui/${uid}/${label}`;
  const status = await launchctl(["print", service], "ignore");
  const args = status === 0
    ? ["kickstart", "-k", service]
    : status === 113
      ? ["bootstrap", `gui/${uid}`, join(homedir(), "Library", "LaunchAgents", `${label}.plist`)]
      : null;
  if (!args) {
    launchFailures.push(`${label}: could not inspect service (exit ${status})`);
    continue;
  }
  const result = await launchctl(args);
  if (result !== 0 && args[0] === "bootstrap") {
    const fallback = await launchctl(["load", "-w", args[2]]);
    if (fallback === 0) continue;
  }
  if (result !== 0) launchFailures.push(`${label}: launchctl ${args[0]} failed (exit ${result})`);
}

if (launchFailures.length > 0) throw new Error(`Service restart failed:\n${launchFailures.join("\n")}`);

console.log(`Updated ${files.length} Belly Home files and restarted the unified Gateway/MCP service.`);
