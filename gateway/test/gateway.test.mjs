import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createHandler } from "../src/app.mjs";
import { GatewayStore } from "../src/store.mjs";

let server;
let baseUrl;
let store;
const adminToken = "test-admin-token";
const pluginToken = "test-plugin-token";

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), "alarm-gateway-"));
  store = await new GatewayStore(join(directory, "store.json")).load();
  server = createServer(createHandler({ store, adminToken, pluginToken, pluginDeviceId: null }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function request(path, { token = adminToken, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: token ? `Bearer ${token}` : "", "content-type": "application/json", ...options.headers }
  });
  return { status: response.status, body: await response.json() };
}

async function pair() {
  const pairing = await request("/v1/pairing/start", { method: "POST" });
  const paired = await request("/v1/devices/pair", {
    token: "",
    method: "POST",
    body: JSON.stringify({ code: pairing.body.code, name: "Test iPhone" })
  });
  return paired.body;
}

test("create, synchronize, acknowledge, and cancel an alarm", async () => {
  const device = await pair();
  const badPushToken = await request("/v1/device/push-token", {
    token: device.deviceToken,
    method: "POST",
    body: JSON.stringify({ pushToken: "not-a-token" })
  });
  assert.equal(badPushToken.status, 400);

  const pushToken = await request("/v1/device/push-token", {
    token: device.deviceToken,
    method: "POST",
    body: JSON.stringify({ pushToken: "a".repeat(64) })
  });
  assert.equal(pushToken.status, 200);

  const createInput = {
    deviceId: device.deviceId,
    label: "Wake up",
    schedule: { kind: "once", fireAt: new Date(Date.now() + 3_600_000).toISOString() },
    idempotencyKey: "request-1"
  };
  const created = await request("/v1/alarms", { method: "POST", body: JSON.stringify(createInput) });
  assert.equal(created.status, 202);
  assert.equal(created.body.alarm.status, "queued");

  const replay = await request("/v1/alarms", { method: "POST", body: JSON.stringify(createInput) });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.alarm.id, created.body.alarm.id);

  const commands = await request("/v1/device/commands?after=0", { token: device.deviceToken });
  assert.equal(commands.body.commands.length, 1);
  const command = commands.body.commands[0];
  const ack = await request(`/v1/device/commands/${command.id}/ack`, {
    token: device.deviceToken,
    method: "POST",
    body: JSON.stringify({ success: true })
  });
  assert.equal(ack.status, 200);

  const scheduled = await request(`/v1/alarms/${created.body.alarm.id}`);
  assert.equal(scheduled.body.alarm.status, "scheduled");

  const cancelling = await request(`/v1/alarms/${created.body.alarm.id}`, { method: "DELETE" });
  assert.equal(cancelling.body.alarm.status, "cancelling");
  const cancelCommands = await request(`/v1/device/commands?after=${command.revision}`, { token: device.deviceToken });
  assert.equal(cancelCommands.body.commands[0].action, "cancel");
});

test("rejects unauthorized and invalid alarm requests", async () => {
  const unauthorized = await request("/v1/devices", { token: "wrong" });
  assert.equal(unauthorized.status, 401);

  const device = await pair();
  const invalid = await request("/v1/alarms", {
    method: "POST",
    body: JSON.stringify({
      deviceId: device.deviceId,
      label: "Past alarm",
      schedule: { kind: "once", fireAt: "2020-01-01T00:00:00Z" },
      idempotencyKey: "past"
    })
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "alarm_in_past");
});

test("create-only endpoint is scoped to one device and one-time alarm creation", async () => {
  const device = await pair();
  await new Promise((resolve) => server.close(resolve));
  server = createServer(createHandler({
    store,
    adminToken,
    pluginToken,
    pluginDeviceId: device.deviceId,
    pluginRateLimitPerMinute: 2
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const fireAt = new Date(Date.now() + 3_600_000).toISOString();
  const input = { label: "Plugin test", fireAt, idempotencyKey: "plugin-create-1" };
  const created = await request("/v1/plugin/alarms", {
    token: pluginToken,
    method: "POST",
    body: JSON.stringify(input)
  });
  assert.equal(created.status, 202);
  assert.equal(created.body.alarm.deviceId, undefined);
  assert.equal(store.getAlarm(created.body.alarm.id).deviceId, device.deviceId);
  assert.equal(created.body.alarm.schedule.kind, "once");

  const replayed = await request("/v1/plugin/alarms", {
    token: pluginToken,
    method: "POST",
    body: JSON.stringify(input)
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.alarm.id, created.body.alarm.id);

  const injected = await request("/v1/plugin/alarms", {
    token: pluginToken,
    method: "POST",
    body: JSON.stringify({ ...input, idempotencyKey: "plugin-create-2", deviceId: "another-device" })
  });
  assert.equal(injected.status, 400);

  const rateLimited = await request("/v1/plugin/alarms", {
    token: pluginToken,
    method: "POST",
    body: JSON.stringify({ ...input, idempotencyKey: "plugin-create-3" })
  });
  assert.equal(rateLimited.status, 429);

  const adminOnly = await request("/v1/devices", { token: pluginToken });
  assert.equal(adminOnly.status, 401);
});

test("an older acknowledgement cannot overwrite a newer command state", async () => {
  const device = await pair();
  const created = await request("/v1/alarms", {
    method: "POST",
    body: JSON.stringify({
      deviceId: device.deviceId,
      label: "First",
      schedule: { kind: "once", fireAt: new Date(Date.now() + 3_600_000).toISOString() },
      idempotencyKey: "ordering"
    })
  });
  const updated = await request(`/v1/alarms/${created.body.alarm.id}`, {
    method: "PATCH",
    body: JSON.stringify({ label: "Latest" })
  });
  const commands = await request("/v1/device/commands?after=0", { token: device.deviceToken });
  await request(`/v1/device/commands/${commands.body.commands[0].id}/ack`, {
    token: device.deviceToken,
    method: "POST",
    body: JSON.stringify({ success: true })
  });
  const alarm = await request(`/v1/alarms/${created.body.alarm.id}`);
  assert.equal(alarm.body.alarm.status, "queued");
  assert.equal(alarm.body.alarm.pendingRevision, updated.body.command.revision);
});
