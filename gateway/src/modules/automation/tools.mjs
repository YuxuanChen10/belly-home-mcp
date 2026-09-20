import { createHash } from "node:crypto";
import { z } from "zod";
import { toolFailure } from "../../common/mcp-result.mjs";

const fireAtSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/,
  "Use an RFC 3339 timestamp with an explicit UTC offset"
);

const outputSchema = {
  alarmId: z.string().uuid(),
  status: z.enum(["queued", "scheduled", "failed", "cancelling", "cancelled"]),
  label: z.string(),
  fireAt: z.string(),
  replayed: z.boolean(),
  confirmation: z.string()
};

function idempotencyKey(label, fireAt) {
  return `mcp-create-${createHash("sha256").update(`${label}\0${fireAt}`).digest("hex")}`;
}

export function registerAutomationTools(server, { client, timeZone }) {
  server.registerTool(
    "create_alarm",
    {
      title: "Create iPhone alarm",
      description:
        `Create one one-time alarm on the paired iPhone. Resolve natural-language dates in ${timeZone} and send fireAt as RFC 3339 with an explicit UTC offset. The returned status may be queued until the phone synchronizes.`,
      inputSchema: {
        label: z.string().trim().min(1).max(80).describe("Short alarm label shown on the iPhone"),
        fireAt: fireAtSchema.describe("Exact one-time alarm timestamp, including Z or a numeric UTC offset")
      },
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async ({ label, fireAt }) => {
      try {
        const timestamp = Date.parse(fireAt);
        if (!Number.isFinite(timestamp)) throw new Error("fireAt is not a valid timestamp");
        if (timestamp < Date.now() - 60_000) throw new Error("The alarm time must be in the future");
        const normalizedLabel = label.trim();
        const normalizedFireAt = new Date(timestamp).toISOString();
        const result = await client.createAlarm({
          label: normalizedLabel,
          fireAt: normalizedFireAt,
          idempotencyKey: idempotencyKey(normalizedLabel, normalizedFireAt)
        });
        const alarm = result.alarm;
        const confirmation = alarm.status === "scheduled"
          ? "The iPhone confirmed the alarm."
          : "The alarm is queued. Open Alarm Gateway on the iPhone and tap Sync now to finish scheduling it.";
        const structuredContent = {
          alarmId: alarm.id,
          status: alarm.status,
          label: alarm.label,
          fireAt: alarm.schedule.fireAt,
          replayed: Boolean(result.replayed),
          confirmation
        };
        return {
          structuredContent,
          content: [{ type: "text", text: `${alarm.label} is ${alarm.status} for ${alarm.schedule.fireAt}. ${confirmation}` }]
        };
      } catch (error) {
        return toolFailure(error, "Alarm creation failed");
      }
    }
  );
}
