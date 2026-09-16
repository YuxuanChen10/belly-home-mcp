import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHandler } from "../src/app.mjs";
import { createAlarmMcpServer } from "../src/create-alarm-mcp.mjs";
import { DiaryStore } from "../src/diary-store.mjs";
import { CreateAlarmGatewayClient } from "../src/gateway-client.mjs";
import { createMcpHttpServer } from "../src/mcp-http-app.mjs";
import { GatewayStore } from "../src/store.mjs";

const gatewayDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "alarm-create-mcp-"));
  const store = await new GatewayStore(join(directory, "store.json")).load();
  const diaryRootDirectory = join(directory, "diary");
  const diaryLogFile = join(directory, "logs", "diary-mcp.log");
  const adminToken = "mcp-admin-token";
  const pluginToken = "mcp-plugin-token";

  const bootstrap = createServer(createHandler({ store, adminToken }));
  await new Promise((resolve) => bootstrap.listen(0, "127.0.0.1", resolve));
  const bootstrapUrl = `http://127.0.0.1:${bootstrap.address().port}`;
  const pairingResponse = await fetch(`${bootstrapUrl}/v1/pairing/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const pairing = await pairingResponse.json();
  const deviceResponse = await fetch(`${bootstrapUrl}/v1/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: pairing.code, name: "Create-only iPhone" })
  });
  const device = await deviceResponse.json();
  await new Promise((resolve) => bootstrap.close(resolve));

  const gateway = createServer(createHandler({
    store,
    adminToken,
    pluginToken,
    pluginDeviceId: device.deviceId
  }));
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${gateway.address().port}`;
  return { store, gateway, baseUrl, pluginToken, diaryRootDirectory, diaryLogFile };
}

function assertMinimalTools(tools) {
  assert.deepEqual(tools.tools.map((tool) => tool.name), [
    "create_alarm",
    "append_diary",
    "read_diary",
    "list_diary_entries"
  ]);
  const alarmTool = tools.tools.find((tool) => tool.name === "create_alarm");
  assert.deepEqual(Object.keys(alarmTool.inputSchema.properties).sort(), ["fireAt", "label"]);
  assert.equal(alarmTool.annotations.readOnlyHint, false);
  assert.equal(alarmTool.annotations.destructiveHint, false);
  assert.equal(alarmTool.annotations.openWorldHint, false);
  const diaryTool = tools.tools.find((tool) => tool.name === "append_diary");
  assert.deepEqual(Object.keys(diaryTool.inputSchema.properties).sort(), ["content", "title"]);
  assert.equal(diaryTool.annotations.openWorldHint, false);
}

async function callCreate(client, label) {
  return client.callTool({
    name: "create_alarm",
    arguments: {
      label,
      fireAt: new Date(Date.now() + 3_600_000).toISOString()
    }
  });
}

test("create-only stdio MCP exposes alarm and diary tools", async () => {
  const { gateway, baseUrl, pluginToken, diaryRootDirectory, diaryLogFile } = await fixture();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(gatewayDirectory, "src/mcp-create-server.mjs")],
    cwd: gatewayDirectory,
    env: {
      ...process.env,
      ALARM_GATEWAY_URL: baseUrl,
      ALARM_PLUGIN_TOKEN: pluginToken,
      ALARM_TIMEZONE: "Australia/Melbourne",
      DIARY_ROOT_DIR: diaryRootDirectory,
      DIARY_LOG_FILE: diaryLogFile
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "create-only-stdio-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    assertMinimalTools(await client.listTools());
    const result = await callCreate(client, "stdio MCP test");
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.status, "queued");
    assert.equal(result.structuredContent.confirmation.includes("Sync now"), true);

    const append = await client.callTool({
      name: "append_diary",
      arguments: {
        title: "MCP test",
        content: "hello diary"
      }
    });
    assert.equal(append.isError, undefined);
    assert.match(append.structuredContent.date, /^\d{4}-\d{2}-\d{2}$/);

    const read = await client.callTool({
      name: "read_diary",
      arguments: { date: append.structuredContent.date }
    });
    assert.equal(read.structuredContent.status, "found");
    assert.match(read.structuredContent.content, /hello diary/);

    const listed = await client.callTool({
      name: "list_diary_entries",
      arguments: {}
    });
    assert.deepEqual(listed.structuredContent.entries.map((entry) => entry.date), [append.structuredContent.date]);

    const logText = await readFile(diaryLogFile, "utf8");
    assert.equal(logText.includes("hello diary"), false);
    const events = logText.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.tool), ["append_diary", "read_diary", "list_diary_entries"]);
    assert.equal(events[0].contentChars, "hello diary".length);
  } finally {
    await client.close();
    await new Promise((resolve) => gateway.close(resolve));
  }
});

test("create-only Streamable HTTP MCP works end to end", async () => {
  const { gateway, baseUrl, pluginToken, diaryRootDirectory } = await fixture();
  const gatewayClient = new CreateAlarmGatewayClient({ baseUrl, token: pluginToken });
  const mcpHttp = createMcpHttpServer({
    createMcpServer: () => createAlarmMcpServer({
      client: gatewayClient,
      timeZone: "Australia/Melbourne",
      diary: new DiaryStore({ rootDirectory: diaryRootDirectory, timeZone: "Australia/Melbourne" })
    })
  });
  await new Promise((resolve) => mcpHttp.listen(0, "127.0.0.1", resolve));
  const mcpUrl = `http://127.0.0.1:${mcpHttp.address().port}/mcp`;
  const initialGet = await fetch(mcpUrl, { method: "GET" });
  assert.equal(initialGet.status, 405);

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  const client = new Client({ name: "create-only-http-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    assert.match(transport.sessionId, /^[0-9a-f-]{36}$/);
    assertMinimalTools(await client.listTools());
    const first = await callCreate(client, "HTTP MCP test");
    const second = await client.callTool({
      name: "create_alarm",
      arguments: {
        label: first.structuredContent.label,
        fireAt: first.structuredContent.fireAt
      }
    });
    assert.equal(first.structuredContent.alarmId, second.structuredContent.alarmId);
    assert.equal(second.structuredContent.replayed, true);
  } finally {
    await client.close();
    await new Promise((resolve) => mcpHttp.close(resolve));
    await new Promise((resolve) => gateway.close(resolve));
  }
});
