import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpError, invariant } from "../../../common/errors.mjs";

function now() {
  return new Date().toISOString();
}

function secret(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class GatewayStore {
  constructor(file) {
    this.file = file;
    this.state = { version: 1, revision: 0, pairings: [], devices: [], alarms: [], commands: [] };
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.persist();
    }
    return this;
  }

  async persist() {
    const operation = async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.file);
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    return this.writeQueue;
  }

  nextRevision() {
    this.state.revision += 1;
    return this.state.revision;
  }

  async createPairing() {
    const pairing = {
      code: `${randomInt(100000, 1_000_000)}`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      usedAt: null
    };
    this.state.pairings.push(pairing);
    await this.persist();
    return pairing;
  }

  async pairDevice({ code, name }) {
    const pairing = this.state.pairings.find((item) => item.code === code && !item.usedAt);
    invariant(pairing, 400, "invalid_pairing_code", "pairing code is invalid");
    invariant(Date.parse(pairing.expiresAt) > Date.now(), 400, "expired_pairing_code", "pairing code has expired");
    invariant(typeof name === "string" && name.length > 0, 400, "invalid_request", "device name is required");
    pairing.usedAt = now();
    const device = { id: randomUUID(), name, token: secret(), pushToken: null, createdAt: now(), lastSeenAt: now() };
    this.state.devices.push(device);
    await this.persist();
    return device;
  }

  authenticateDevice(token) {
    const device = this.state.devices.find((item) => safeEqual(item.token, token));
    invariant(device, 401, "unauthorized", "invalid device token");
    return device;
  }

  getDevice(id) {
    const device = this.state.devices.find((item) => item.id === id);
    invariant(device, 404, "device_not_found", "device not found");
    return device;
  }

  publicDevice(device) {
    const { token, pushToken, ...publicFields } = device;
    return publicFields;
  }

  async updatePushToken(device, pushToken) {
    device.pushToken = pushToken;
    device.lastSeenAt = now();
    await this.persist();
  }

  async createAlarm(input) {
    this.getDevice(input.deviceId);
    const existing = this.state.alarms.find((item) => item.deviceId === input.deviceId && item.idempotencyKey === input.idempotencyKey);
    if (existing) return { alarm: existing, command: null, replayed: true };

    const timestamp = now();
    const alarm = {
      id: randomUUID(),
      deviceId: input.deviceId,
      label: input.label,
      schedule: input.schedule,
      status: "queued",
      statusMessage: "Waiting for iPhone synchronization",
      pendingRevision: null,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.state.alarms.push(alarm);
    const command = this.enqueueCommand(alarm.deviceId, "upsert", alarm);
    alarm.pendingRevision = command.revision;
    await this.persist();
    return { alarm, command, replayed: false };
  }

  listAlarms(deviceId, includeCancelled = false) {
    this.getDevice(deviceId);
    return this.state.alarms.filter((alarm) => alarm.deviceId === deviceId && (includeCancelled || alarm.status !== "cancelled"));
  }

  getAlarm(id) {
    const alarm = this.state.alarms.find((item) => item.id === id);
    invariant(alarm, 404, "alarm_not_found", "alarm not found");
    return alarm;
  }

  async updateAlarm(id, patch) {
    const alarm = this.getAlarm(id);
    invariant(alarm.status !== "cancelled", 409, "alarm_cancelled", "cancelled alarm cannot be updated");
    Object.assign(alarm, patch, {
      status: "queued",
      statusMessage: "Waiting for iPhone synchronization",
      updatedAt: now()
    });
    const command = this.enqueueCommand(alarm.deviceId, "upsert", alarm);
    alarm.pendingRevision = command.revision;
    await this.persist();
    return { alarm, command };
  }

  async cancelAlarm(id) {
    const alarm = this.getAlarm(id);
    if (alarm.status === "cancelled") return { alarm, command: null };
    alarm.status = "cancelling";
    alarm.statusMessage = "Waiting for iPhone synchronization";
    alarm.updatedAt = now();
    const command = this.enqueueCommand(alarm.deviceId, "cancel", alarm);
    alarm.pendingRevision = command.revision;
    await this.persist();
    return { alarm, command };
  }

  enqueueCommand(deviceId, action, alarm) {
    const revision = this.nextRevision();
    const command = {
      id: randomUUID(),
      revision,
      deviceId,
      action,
      alarmId: alarm.id,
      alarm: action === "upsert" ? {
        id: alarm.id,
        label: alarm.label,
        schedule: alarm.schedule
      } : null,
      createdAt: now(),
      acknowledgedAt: null,
      result: null
    };
    this.state.commands.push(command);
    return command;
  }

  async commandsForDevice(device, after) {
    device.lastSeenAt = now();
    // An unacknowledged command is authoritative. A client cursor can be ahead
    // after a restore or migration, and must never strand pending work.
    const commands = this.state.commands.filter((item) => item.deviceId === device.id && !item.acknowledgedAt);
    const latestRevision = this.state.commands
      .filter((item) => item.deviceId === device.id)
      .reduce((latest, item) => Math.max(latest, item.revision), 0);
    await this.persist();
    return { commands, latestRevision };
  }

  async acknowledge(device, commandId, result) {
    const command = this.state.commands.find((item) => item.id === commandId && item.deviceId === device.id);
    invariant(command, 404, "command_not_found", "command not found");
    if (command.acknowledgedAt) return command;
    command.acknowledgedAt = now();
    command.result = result;
    const alarm = this.getAlarm(command.alarmId);
    if (command.revision !== alarm.pendingRevision) {
      await this.persist();
      return command;
    }
    alarm.pendingRevision = null;
    if (result.success) {
      alarm.status = command.action === "cancel" ? "cancelled" : "scheduled";
      alarm.statusMessage = command.action === "cancel" ? "Cancelled on iPhone" : "Scheduled by AlarmKit on iPhone";
    } else {
      alarm.status = "failed";
      alarm.statusMessage = result.message || "iPhone failed to apply command";
    }
    alarm.updatedAt = now();
    await this.persist();
    return command;
  }
}

export function bearerToken(request) {
  const header = request.headers.authorization || "";
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) throw new HttpError(401, "unauthorized", "bearer token required");
  return match[1];
}
