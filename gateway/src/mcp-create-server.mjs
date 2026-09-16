import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAlarmMcpServer } from "./create-alarm-mcp.mjs";
import { createPluginDependencies } from "./plugin-environment.mjs";

const server = createAlarmMcpServer(createPluginDependencies());
await server.connect(new StdioServerTransport());
