import { resolve } from "node:path";
import { createHandler } from "../modules/automation/alarm/http-handler.mjs";
import { ApnsNotifier } from "../modules/automation/alarm/apns.mjs";
import { GatewayStore } from "../modules/automation/alarm/store.mjs";
import { getBellyHomePort } from "../common/config.mjs";
import { createBellyHomeMcpServer } from "./server.mjs";
import { createMcpHttpHandler } from "./mcp-http-app.mjs";
import { createPluginDependencies } from "./dependencies.mjs";
import { createUnifiedHttpServer } from "./unified-http-server.mjs";

const port = getBellyHomePort();
const host = process.env.HOST || "0.0.0.0";
const adminToken = process.env.ALARM_GATEWAY_TOKEN || "dev-admin-token";
const pluginToken = process.env.ALARM_PLUGIN_TOKEN || null;
const pluginDeviceId = process.env.ALARM_DEVICE_ID || null;
const configuredPluginRateLimit = Number.parseInt(process.env.ALARM_PLUGIN_RATE_LIMIT || "6", 10);
const pluginRateLimitPerMinute = Number.isInteger(configuredPluginRateLimit) && configuredPluginRateLimit > 0
  ? configuredPluginRateLimit
  : 6;
const dataFile = resolve(process.env.ALARM_DATA_FILE || "./data/gateway.json");
const store = await new GatewayStore(dataFile).load();
const notifier = ApnsNotifier.fromEnvironment();
const gatewayHandler = createHandler({
  store,
  adminToken,
  notifier,
  pluginToken,
  pluginDeviceId,
  pluginRateLimitPerMinute
});
const mcpHandler = createMcpHttpHandler({
  createMcpServer: () => createBellyHomeMcpServer(createPluginDependencies())
});
const server = createUnifiedHttpServer({ gatewayHandler, mcpHandler });

server.listen(port, host, () => {
  console.log(`Belly Home Gateway and MCP listening at http://${host}:${port}`);
  console.log(`MCP endpoint: http://${host}:${port}/mcp`);
  console.log(notifier ? "APNs wake-up enabled" : "APNs wake-up disabled; use foreground sync");
  console.log(pluginToken && pluginDeviceId ? "Create-only plugin endpoint enabled" : "Create-only plugin endpoint disabled");
  if (adminToken === "dev-admin-token") console.warn("Using development admin token; do not expose this server to the internet.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
