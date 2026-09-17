import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getBellyHomeBaseUrl } from "../src/config.mjs";

const endpoint = `${getBellyHomeBaseUrl()}/mcp`;
const label = process.argv[2] || "MCP end-to-end test";
const minutes = Number.parseInt(process.argv[3] || "5", 10);
const diaryContent = process.env.DIARY_E2E_CONTENT || "Diary MCP end-to-end test entry.";

if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
  throw new Error("Minutes must be an integer from 1 to 60");
}

const transport = new StreamableHTTPClientTransport(new URL(endpoint));
const client = new Client({ name: "alarm-bridge-e2e", version: "1.0.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const expected = ["append_diary", "append_document", "create_alarm", "list_diary_entries", "read_diary"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${expected.join(", ")}, received: ${names.join(", ")}`);
  }

  const alarmResult = await client.callTool({
    name: "create_alarm",
    arguments: {
      label,
      fireAt: new Date(Date.now() + minutes * 60_000).toISOString()
    }
  });
  if (alarmResult.isError) throw new Error(alarmResult.content?.[0]?.text || "create_alarm failed");

  const appendResult = await client.callTool({
    name: "append_diary",
    arguments: {
      title: "MCP E2E",
      content: diaryContent
    }
  });
  if (appendResult.isError) throw new Error(appendResult.content?.[0]?.text || "append_diary failed");

  const readResult = await client.callTool({
    name: "read_diary",
    arguments: { date: appendResult.structuredContent.date }
  });
  if (readResult.isError) throw new Error(readResult.content?.[0]?.text || "read_diary failed");
  if (!readResult.structuredContent.content.includes(diaryContent)) {
    throw new Error("read_diary did not return the appended diary content");
  }

  const listResult = await client.callTool({
    name: "list_diary_entries",
    arguments: { limit: 10 }
  });
  if (listResult.isError) throw new Error(listResult.content?.[0]?.text || "list_diary_entries failed");
  if (!listResult.structuredContent.entries.some((entry) => entry.date === appendResult.structuredContent.date)) {
    throw new Error("list_diary_entries did not include the appended diary date");
  }

  console.log(JSON.stringify({
    alarm: alarmResult.structuredContent,
    diary: {
      append: appendResult.structuredContent,
      read: { status: readResult.structuredContent.status, date: readResult.structuredContent.date },
      list: listResult.structuredContent
    }
  }, null, 2));
} finally {
  await client.close();
}
