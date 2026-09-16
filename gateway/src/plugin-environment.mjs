import { CreateAlarmGatewayClient } from "./gateway-client.mjs";
import { AuditLog } from "./audit-log.mjs";
import { DiaryStore } from "./diary-store.mjs";

export function createPluginDependencies(environment = process.env) {
  const baseUrl = environment.ALARM_GATEWAY_URL || "http://127.0.0.1:8787";
  const token = environment.ALARM_PLUGIN_TOKEN;
  const timeZone = environment.ALARM_TIMEZONE || "Australia/Melbourne";
  const diaryRootDirectory = environment.DIARY_ROOT_DIR;
  const diaryLogFile = environment.DIARY_LOG_FILE;

  if (!token) throw new Error("ALARM_PLUGIN_TOKEN is required for the create-only MCP server");

  return {
    client: new CreateAlarmGatewayClient({ baseUrl, token }),
    timeZone,
    diary: new DiaryStore({ rootDirectory: diaryRootDirectory, timeZone }),
    auditLog: new AuditLog({ file: diaryLogFile })
  };
}
