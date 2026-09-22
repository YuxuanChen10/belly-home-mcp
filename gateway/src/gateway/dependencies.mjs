import { CreateAlarmGatewayClient } from "../modules/automation/alarm/client.mjs";
import { AuditLog } from "../modules/memory/audit-log.mjs";
import { DiaryStore } from "../modules/memory/diary/store.mjs";
import { DocumentStore } from "../modules/memory/document/store.mjs";
import { DesktopHelperClient } from "../modules/desktop/helper-client.mjs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getBellyHomeBaseUrl } from "../common/config.mjs";

export function createPluginDependencies(environment = process.env) {
  const baseUrl = getBellyHomeBaseUrl(environment);
  const token = environment.ALARM_PLUGIN_TOKEN;
  const timeZone = environment.ALARM_TIMEZONE || "Australia/Melbourne";
  const diaryRootDirectory = environment.DIARY_ROOT_DIR;
  const documentRootDirectory = environment.BELLY_HOME_ROOT_DIR || (diaryRootDirectory ? dirname(diaryRootDirectory) : undefined);
  const diaryLogFile = environment.DIARY_LOG_FILE;
  const desktopLogFile = environment.DESKTOP_LOG_FILE
    || join(homedir(), "Library", "Logs", "Belly Home Infra", "desktop-mcp.log");

  if (!token) throw new Error("ALARM_PLUGIN_TOKEN is required for the create-only MCP server");

  return {
    client: new CreateAlarmGatewayClient({ baseUrl, token }),
    timeZone,
    diary: new DiaryStore({ rootDirectory: diaryRootDirectory, timeZone }),
    documents: new DocumentStore({ rootDirectory: documentRootDirectory, timeZone }),
    auditLog: new AuditLog({ file: diaryLogFile }),
    desktop: new DesktopHelperClient(environment.BELLY_DESKTOP_HELPER_PATH
      ? { helperPath: environment.BELLY_DESKTOP_HELPER_PATH }
      : undefined),
    desktopAuditLog: new AuditLog({ file: desktopLogFile })
  };
}
