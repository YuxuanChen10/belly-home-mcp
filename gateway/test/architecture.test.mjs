import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

async function text(relativePath) {
  return readFile(join(source, relativePath), "utf8");
}

test("domain modules own business tools while the gateway only composes them", async () => {
  const registry = await text("gateway/tool-registry.mjs");
  const gatewayServer = await text("gateway/server.mjs");
  const memoryTools = await text("modules/memory/tools.mjs");
  const automationTools = await text("modules/automation/tools.mjs");
  const desktop = await text("modules/desktop/index.mjs");

  assert.match(registry, /registerAutomationTools/);
  assert.match(registry, /registerMemoryTools/);
  assert.match(registry, /registerDesktopTools/);
  assert.doesNotMatch(gatewayServer, /\.registerTool\(/);
  assert.match(memoryTools, /"append_diary"/);
  assert.match(memoryTools, /"read_document"/);
  assert.doesNotMatch(memoryTools, /"create_alarm"/);
  assert.match(automationTools, /"create_alarm"/);
  assert.doesNotMatch(automationTools, /"append_diary"|"read_document"/);
  assert.doesNotMatch(desktop, /\.registerTool\(/);
});

test("legacy source paths remain compatibility-only entry points", async () => {
  const compatibilityFiles = [
    "app.mjs",
    "apns.mjs",
    "audit-log.mjs",
    "config.mjs",
    "create-alarm-mcp.mjs",
    "diary-store.mjs",
    "document-store.mjs",
    "errors.mjs",
    "gateway-client.mjs",
    "plugin-environment.mjs",
    "store.mjs",
    "unified-http-server.mjs",
    "validation.mjs"
  ];

  for (const file of compatibilityFiles) {
    const lines = (await text(file)).trim().split("\n");
    assert.ok(lines.length <= 5, `${file} should remain a thin compatibility entry point`);
  }
});

test("the production MCP remains belly-home-mcp and the legacy admin adapter stays inside Automation", async () => {
  const primary = await text("mcp-create-server.mjs");
  const compatibility = await text("mcp-server.mjs");
  const gatewayServer = await text("gateway/server.mjs");

  assert.match(primary, /createAlarmMcpServer/);
  assert.match(compatibility, /modules\/automation\/alarm\/admin-mcp-server\.mjs/);
  assert.match(gatewayServer, /name: "belly-home-mcp"/);
  assert.doesNotMatch(compatibility, /registerTool|new McpServer/);
});
