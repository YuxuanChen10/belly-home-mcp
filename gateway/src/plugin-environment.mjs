import { CreateAlarmGatewayClient } from "./gateway-client.mjs";
import { AuditLog } from "./audit-log.mjs";
import { DiaryStore } from "./diary-store.mjs";
import { DocumentStore } from "./document-store.mjs";
import { dirname } from "node:path";
import { getBellyHomeBaseUrl } from "./config.mjs";

export function createPluginDependencies(environment = process.env) {
  const baseUrl = getBellyHomeBaseUrl(environment);
  const token = environment.ALARM_PLUGIN_TOKEN;
  const timeZone = environment.ALARM_TIMEZONE || "Australia/Melbourne";
  const diaryRootDirectory = environment.DIARY_ROOT_DIR;
  const documentRootDirectory = environment.BELLY_HOME_ROOT_DIR || (diaryRootDirectory ? dirname(diaryRootDirectory) : undefined);
  const diaryLogFile = environment.DIARY_LOG_FILE;

  if (!token) throw new Error("ALARM_PLUGIN_TOKEN is required for the create-only MCP server");

  return {
    client: new CreateAlarmGatewayClient({ baseUrl, token }),
    timeZone,
    diary: new DiaryStore({ rootDirectory: diaryRootDirectory, timeZone }),
    documents: new DocumentStore({ rootDirectory: documentRootDirectory, timeZone }),
    auditLog: new AuditLog({ file: diaryLogFile })
  };
}
