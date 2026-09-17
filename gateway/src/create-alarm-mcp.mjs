import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createDiaryAuditEvent } from "./audit-log.mjs";
import { DiaryStore } from "./diary-store.mjs";
import { DOCUMENT_TARGETS, DocumentStore } from "./document-store.mjs";

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

function failure(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : "Alarm creation failed" }]
  };
}

function toolResult(value) {
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  };
}

async function writeDiaryAudit({ auditLog, tool, startedAt, status, date, contentChars, target }) {
  if (!auditLog) return;
  const durationMs = Date.now() - startedAt.getTime();
  try {
    await auditLog.write(createDiaryAuditEvent({ tool, startedAt, durationMs, status, date, contentChars, target }));
  } catch (error) {
    console.error("Diary audit log write failed:", error instanceof Error ? error.message : error);
  }
}

function registerDiaryTools(server, diary, auditLog) {
  server.registerTool(
    "append_diary",
    {
      title: "Append diary entry",
      description:
        "Append Markdown content to today's private diary file. The server chooses the Australia/Melbourne date and time; callers cannot provide a path or date.",
      inputSchema: {
        content: z.string().min(1).max(diary.maxContentLength).describe("Markdown diary content to append verbatim"),
        title: z.string().trim().min(1).max(80).optional().describe("Optional entry title")
      },
      outputSchema: {
        status: z.enum(["created", "appended"]),
        date: z.string(),
        time: z.string(),
        title: z.string().optional(),
        size: z.number()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async ({ content, title }) => {
      const startedAt = new Date();
      try {
        const { path: _path, ...result } = await diary.append({ content, title });
        await writeDiaryAudit({
          auditLog,
          tool: "append_diary",
          startedAt,
          status: result.status,
          date: result.date,
          contentChars: content.length
        });
        return toolResult(result);
      } catch (error) {
        await writeDiaryAudit({
          auditLog,
          tool: "append_diary",
          startedAt,
          status: "error",
          contentChars: typeof content === "string" ? content.length : 0
        });
        return failure(error);
      }
    }
  );

  server.registerTool(
    "read_diary",
    {
      title: "Read diary entry",
      description: "Read one diary day. Defaults to today's Australia/Melbourne date. Missing files return not_found and do not create a file.",
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional()
      },
      outputSchema: {
        status: z.enum(["found", "not_found"]),
        date: z.string(),
        content: z.string().optional(),
        size: z.number().optional(),
        updatedAt: z.string().optional()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async ({ date }) => {
      const startedAt = new Date();
      try {
        const result = await diary.read({ date });
        await writeDiaryAudit({
          auditLog,
          tool: "read_diary",
          startedAt,
          status: result.status,
          date: result.date
        });
        return toolResult(result);
      } catch (error) {
        await writeDiaryAudit({
          auditLog,
          tool: "read_diary",
          startedAt,
          status: "error",
          date
        });
        return failure(error);
      }
    }
  );

  server.registerTool(
    "list_diary_entries",
    {
      title: "List diary entries",
      description: "List existing diary dates newest first. Returns metadata only, never diary body content.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).optional(),
        before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional()
      },
      outputSchema: {
        entries: z.array(z.object({
          date: z.string(),
          size: z.number(),
          updatedAt: z.string()
        }))
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async ({ limit, before }) => {
      const startedAt = new Date();
      try {
        const result = await diary.list({ limit, before });
        await writeDiaryAudit({
          auditLog,
          tool: "list_diary_entries",
          startedAt,
          status: "ok",
          date: before
        });
        return toolResult(result);
      } catch (error) {
        await writeDiaryAudit({
          auditLog,
          tool: "list_diary_entries",
          startedAt,
          status: "error",
          date: before
        });
        return failure(error);
      }
    }
  );
}

function registerDocumentTools(server, documents, auditLog) {
  server.registerTool(
    "append_document",
    {
      title: "Append Belly Home document",
      description:
        "Append content to a Belly Home document. Choose a logical target; the gateway owns all storage paths and timestamps. Attachment values are references only and never cause file access.",
      inputSchema: {
        target: z.enum(DOCUMENT_TARGETS).describe("daily, design, development, or knowledge"),
        content: z.string().min(1).max(documents.maxContentLength).describe("Markdown content to append verbatim"),
        attachments: z.array(z.string().trim().min(1).max(500)).max(documents.maxAttachments).default([]).optional()
      },
      outputSchema: {
        status: z.enum(["created", "appended"]),
        target: z.enum(DOCUMENT_TARGETS),
        date: z.string(),
        time: z.string(),
        attachmentCount: z.number().int(),
        size: z.number()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async ({ target, content, attachments }) => {
      const startedAt = new Date();
      try {
        const { path: _path, ...result } = await documents.append({ target, content, attachments });
        await writeDiaryAudit({
          auditLog,
          tool: "append_document",
          startedAt,
          status: result.status,
          date: result.date,
          contentChars: content.length,
          target
        });
        return toolResult(result);
      } catch (error) {
        await writeDiaryAudit({
          auditLog,
          tool: "append_document",
          startedAt,
          status: "error",
          contentChars: typeof content === "string" ? content.length : 0,
          target
        });
        return failure(error);
      }
    }
  );
}

export function createAlarmMcpServer({
  client,
  timeZone = "Australia/Melbourne",
  diary = new DiaryStore({ timeZone }),
  documents = new DocumentStore({ timeZone }),
  auditLog = null
}) {
  const server = new McpServer(
    { name: "belly-home-mcp", version: "0.2.0" },
    {
      instructions:
        `This private server can create one-time iPhone alarms and manage private Belly Home Markdown documents. For alarms, resolve the user's requested time in ${timeZone}, then pass fireAt with an explicit UTC offset. Do not claim the alarm is on the phone unless the result status is scheduled. Use append_document for new writes and choose a logical target; never invent or manage storage paths.`
    }
  );

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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      }
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
          content: [{
            type: "text",
            text: `${alarm.label} is ${alarm.status} for ${alarm.schedule.fireAt}. ${confirmation}`
          }]
        };
      } catch (error) {
        return failure(error);
      }
    }
  );

  registerDiaryTools(server, diary, auditLog);
  registerDocumentTools(server, documents, auditLog);

  return server;
}
