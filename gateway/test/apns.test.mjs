import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";
import { ApnsNotifier } from "../src/apns.mjs";

test("APNs configuration is optional", () => {
  assert.equal(ApnsNotifier.fromEnvironment({}), null);
});

test("APNs notifier creates and caches a valid ES256 provider token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alarm-apns-"));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privatePEM = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPEM = publicKey.export({ type: "spki", format: "pem" });
  const keyFile = join(directory, "AuthKey_TEST.p8");
  await writeFile(keyFile, privatePEM);
  const notifier = new ApnsNotifier({
    keyFile,
    keyId: "KEY123",
    teamId: "TEAM123",
    topic: "com.example.AlarmGateway",
    environment: "development"
  });

  const first = await notifier.authorizationToken();
  const second = await notifier.authorizationToken();
  assert.equal(first, second);
  assert.deepEqual(decodeProtectedHeader(first), { alg: "ES256", kid: "KEY123" });
  const verificationKey = await importSPKI(publicPEM, "ES256");
  const verified = await jwtVerify(first, verificationKey, { issuer: "TEAM123" });
  assert.equal(verified.payload.iss, "TEAM123");
});

test("APNs notifier skips devices without a push token", async () => {
  const notifier = new ApnsNotifier({
    keyFile: "/not/read/without/a/token",
    keyId: "KEY123",
    teamId: "TEAM123",
    topic: "com.example.AlarmGateway",
    environment: "development"
  });
  assert.deepEqual(await notifier.notifyDevice({ pushToken: null }), {
    skipped: true,
    reason: "device has no APNs token"
  });
});
