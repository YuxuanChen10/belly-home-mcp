import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = join(gatewayRoot, "..");
const launchdRoot = join(projectRoot, "launchd");
const launchAgentsRoot = join(homedir(), "Library", "LaunchAgents");
const runtimeRoot = join(homedir(), "Library", "Application Support", "Belly Home Infra", "Runtime");
const logRoot = join(homedir(), "Library", "Logs", "Belly Home Infra");
const plists = ["com.belly.home.gateway.plist", "com.belly.home.mcp-http.plist"];

await mkdir(launchAgentsRoot, { recursive: true });
await mkdir(runtimeRoot, { recursive: true });
await mkdir(logRoot, { recursive: true });

for (const plist of plists) {
  await copyFile(join(launchdRoot, plist), join(launchAgentsRoot, plist));
}

console.log(`Copied ${plists.length} LaunchAgent plist files to ${launchAgentsRoot}`);
console.log("Load or refresh them with:");
for (const plist of plists) {
  const target = join(launchAgentsRoot, plist);
  console.log(`launchctl bootout gui/$(id -u) "${target}" 2>/dev/null || true`);
  console.log(`launchctl bootstrap gui/$(id -u) "${target}"`);
  console.log(`launchctl kickstart -k gui/$(id -u)/${plist.replace(/\.plist$/, "")}`);
}
