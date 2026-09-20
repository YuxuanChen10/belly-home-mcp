import { HttpError, invariant } from "../../../common/errors.mjs";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
];

function string(value, field, { min = 1, max = 200 } = {}) {
  invariant(typeof value === "string", 400, "invalid_request", `${field} must be a string`);
  const result = value.trim();
  invariant(result.length >= min && result.length <= max, 400, "invalid_request", `${field} must be ${min}-${max} characters`);
  return result;
}

function integer(value, field, min, max) {
  invariant(Number.isInteger(value) && value >= min && value <= max, 400, "invalid_request", `${field} must be an integer from ${min} to ${max}`);
  return value;
}

export function parseSchedule(value) {
  invariant(value && typeof value === "object" && !Array.isArray(value), 400, "invalid_request", "schedule must be an object");
  invariant(value.kind === "once" || value.kind === "weekly", 400, "invalid_request", "schedule.kind must be once or weekly");

  if (value.kind === "once") {
    const fireAt = string(value.fireAt, "schedule.fireAt");
    const timestamp = Date.parse(fireAt);
    invariant(Number.isFinite(timestamp), 400, "invalid_request", "schedule.fireAt must be RFC 3339");
    invariant(timestamp > Date.now() - 60_000, 400, "alarm_in_past", "one-time alarm must be in the future");
    return { kind: "once", fireAt: new Date(timestamp).toISOString() };
  }

  const weekdays = Array.isArray(value.weekdays) ? [...new Set(value.weekdays)] : [];
  invariant(weekdays.length > 0 && weekdays.every((day) => WEEKDAYS.includes(day)), 400, "invalid_request", "weekly alarm requires valid weekdays");
  const timeZone = string(value.timeZone, "schedule.timeZone", { max: 100 });
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    throw new HttpError(400, "invalid_request", "schedule.timeZone must be an IANA time zone");
  }
  return {
    kind: "weekly",
    hour: integer(value.hour, "schedule.hour", 0, 23),
    minute: integer(value.minute, "schedule.minute", 0, 59),
    weekdays,
    timeZone
  };
}

export function parseCreateAlarm(value) {
  invariant(value && typeof value === "object", 400, "invalid_request", "request body must be an object");
  return {
    deviceId: string(value.deviceId, "deviceId", { max: 100 }),
    label: string(value.label, "label", { max: 80 }),
    schedule: parseSchedule(value.schedule),
    idempotencyKey: string(value.idempotencyKey, "idempotencyKey", { max: 160 })
  };
}

export function parsePluginCreateAlarm(value, deviceId) {
  invariant(value && typeof value === "object" && !Array.isArray(value), 400, "invalid_request", "request body must be an object");
  const allowedFields = new Set(["label", "fireAt", "idempotencyKey"]);
  invariant(Object.keys(value).every((key) => allowedFields.has(key)), 400, "invalid_request", "only label, fireAt, and idempotencyKey are allowed");

  const fireAt = string(value.fireAt, "fireAt");
  invariant(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(fireAt),
    400,
    "invalid_request",
    "fireAt must be an RFC 3339 timestamp with an explicit UTC offset"
  );

  return {
    deviceId: string(deviceId, "configured deviceId", { max: 100 }),
    label: string(value.label, "label", { max: 80 }),
    schedule: parseSchedule({ kind: "once", fireAt }),
    idempotencyKey: string(value.idempotencyKey, "idempotencyKey", { max: 160 })
  };
}

export function parseAlarmPatch(value) {
  invariant(value && typeof value === "object", 400, "invalid_request", "request body must be an object");
  const result = {};
  if (value.label !== undefined) result.label = string(value.label, "label", { max: 80 });
  if (value.schedule !== undefined) result.schedule = parseSchedule(value.schedule);
  invariant(Object.keys(result).length > 0, 400, "invalid_request", "provide label or schedule");
  return result;
}
