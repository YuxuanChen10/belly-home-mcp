import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
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
import { DocumentStore } from "../src/document-store.mjs";
import { CreateAlarmGatewayClient } from "../src/gateway-client.mjs";
import { createMcpHttpHandler } from "../src/mcp-http-app.mjs";
import { GatewayStore } from "../src/store.mjs";
import { createUnifiedHttpServer } from "../src/unified-http-server.mjs";

const gatewayDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "alarm-create-mcp-"));
  const store = await new GatewayStore(join(directory, "store.json")).load();
  const diaryRootDirectory = join(directory, "diary");
  const documentRootDirectory = join(directory, "belly-home");
  const diaryLogFile = join(directory, "logs", "diary-mcp.log");
  const desktopLogFile = join(directory, "logs", "desktop-mcp.log");
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
  return {
    store,
    gateway,
    baseUrl,
    port: String(gateway.address().port),
    pluginToken,
    device,
    diaryRootDirectory,
    documentRootDirectory,
    diaryLogFile,
    desktopLogFile
  };
}

function assertMinimalTools(tools) {
  assert.deepEqual(tools.tools.map((tool) => tool.name), [
    "create_alarm",
    "append_diary",
    "update_diary",
    "read_diary",
    "list_diary_entries",
    "create_document",
    "append_document",
    "read_document",
    "read_file_names",
    "move_files"
  ]);
  const alarmTool = tools.tools.find((tool) => tool.name === "create_alarm");
  assert.deepEqual(Object.keys(alarmTool.inputSchema.properties).sort(), ["fireAt", "label"]);
  assert.equal(alarmTool.annotations.readOnlyHint, false);
  assert.equal(alarmTool.annotations.destructiveHint, false);
  assert.equal(alarmTool.annotations.openWorldHint, false);
  const diaryTool = tools.tools.find((tool) => tool.name === "append_diary");
  assert.deepEqual(Object.keys(diaryTool.inputSchema.properties).sort(), ["content", "tags", "title"]);
  assert.equal(diaryTool.annotations.openWorldHint, false);
  const updateTool = tools.tools.find((tool) => tool.name === "update_diary");
  assert.deepEqual(Object.keys(updateTool.inputSchema.properties).sort(), ["id", "patch"]);
  assert.equal(updateTool.annotations.destructiveHint, false);
  const createDocumentTool = tools.tools.find((tool) => tool.name === "create_document");
  assert.deepEqual(Object.keys(createDocumentTool.inputSchema.properties).sort(), ["attachments", "content", "tags", "target", "title"]);
  assert.deepEqual(createDocumentTool.inputSchema.properties.target.enum, ["design", "development", "knowledge"]);
  assert.equal(createDocumentTool.annotations.readOnlyHint, false);
  const documentTool = tools.tools.find((tool) => tool.name === "append_document");
  assert.deepEqual(Object.keys(documentTool.inputSchema.properties).sort(), ["attachments", "content", "target", "title"]);
  assert.deepEqual(documentTool.inputSchema.properties.target.enum, ["design", "development", "knowledge"]);
  const readDocumentTool = tools.tools.find((tool) => tool.name === "read_document");
  assert.deepEqual(Object.keys(readDocumentTool.inputSchema.properties).sort(), ["limit", "offset", "target", "title"]);
  assert.deepEqual(readDocumentTool.inputSchema.properties.target.enum, ["design", "development", "knowledge"]);
  assert.equal(readDocumentTool.annotations.readOnlyHint, true);
  assert.equal(readDocumentTool.annotations.destructiveHint, false);
  assert.equal(readDocumentTool.annotations.openWorldHint, false);
  const readFileNamesTool = tools.tools.find((tool) => tool.name === "read_file_names");
  assert.deepEqual(Object.keys(readFileNamesTool.inputSchema.properties).sort(), []);
  assert.equal(readFileNamesTool.annotations.readOnlyHint, true);
  assert.equal(readFileNamesTool.annotations.destructiveHint, false);
  const moveFilesTool = tools.tools.find((tool) => tool.name === "move_files");
  assert.deepEqual(Object.keys(moveFilesTool.inputSchema.properties).sort(), ["moves", "snapshotId"]);
  assert.equal(moveFilesTool.annotations.readOnlyHint, false);
  assert.equal(moveFilesTool.annotations.destructiveHint, true);
  assert.equal(moveFilesTool.annotations.openWorldHint, false);
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

test("create-only stdio MCP exposes alarm, memory, and Desktop tools", async () => {
  const { gateway, port, pluginToken, diaryRootDirectory, documentRootDirectory, diaryLogFile, desktopLogFile } = await fixture();
  const fakeDesktopHelper = join(gatewayDirectory, "test", "fixtures", "fake-desktop-helper.mjs");
  await chmod(fakeDesktopHelper, 0o700);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(gatewayDirectory, "src/mcp-create-server.mjs")],
    cwd: gatewayDirectory,
    env: {
      ...process.env,
      BELLY_HOME_PORT: port,
      ALARM_PLUGIN_TOKEN: pluginToken,
      ALARM_TIMEZONE: "Australia/Melbourne",
      DIARY_ROOT_DIR: diaryRootDirectory,
      BELLY_HOME_ROOT_DIR: documentRootDirectory,
      DIARY_LOG_FILE: diaryLogFile,
      BELLY_DESKTOP_HELPER_PATH: fakeDesktopHelper,
      DESKTOP_LOG_FILE: desktopLogFile
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
        content: "hello diary",
        tags: ["test"]
      }
    });
    assert.equal(append.isError, undefined);
    assert.match(append.structuredContent.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(append.structuredContent.id, /^[0-9a-f-]{36}$/);

    const update = await client.callTool({
      name: "update_diary",
      arguments: {
        id: append.structuredContent.id,
        patch: { title: "Updated MCP test", tags: ["test", "updated"] }
      }
    });
    assert.equal(update.isError, undefined);
    assert.equal(update.structuredContent.message, "Diary Updated");
    assert.equal(update.structuredContent.id, append.structuredContent.id);
    assert.equal(update.structuredContent.version, 2);

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

    const createdDocument = await client.callTool({
      name: "create_document",
      arguments: {
        target: "development",
        title: "Standalone MCP document",
        content: "first document version",
        tags: ["mcp", "test"],
        attachments: ["fixture-reference"]
      }
    });
    assert.equal(createdDocument.isError, undefined);
    assert.equal(createdDocument.structuredContent.status, "created");
    assert.equal(createdDocument.structuredContent.version, 1);
    assert.equal(createdDocument.structuredContent.createdAt, createdDocument.structuredContent.updatedAt);
    assert.match(
      await readFile(join(documentRootDirectory, "Development", "Documents", `${createdDocument.structuredContent.id}.md`), "utf8"),
      /first document version/
    );

    const appendedStandalone = await client.callTool({
      name: "append_document",
      arguments: {
        target: "development",
        title: "Standalone MCP document",
        content: "second document version"
      }
    });
    assert.equal(appendedStandalone.isError, undefined);
    assert.equal(appendedStandalone.structuredContent.id, createdDocument.structuredContent.id);
    assert.equal(appendedStandalone.structuredContent.version, 2);

    const readStandalone = await client.callTool({
      name: "read_document",
      arguments: { target: "development", title: "standalone mcp document" }
    });
    assert.equal(readStandalone.isError, undefined);
    assert.equal(readStandalone.structuredContent.id, createdDocument.structuredContent.id);
    assert.equal(readStandalone.structuredContent.version, 2);
    assert.match(readStandalone.structuredContent.content, /first document version/);
    assert.match(readStandalone.structuredContent.content, /second document version/);

    const document = await client.callTool({
      name: "append_document",
      arguments: {
        target: "design",
        content: "document API test",
        attachments: ["fixture-attachment"]
      }
    });
    assert.equal(document.isError, undefined);
    assert.equal(document.structuredContent.target, "design");
    assert.equal(document.structuredContent.attachmentCount, 1);
    assert.match(
      await readFile(join(documentRootDirectory, "Design", "Design Diary.md"), "utf8"),
      /document API test/
    );

    const readDocument = await client.callTool({
      name: "read_document",
      arguments: { target: "design", offset: 0, limit: 30 }
    });
    assert.equal(readDocument.isError, undefined);
    assert.equal(readDocument.structuredContent.status, "found");
    assert.equal(readDocument.structuredContent.target, "design");
    assert.equal(readDocument.structuredContent.hasMore, true);
    assert.match(readDocument.structuredContent.content, /^# Design Diary/);

    const desktop = await client.callTool({
      name: "read_file_names",
      arguments: {}
    });
    assert.equal(desktop.isError, undefined);
    assert.equal(desktop.structuredContent.folders[0].folderName, "Career");
    assert.equal(desktop.structuredContent.looseFiles[0].filename, "Resume.pdf");
    assert.equal(desktop.structuredContent.looseFiles[0].relativePath, "Resume.pdf");
    assert.equal(desktop.structuredContent.looseFiles[0].extension, "pdf");

    const desktopMove = await client.callTool({
      name: "move_files",
      arguments: {
        snapshotId: desktop.structuredContent.snapshotId,
        moves: [{ sourceRelativePath: "Resume.pdf", destinationRelativePath: "Career/Resume.pdf" }]
      }
    });
    assert.equal(desktopMove.isError, undefined);
    assert.equal(desktopMove.structuredContent.status, "moved");
    assert.equal(desktopMove.structuredContent.movedCount, 1);

    const logText = await readFile(diaryLogFile, "utf8");
    assert.equal(logText.includes("hello diary"), false);
    const events = logText.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.tool), [
      "append_diary",
      "update_diary",
      "read_diary",
      "list_diary_entries",
      "create_document",
      "append_document",
      "read_document",
      "append_document",
      "read_document"
    ]);
    assert.equal(events[0].contentChars, "hello diary".length);
    assert.equal(events[1].operation, "UPDATE");
    assert.equal(events[1].diaryId, append.structuredContent.id);
    assert.deepEqual(events[1].updatedFields, ["title", "tags"]);
    assert.equal(events[4].target, "development");
    assert.equal(events[5].target, "development");
    assert.equal(events[6].target, "development");
    assert.equal(events[7].target, "design");
    assert.equal(events[8].target, "design");

    const desktopEventsText = await readFile(desktopLogFile, "utf8");
    assert.equal(desktopEventsText.includes("Resume.pdf"), false);
    const desktopEvents = desktopEventsText.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(desktopEvents.map((event) => event.tool), [
      "read_file_names",
      "move_files"
    ]);
    assert.equal(desktopEvents[1].successCount, 1);
  } finally {
    await client.close();
    await new Promise((resolve) => gateway.close(resolve));
  }
});

