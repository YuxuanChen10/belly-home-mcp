import { readFile } from "node:fs/promises";
import http2 from "node:http2";
import { importPKCS8, SignJWT } from "jose";

export class ApnsNotifier {
  constructor({ keyFile, keyId, teamId, topic, environment }) {
    this.keyFile = keyFile;
    this.keyId = keyId;
    this.teamId = teamId;
    this.topic = topic;
    this.environment = environment;
    this.cachedJWT = null;
    this.cachedAt = 0;
    this.privateKey = null;
  }

  static fromEnvironment(environment = process.env) {
    const values = {
      keyFile: environment.APNS_KEY_FILE,
      keyId: environment.APNS_KEY_ID,
      teamId: environment.APNS_TEAM_ID,
      topic: environment.APNS_TOPIC,
      environment: environment.APNS_ENVIRONMENT || "development"
    };
    if (!values.keyFile || !values.keyId || !values.teamId || !values.topic) return null;
    return new ApnsNotifier(values);
  }

  async authorizationToken() {
    if (this.cachedJWT && Date.now() - this.cachedAt < 50 * 60_000) return this.cachedJWT;
    if (!this.privateKey) {
      this.privateKey = await importPKCS8(await readFile(this.keyFile, "utf8"), "ES256");
    }
    this.cachedAt = Date.now();
    this.cachedJWT = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.keyId })
      .setIssuer(this.teamId)
      .setIssuedAt()
      .sign(this.privateKey);
    return this.cachedJWT;
  }

  async notifyDevice(device) {
    if (!device.pushToken) return { skipped: true, reason: "device has no APNs token" };
    const authority = this.environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
    const jwt = await this.authorizationToken();
    const client = http2.connect(authority);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.destroy();
        reject(new Error("APNs request timed out"));
      }, 10_000);
      client.once("error", (error) => {
        clearTimeout(timeout);
        client.destroy();
        reject(error);
      });
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${device.pushToken}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": this.topic,
        "apns-push-type": "background",
        "apns-priority": "5",
        "content-type": "application/json"
      });
      const chunks = [];
      let status = 0;
      request.on("response", (headers) => { status = Number(headers[":status"]); });
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("error", (error) => {
        clearTimeout(timeout);
        client.close();
        reject(error);
      });
      request.on("end", () => {
        clearTimeout(timeout);
        client.close();
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if (status === 200) resolve({ delivered: true });
        else reject(new Error(`APNs returned ${status}: ${responseBody || "no response body"}`));
      });
      request.end(JSON.stringify({ aps: { "content-available": 1 }, reason: "alarm-command" }));
    });
  }
}
