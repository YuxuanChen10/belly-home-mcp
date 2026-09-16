import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createNodeServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const MAX_LOGGED_BODY_BYTES = 1_000_000;

function equalSecret(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id, accept"
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function logLifecycle(logger, event, fields = {}) {
  logger.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    category: "mcp_http",
    event,
    ...fields
  }));
}

function logError(logger, event, error, fields = {}) {
  logger.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    category: "mcp_http",
    event,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...fields
  }));
}

function summarizeRpcBody(body) {
  const messages = Array.isArray(body) ? body : [body];
  return messages
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      id: Object.hasOwn(message, "id") ? message.id : undefined,
      method: typeof message.method === "string" ? message.method : undefined,
      toolName: message.method === "tools/call" && typeof message.params?.name === "string"
        ? message.params.name
        : undefined,
      hasParams: Boolean(message.params)
    }));
}

function bodyHasInitialize(body) {
  return summarizeRpcBody(body).some((message) => message.method === "initialize");
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_LOGGED_BODY_BYTES) {
      throw new Error(`MCP request body exceeds ${MAX_LOGGED_BODY_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return undefined;
  }
  return JSON.parse(text);
}

export function createMcpHttpServer({ createMcpServer, bearerToken = null, logger = console }) {
  const sessions = new Map();

  async function closeSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }
    sessions.delete(sessionId);
    try {
      await session.transport.close();
    } catch {
      // Transport may already be closing.
    }
    await session.server.close();
    logLifecycle(logger, "session_closed", { sessionId, sessions: sessions.size });
  }

  async function createSessionTransport() {
    const server = createMcpServer();
    let sessionId = null;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (initializedSessionId) => {
        sessionId = initializedSessionId;
        sessions.set(initializedSessionId, { server, transport });
        logLifecycle(logger, "session_created", { sessionId: initializedSessionId, sessions: sessions.size });
      },
      onsessionclosed: (closedSessionId) => {
        sessions.delete(closedSessionId);
        logLifecycle(logger, "session_closed", { sessionId: closedSessionId, sessions: sessions.size });
      }
    });

    transport.onerror = (error) => {
      logError(logger, "transport_error", error, { sessionId });
    };
    transport.onclose = () => {
      if (sessionId) {
        sessions.delete(sessionId);
      }
      void server.close();
      logLifecycle(logger, "transport_closed", { sessionId, sessions: sessions.size });
    };

    await server.connect(transport);
    return transport;
  }

  const httpServer = createNodeServer(async (request, response) => {
    console.log("REQUEST ARRIVED");
    const requestId = randomUUID();
    const startedAt = Date.now();
    const url = new URL(request.url, "http://mcp.local");
    const sessionId = request.headers["mcp-session-id"];
    response.on("finish", () => {
      logLifecycle(logger, "response", {
        requestId,
        method: request.method,
        path: url.pathname,
        sessionId,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      });
    });
    logLifecycle(logger, "request", {
      requestId,
      method: request.method,
      path: url.pathname,
      sessionId,
      protocolVersion: request.headers["mcp-protocol-version"],
      accept: request.headers.accept,
      contentType: request.headers["content-type"]
    });
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, service: "belly-home-mcp" });
    }
    if (url.pathname !== "/mcp") {
      return json(response, 404, { error: "not_found" });
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id, accept",
        "access-control-max-age": "86400"
      });
      return response.end();
    }
    if (bearerToken && !equalSecret(request.headers.authorization, `Bearer ${bearerToken}`)) {
      response.setHeader("www-authenticate", "Bearer");
      return json(response, 401, { error: "unauthorized" });
    }
    if (!["GET", "POST", "DELETE"].includes(request.method)) {
      return json(response, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null
      });
    }

    try {
      let transport;
      let transientTransport = false;
      let parsedBody;
      if (request.method === "POST") {
        parsedBody = await readJsonBody(request);
        logLifecycle(logger, "rpc_messages", {
          requestId,
          sessionId,
          hasInitialize: bodyHasInitialize(parsedBody),
          messages: summarizeRpcBody(parsedBody)
        });
      }

      if (sessionId) {
        transport = sessions.get(sessionId)?.transport;
        if (!transport) {
          if (request.method === "GET") {
            logLifecycle(logger, "session_missing_get", { requestId, sessionId });
            response.setHeader("allow", "POST");
            return json(response, 405, {
              jsonrpc: "2.0",
              error: { code: -32000, message: "Method not allowed" },
              id: null
            });
          }
          if (request.method === "POST") {
            logLifecycle(logger, "session_missing_post", {
              requestId,
              sessionId,
              hasInitialize: bodyHasInitialize(parsedBody)
            });
            transport = await createSessionTransport();
            transientTransport = true;
          } else {
            logLifecycle(logger, "session_missing_delete", { requestId, sessionId });
            return json(response, 404, {
              jsonrpc: "2.0",
              error: { code: -32001, message: "Session not found" },
              id: null
            });
          }
        }
        logLifecycle(logger, "session_reused", { requestId, sessionId });
      } else if (request.method === "POST") {
        logLifecycle(logger, "session_new_post", {
          requestId,
          hasInitialize: bodyHasInitialize(parsedBody)
        });
        transport = await createSessionTransport();
        transientTransport = true;
      } else if (request.method === "GET") {
        logLifecycle(logger, "get_without_session", { requestId });
        response.setHeader("allow", "POST");
        return json(response, 405, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed" },
          id: null
        });
      } else {
        logLifecycle(logger, "delete_without_session", { requestId });
        return json(response, 400, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: Mcp-Session-Id header is required" },
          id: null
        });
      }

      logLifecycle(logger, "transport_handle_start", {
        requestId,
        sessionId: transport.sessionId ?? sessionId,
        transientTransport
      });
      await transport.handleRequest(request, response, parsedBody);
      logLifecycle(logger, "transport_handle_done", {
        requestId,
        sessionId: transport.sessionId ?? sessionId,
        transientTransport
      });
      if (transientTransport && !transport.sessionId) {
        logLifecycle(logger, "transient_transport_close", { requestId });
        await transport.close();
      }
    } catch (error) {
      logError(logger, "request_exception", error, { requestId, method: request.method, path: url.pathname, sessionId });
      if (!response.headersSent) {
        json(response, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });

  httpServer.on("close", () => {
    for (const sessionId of sessions.keys()) {
      void closeSession(sessionId);
    }
  });

  return httpServer;
}
