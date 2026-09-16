import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHandler } from "../src/app.mjs";
import { GatewayStore } from "../src/store.mjs";

const gatewayDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

test("MCP exposes alarm tools and creates through the gateway", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alarm-mcp-"));
  const store = await new GatewayStore(join(directory, "store.json")).load();
  const adminToken = "mcp-test-token";
  const httpServer = createServer(createHandler({ store, adminToken }));
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const pairingResponse = await fetch(`${baseUrl}/v1/pairing/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const pairing = await pairingResponse.json();
  const deviceResponse = await fetch(`${baseUrl}/v1/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: pairing.code, name: "MCP iPhone" })
  });
  const device = await deviceResponse.json();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(gatewayDirectory, "src/mcp-server.mjs")],
    cwd: gatewayDirectory,
    env: {
      ...process.env,
      ALARM_GATEWAY_URL: baseUrl,
      ALARM_GATEWAY_TOKEN: adminToken,
      ALARM_DEVICE_ID: device.deviceId,
      ALARM_TIMEZONE: "Australia/Melbourne"
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "alarm-gateway-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["cancel_alarm", "create_alarm", "get_alarm_status", "list_alarms", "update_alarm"]
    );

    const result = await client.callTool({
      name: "create_alarm",
      arguments: {
        label: "MCP test",
        schedule: { kind: "once", fireAt: new Date(Date.now() + 3_600_000).toISOString() },
        idempotencyKey: "mcp-test-create"
      }
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.alarm.status, "queued");
  } finally {
    await client.close();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
