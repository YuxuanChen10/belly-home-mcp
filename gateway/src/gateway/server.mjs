import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DiaryStore } from "../modules/memory/diary/store.mjs";
import { DocumentStore } from "../modules/memory/document/store.mjs";
import { DesktopHelperClient } from "../modules/desktop/helper-client.mjs";
import { registerBellyHomeTools } from "./tool-registry.mjs";

export function createBellyHomeMcpServer({
  client,
  timeZone = "Australia/Melbourne",
  diary = new DiaryStore({ timeZone }),
  documents = new DocumentStore({ timeZone }),
  auditLog = null,
  desktop = new DesktopHelperClient(),
  desktopAuditLog = null
}) {
  const server = new McpServer({ name: "belly-home-mcp", version: "0.2.0" }, {
    instructions: `This private server can create one-time iPhone alarms, manage Belly Home Markdown data, and organize loose files on the user's macOS Desktop. For alarms, resolve the user's requested time in ${timeZone}, then pass fireAt with an explicit UTC offset. Do not claim the alarm is on the phone unless the result status is scheduled. Diary is a private life domain and must use the diary tools. Documents are the shareable design, development, and knowledge domains and must use document tools. Desktop is not a file manager: read_file_names returns only first-level folder names and loose-file metadata, never folder contents or file contents. Analyze only loose files, treat existing first-level folders as user-defined categories, and prefer Default when classification confidence is low. Present a complete organization proposal and wait for explicit user approval before calling move_files. Never move a folder, rename a file, authorize an arbitrary folder, cross domains, or invent storage paths. The native helper presents one summary confirmation for the approved batch and automatically numbers duplicate destination names without overwriting.`
  });
  registerBellyHomeTools(server, {
    client,
    timeZone,
    diary,
    documents,
    auditLog,
    desktop,
    desktopAuditLog
  });
  return server;
}
