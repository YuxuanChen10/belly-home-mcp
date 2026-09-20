import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DiaryStore } from "../modules/memory/diary/store.mjs";
import { DocumentStore } from "../modules/memory/document/store.mjs";
import { registerBellyHomeTools } from "./tool-registry.mjs";

export function createBellyHomeMcpServer({
  client,
  timeZone = "Australia/Melbourne",
  diary = new DiaryStore({ timeZone }),
  documents = new DocumentStore({ timeZone }),
  auditLog = null
}) {
  const server = new McpServer({ name: "belly-home-mcp", version: "0.2.0" }, {
    instructions: `This private server can create one-time iPhone alarms and manage Belly Home Markdown data. For alarms, resolve the user's requested time in ${timeZone}, then pass fireAt with an explicit UTC offset. Do not claim the alarm is on the phone unless the result status is scheduled. Diary is a private life domain and must use the diary tools. Documents are the shareable design, development, and knowledge domains and must use append_document or read_document. Never cross these domains or invent storage paths.`
  });
  registerBellyHomeTools(server, { client, timeZone, diary, documents, auditLog });
  return server;
}