test("create-only Streamable HTTP MCP works end to end", async () => {
  const { store, gateway, pluginToken, device, diaryRootDirectory, documentRootDirectory } = await fixture();
  await new Promise((resolve) => gateway.close(resolve));
  let gatewayClient;
  const gatewayHandler = createHandler({
    store,
    adminToken: "mcp-admin-token",
    pluginToken,
    pluginDeviceId: device.deviceId
  });
  const mcpHandler = createMcpHttpHandler({
    createMcpServer: () => createAlarmMcpServer({
      client: gatewayClient,
      timeZone: "Australia/Melbourne",
      diary: new DiaryStore({ rootDirectory: diaryRootDirectory, timeZone: "Australia/Melbourne" }),
      documents: new DocumentStore({ rootDirectory: documentRootDirectory, timeZone: "Australia/Melbourne" })
    })
  });
  const unified = createUnifiedHttpServer({ gatewayHandler, mcpHandler });
  await new Promise((resolve) => unified.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${unified.address().port}`;
  gatewayClient = new CreateAlarmGatewayClient({ baseUrl, token: pluginToken });
  const mcpUrl = `${baseUrl}/mcp`;
  const initialGet = await fetch(mcpUrl, { method: "GET" });
  assert.equal(initialGet.status, 405);
  const staleSession = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": "session-from-before-restart"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  assert.equal(staleSession.status, 404);
  assert.equal((await staleSession.json()).error.message, "Session not found");

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
    await new Promise((resolve) => unified.close(resolve));
  }
});
