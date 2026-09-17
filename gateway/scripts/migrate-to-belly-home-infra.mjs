#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_BELLY_HOME_PORT } from "../src/config.mjs";

const sourceGateway = join(dirname(fileURLToPath(import.meta.url)), "..");
const oldGateway = join(homedir(), "Library", "Application Support", "AlarmGateway", "gateway");
const root = join(homedir(), "Library", "Application Support", "Belly Home Infra");
const runtimeRoot = join(root, "gateway");
const diaryRoot = join(root, "Diary");
const logsRoot = join(homedir(), "Library", "Logs", "Belly Home Infra");
const launchAgentsRoot = join(homedir(), "Library", "LaunchAgents");

async function readEnv(path) {
  const env = new Map();
  if (!existsSync(path)) return env;
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    env.set(line.slice(0, index), line.slice(index + 1));
  }
  return env;
}

function envLine(env, key, fallback = "") {
  return `${key}=${env.get(key) ?? fallback}`;
}

function plist({ label, entry, stdout, stderr }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>--env-file-if-exists=${runtimeRoot}/.env</string>
    <string>${runtimeRoot}/${entry}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${runtimeRoot}</string>
  <key>StandardOutPath</key>
  <string>${logsRoot}/${stdout}</string>
  <key>StandardErrorPath</key>
  <string>${logsRoot}/${stderr}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
`;
}

async function main() {
  await mkdir(root, { recursive: true });
  await mkdir(diaryRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });
  await cp(sourceGateway, runtimeRoot, {
    recursive: true,
    force: true,
    filter: (path) => !path.includes("/node_modules/") && !path.endsWith("/.env")
  });

  const oldEnv = await readEnv(join(oldGateway, ".env"));
  const newEnv = [
    `BELLY_HOME_PORT=${oldEnv.get("BELLY_HOME_PORT") ?? oldEnv.get("PORT") ?? DEFAULT_BELLY_HOME_PORT}`,
    envLine(oldEnv, "HOST", "0.0.0.0"),
    envLine(oldEnv, "ALARM_GATEWAY_TOKEN", "dev-admin-token"),
    envLine(oldEnv, "ALARM_PLUGIN_TOKEN"),
    envLine(oldEnv, "ALARM_PLUGIN_RATE_LIMIT", "6"),
    envLine(oldEnv, "ALARM_DEVICE_ID"),
    "ALARM_TIMEZONE=Australia/Melbourne",
    `BELLY_HOME_ROOT_DIR=${root}`,
    `DIARY_ROOT_DIR=${diaryRoot}`,
    `DIARY_LOG_FILE=${logsRoot}/diary-mcp.log`,
    `ALARM_DATA_FILE=${runtimeRoot}/data/gateway.json`,
    envLine(oldEnv, "APNS_KEY_FILE"),
    envLine(oldEnv, "APNS_KEY_ID"),
    envLine(oldEnv, "APNS_TEAM_ID"),
    envLine(oldEnv, "APNS_TOPIC"),
    envLine(oldEnv, "APNS_ENVIRONMENT", "development")
  ].join("\n");
  await writeFile(join(runtimeRoot, ".env"), `${newEnv}\n`, { mode: 0o600 });

  await mkdir(join(runtimeRoot, "data"), { recursive: true });
  if (existsSync(join(oldGateway, "data", "gateway.json"))) {
    await cp(join(oldGateway, "data", "gateway.json"), join(runtimeRoot, "data", "gateway.json"), { force: true });
  }

  await writeFile(
    join(launchAgentsRoot, "com.belly.home.gateway.plist"),
    plist({
      label: "com.belly.home.gateway",
      entry: "src/server.mjs",
      stdout: "gateway.out.log",
      stderr: "gateway.err.log"
    })
  );
  await rm(join(launchAgentsRoot, "com.belly.home.mcp-http.plist"), { force: true });

  const uid = String(process.getuid?.() ?? "");
  for (const label of [
    "com.cc.alarm-gateway.mcp-http",
    "com.cc.alarm-gateway.gateway",
    "com.belly.home.mcp-http",
    "com.belly.home.gateway"
  ]) {
    spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "ignore" });
  }
  for (const file of ["com.belly.home.gateway.plist"]) {
    spawnSync("launchctl", ["bootstrap", `gui/${uid}`, join(launchAgentsRoot, file)], { stdio: "inherit" });
  }
  for (const label of ["com.belly.home.gateway"]) {
    spawnSync("launchctl", ["kickstart", "-k", `gui/${uid}/${label}`], { stdio: "inherit" });
  }

  console.log(`Migrated Belly Home Infra runtime to ${runtimeRoot}`);
  console.log("Cloudflare should point at the unified Belly Home port and /mcp path.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
