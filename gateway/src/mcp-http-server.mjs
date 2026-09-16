import { createAlarmMcpServer } from "./create-alarm-mcp.mjs";
import { createMcpHttpServer } from "./mcp-http-app.mjs";
import { createPluginDependencies } from "./plugin-environment.mjs";

const host = process.env.ALARM_MCP_HTTP_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.ALARM_MCP_HTTP_PORT || "8790", 10);
const bearerToken = process.env.ALARM_MCP_BEARER_TOKEN || null;
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

if (!loopbackHosts.has(host) && !bearerToken) {
  throw new Error("ALARM_MCP_BEARER_TOKEN is required when the MCP HTTP server is not bound to loopback");
}

const dependencies = createPluginDependencies();
const server = createMcpHttpServer({
  createMcpServer: () => createAlarmMcpServer(dependencies),
  bearerToken
});

server.listen(port, host, () => {
  console.log(`Create-only Alarm MCP listening at http://${host}:${port}/mcp`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
