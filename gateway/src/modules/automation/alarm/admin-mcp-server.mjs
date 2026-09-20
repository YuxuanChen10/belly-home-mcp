import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getBellyHomeBaseUrl } from "../../../common/config.mjs";
import { GatewayClient } from "./client.mjs";

const baseUrl = getBellyHomeBaseUrl();
const token = process.env.ALARM_GATEWAY_TOKEN || "dev-admin-token";
const deviceId = process.env.ALARM_DEVICE_ID;
const defaultTimeZone = process.env.ALARM_TIMEZONE || "Australia/Melbourne";

if (!deviceId) {
  console.error("ALARM_DEVICE_ID is required. Pair a phone and set its device ID before starting MCP.");
  process.exit(1);
}

const client = new GatewayClient({ baseUrl, token, deviceId });
const server = new McpServer({ name: "alarm-gateway", version: "0.1.0" });
const weekday = z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const schedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), fireAt: z.string().describe("RFC 3339 timestamp with an explicit UTC offset") }),
  z.object({
    kind: z.literal("weekly"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    weekdays: z.array(weekday).min(1),
    timeZone: z.string().default(defaultTimeZone).describe("IANA time zone")
  })
]);

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function failure(error) {
  return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
}

server.registerTool("create_alarm", {
  title: "Create iPhone alarm",
  description: "Queue a one-time or weekly alarm for the paired iPhone. A queued response is not proof that AlarmKit scheduled it; check status until it is scheduled or failed.",
  inputSchema: {
    label: z.string().min(1).max(80),
    schedule,
    idempotencyKey: z.string().min(1).max(160).optional().describe("Stable key for retrying the same request")
  }
}, async ({ label, schedule: alarmSchedule, idempotencyKey }) => {
  try {
    return result(await client.createAlarm({ label, schedule: alarmSchedule, idempotencyKey: idempotencyKey || randomUUID() }));
  } catch (error) {
    return failure(error);
  }
});

server.registerTool("list_alarms", {
  title: "List iPhone alarms",
  description: "List alarms known to Alarm Gateway and their phone acknowledgement status.",
  inputSchema: { includeCancelled: z.boolean().default(false) },
  annotations: { readOnlyHint: true }
}, async ({ includeCancelled }) => {
  try {
    return result(await client.listAlarms(includeCancelled));
  } catch (error) {
    return failure(error);
  }
});

server.registerTool("get_alarm_status", {
  title: "Get alarm status",
  description: "Get one alarm. Only status=scheduled confirms that the iPhone accepted it through AlarmKit.",
  inputSchema: { alarmId: z.string().uuid() },
  annotations: { readOnlyHint: true }
}, async ({ alarmId }) => {
  try {
    return result(await client.getAlarm(alarmId));
  } catch (error) {
    return failure(error);
  }
});

server.registerTool("update_alarm", {
  title: "Update iPhone alarm",
  description: "Queue a label or schedule change for an existing alarm.",
  inputSchema: { alarmId: z.string().uuid(), label: z.string().min(1).max(80).optional(), schedule: schedule.optional() }
}, async ({ alarmId, label, schedule: alarmSchedule }) => {
  try {
    return result(await client.updateAlarm(alarmId, {
      ...(label === undefined ? {} : { label }),
      ...(alarmSchedule === undefined ? {} : { schedule: alarmSchedule })
    }));
  } catch (error) {
    return failure(error);
  }
});

server.registerTool("cancel_alarm", {
  title: "Cancel iPhone alarm",
  description: "Queue cancellation of one existing alarm. Confirm the target with the user when their request is ambiguous.",
  inputSchema: { alarmId: z.string().uuid() },
  annotations: { destructiveHint: true }
}, async ({ alarmId }) => {
  try {
    return result(await client.cancelAlarm(alarmId));
  } catch (error) {
    return failure(error);
  }
});

await server.connect(new StdioServerTransport());
