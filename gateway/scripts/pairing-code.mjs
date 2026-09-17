import { getBellyHomeBaseUrl } from "../src/config.mjs";

const baseUrl = getBellyHomeBaseUrl();
const token = process.env.ALARM_GATEWAY_TOKEN || "dev-admin-token";
const response = await fetch(`${baseUrl}/v1/pairing/start`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }
});
const value = await response.json();
if (!response.ok) throw new Error(value.error?.message || "failed to create pairing code");
console.log(`Pairing code: ${value.code}`);
console.log(`Expires at: ${value.expiresAt}`);
