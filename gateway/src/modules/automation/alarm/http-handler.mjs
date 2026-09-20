import { timingSafeEqual } from "node:crypto";
import { HttpError, invariant } from "../../../common/errors.mjs";
import { bearerToken } from "./store.mjs";
import { parseAlarmPatch, parseCreateAlarm, parsePluginCreateAlarm } from "./validation.mjs";

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    invariant(size <= 64 * 1024, 413, "body_too_large", "request body exceeds 64 KiB");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "request body must be valid JSON");
  }
}

function equalSecret(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHandler({
  store,
  adminToken,
  notifier = null,
  pluginToken = null,
  pluginDeviceId = null,
  pluginRateLimitPerMinute = 6
}) {
  const requireAdmin = (request) => invariant(equalSecret(bearerToken(request), adminToken), 401, "unauthorized", "invalid admin token");
  const requirePlugin = (request) => {
    invariant(pluginToken && pluginDeviceId, 503, "plugin_not_configured", "alarm plugin is not configured");
    invariant(equalSecret(bearerToken(request), pluginToken), 401, "unauthorized", "invalid plugin token");
  };
  let pluginCalls = [];
  const requirePluginCapacity = () => {
    const cutoff = Date.now() - 60_000;
    pluginCalls = pluginCalls.filter((timestamp) => timestamp > cutoff);
    invariant(pluginCalls.length < pluginRateLimitPerMinute, 429, "rate_limited", "too many alarm creation requests; try again shortly");
    pluginCalls.push(Date.now());
  };
  const wakeDevice = (deviceId) => {
    if (!notifier) return;
    void notifier.notifyDevice(store.getDevice(deviceId)).catch((error) => console.error("APNs wake failed:", error.message));
  };

  return async function handler(request, response) {
    try {
      const url = new URL(request.url, "http://gateway.local");
      const method = request.method || "GET";

      if (method === "GET" && url.pathname === "/health") {
        return json(response, 200, { ok: true, service: "alarm-gateway" });
      }

      if (method === "POST" && url.pathname === "/v1/pairing/start") {
        requireAdmin(request);
        const pairing = await store.createPairing();
        return json(response, 201, pairing);
      }

      if (method === "POST" && url.pathname === "/v1/devices/pair") {
        const input = await body(request);
        invariant(typeof input.code === "string" && typeof input.name === "string", 400, "invalid_request", "code and name are required");
        const device = await store.pairDevice({ code: input.code.trim(), name: input.name.trim().slice(0, 80) });
        return json(response, 201, { deviceId: device.id, deviceToken: device.token, name: device.name });
      }

      if (method === "GET" && url.pathname === "/v1/devices") {
        requireAdmin(request);
        return json(response, 200, { devices: store.state.devices.map((device) => store.publicDevice(device)) });
      }

      if (method === "POST" && url.pathname === "/v1/plugin/alarms") {
        requirePlugin(request);
        const input = parsePluginCreateAlarm(await body(request), pluginDeviceId);
        requirePluginCapacity();
        const result = await store.createAlarm(input);
        if (!result.replayed) wakeDevice(result.alarm.deviceId);
        return json(response, result.replayed ? 200 : 202, {
          replayed: result.replayed,
          alarm: {
            id: result.alarm.id,
            status: result.alarm.status,
            label: result.alarm.label,
            schedule: result.alarm.schedule
          }
        });
      }

      if (method === "POST" && url.pathname === "/v1/alarms") {
        requireAdmin(request);
        const result = await store.createAlarm(parseCreateAlarm(await body(request)));
        if (!result.replayed) wakeDevice(result.alarm.deviceId);
        return json(response, result.replayed ? 200 : 202, result);
      }

      if (method === "GET" && url.pathname === "/v1/alarms") {
        requireAdmin(request);
        const deviceId = url.searchParams.get("deviceId");
        invariant(deviceId, 400, "invalid_request", "deviceId query parameter is required");
        return json(response, 200, { alarms: store.listAlarms(deviceId, url.searchParams.get("includeCancelled") === "true") });
      }

      const alarmMatch = /^\/v1\/alarms\/([^/]+)$/.exec(url.pathname);
      if (alarmMatch && method === "GET") {
        requireAdmin(request);
        return json(response, 200, { alarm: store.getAlarm(alarmMatch[1]) });
      }
      if (alarmMatch && method === "PATCH") {
        requireAdmin(request);
        const result = await store.updateAlarm(alarmMatch[1], parseAlarmPatch(await body(request)));
        wakeDevice(result.alarm.deviceId);
        return json(response, 202, result);
      }
      if (alarmMatch && method === "DELETE") {
        requireAdmin(request);
        const result = await store.cancelAlarm(alarmMatch[1]);
        if (result.command) wakeDevice(result.alarm.deviceId);
        return json(response, 202, result);
      }

      if (method === "POST" && url.pathname === "/v1/device/push-token") {
        const device = store.authenticateDevice(bearerToken(request));
        const input = await body(request);
        invariant(typeof input.pushToken === "string" && /^[0-9a-f]{64,}$/.test(input.pushToken), 400, "invalid_request", "pushToken must be a lowercase hexadecimal APNs token");
        await store.updatePushToken(device, input.pushToken);
        return json(response, 200, { ok: true });
      }

      if (method === "GET" && url.pathname === "/v1/device/commands") {
        const device = store.authenticateDevice(bearerToken(request));
        const after = Number.parseInt(url.searchParams.get("after") || "0", 10);
        invariant(Number.isInteger(after) && after >= 0, 400, "invalid_request", "after must be a non-negative integer");
        return json(response, 200, await store.commandsForDevice(device, after));
      }

      const ackMatch = /^\/v1\/device\/commands\/([^/]+)\/ack$/.exec(url.pathname);
      if (ackMatch && method === "POST") {
        const device = store.authenticateDevice(bearerToken(request));
        const input = await body(request);
        invariant(typeof input.success === "boolean", 400, "invalid_request", "success must be a boolean");
        const command = await store.acknowledge(device, ackMatch[1], {
          success: input.success,
          message: typeof input.message === "string" ? input.message.slice(0, 500) : null
        });
        return json(response, 200, { command });
      }

      throw new HttpError(404, "not_found", "route not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      json(response, status, {
        error: {
          code: error instanceof HttpError ? error.code : "internal_error",
          message: error instanceof HttpError ? error.message : "internal server error",
          ...(error instanceof HttpError && error.details ? { details: error.details } : {})
        }
      });
    }
  };
}
