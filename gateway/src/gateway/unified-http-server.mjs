import { createServer } from "node:http";

export function createUnifiedHttpServer({ gatewayHandler, mcpHandler }) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://belly-home.local");
    if (url.pathname === "/mcp") {
      const address = request.socket.remoteAddress;
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) {
        response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        response.end('{"error":"forbidden"}\n');
        return;
      }
      return mcpHandler(request, response);
    }
    const startedAt = Date.now();
    response.once("finish", () => {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        category: "alarm_http",
        event: "response",
        method: request.method || "GET",
        path: url.pathname,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      }));
    });
    return gatewayHandler(request, response);
  });

  server.on("close", () => void mcpHandler.close());
  return server;
}
