const baseUrl = (process.env.ALARM_GATEWAY_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const token = process.env.ALARM_GATEWAY_TOKEN || "dev-admin-token";
const response = await fetch(`${baseUrl}/v1/pairing/start`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
});
const value = await response.json();
if (!response.ok) throw new Error(value.error?.message || "failed to create pairing code");
console.log(`Pairing code: ${value.code}`);
console.log(`Expires at: ${value.expiresAt}`);
