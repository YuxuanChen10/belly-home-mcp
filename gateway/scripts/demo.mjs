import { randomUUID } from "node:crypto";
import { getBellyHomeBaseUrl } from "../src/config.mjs";

const baseUrl = getBellyHomeBaseUrl();
const adminToken = process.env.ALARM_GATEWAY_TOKEN || "dev-admin-token";

async function request(path, { token = adminToken, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...options.headers }
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value;
}

const pairing = await request("/v1/pairing/start", { method: "POST" });
const device = await request("/v1/devices/pair", {
  token: "",
  method: "POST",
  body: JSON.stringify({ code: pairing.code, name: "Demo iPhone" })
});
const fireAt = new Date(Date.now() + 10 * 60_000).toISOString();
const created = await request("/v1/alarms", {
  method: "POST",
  body: JSON.stringify({
    deviceId: device.deviceId,
    label: "Gateway demo",
    schedule: { kind: "once", fireAt },
    idempotencyKey: randomUUID()
  })
});
const inbox = await request("/v1/device/commands?after=0", { token: device.deviceToken });
const command = inbox.commands.find((item) => item.alarmId === created.alarm.id);
if (!command) throw new Error("device command was not queued");
await request(`/v1/device/commands/${command.id}/ack`, {
  token: device.deviceToken,
  method: "POST",
  body: JSON.stringify({ success: true, message: "Simulated AlarmKit success" })
});
const final = await request(`/v1/alarms/${created.alarm.id}`);
if (final.alarm.status !== "scheduled") throw new Error(`unexpected status: ${final.alarm.status}`);

console.log(JSON.stringify({ device, created: created.alarm, final: final.alarm }, null, 2));
