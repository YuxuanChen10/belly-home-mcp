import { z } from "zod";
import { toolFailure, toolResult } from "../../common/mcp-result.mjs";
import { writeContentAudit } from "./audit.mjs";
import { DiaryNotFoundError } from "./diary/store.mjs";
import { DOCUMENT_TARGETS } from "./document/store.mjs";

function registerDiaryTools(server, diary, auditLog) {
  server.registerTool("append_diary", {
    title: "Append diary entry",
    description: "Append Markdown content to today's private diary file. The server chooses the Australia/Melbourne date and time; callers cannot provide a path or date.",
    inputSchema: {
      content: z.string().min(1).max(diary.maxContentLength).describe("Markdown diary content to append verbatim"),
      title: z.string().trim().min(1).max(80).optional().describe("Optional entry title"),
      tags: z.array(z.string().trim().min(1).max(40)).max(diary.maxTags).default([]).optional()
    },
    outputSchema: {
      status: z.enum(["created", "appended"]), id: z.string().uuid(), date: z.string(), time: z.string(),
      title: z.string().optional(), tags: z.array(z.string()), createdAt: z.string(), updatedAt: z.string(),
      version: z.number().int(), size: z.number()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ content, title, tags }) => {
    const startedAt = new Date();
    try {
      const { path: _path, ...result } = await diary.append({ content, title, tags });
      await writeContentAudit({ auditLog, tool: "append_diary", startedAt, status: result.status, date: result.date, contentChars: content.length });
      return toolResult(result);
    } catch (error) {
      await writeContentAudit({ auditLog, tool: "append_diary", startedAt, status: "error", contentChars: typeof content === "string" ? content.length : 0 });
      return toolFailure(error);
    }
  });

  server.registerTool("update_diary", {
    title: "Update diary entry",
    description: "Partially update one diary entry by its stable ID. Only supplied title, content, or tags are changed. The entry ID and createdAt remain unchanged, and the previous version is preserved.",
    inputSchema: {
      id: z.string().uuid(),
      patch: z.object({
        title: z.string().trim().max(80).optional(),
        content: z.string().min(1).max(diary.maxContentLength).optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(diary.maxTags).optional()
      }).refine((patch) => Object.keys(patch).length > 0, "patch must include title, content, or tags")
    },
    outputSchema: {
      status: z.literal("updated"), message: z.literal("Diary Updated"), id: z.string().uuid(), date: z.string(),
      title: z.string().optional(), tags: z.array(z.string()), createdAt: z.string(), updatedAt: z.string(),
      version: z.number().int(), updatedFields: z.array(z.enum(["title", "content", "tags"])), size: z.number()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ id, patch }) => {
    const startedAt = new Date();
    try {
      const { path: _path, ...result } = await diary.update(id, patch);
      await writeContentAudit({ auditLog, tool: "update_diary", startedAt, status: result.status, date: result.date, contentChars: typeof patch.content === "string" ? patch.content.length : 0, operation: "UPDATE", diaryId: id, updatedFields: result.updatedFields });
      return toolResult(result);
    } catch (error) {
      await writeContentAudit({ auditLog, tool: "update_diary", startedAt, status: error instanceof DiaryNotFoundError ? "not_found" : "error", contentChars: typeof patch?.content === "string" ? patch.content.length : 0, operation: "UPDATE", diaryId: id, updatedFields: patch && typeof patch === "object" ? Object.keys(patch) : [] });
      return toolFailure(error);
    }
  });

  server.registerTool("read_diary", {
    title: "Read diary entry",
    description: "Read one diary day. Defaults to today's Australia/Melbourne date. Missing files return not_found and do not create a file.",
    inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional() },
    outputSchema: {
      status: z.enum(["found", "not_found"]), date: z.string(), content: z.string().optional(),
      entries: z.array(z.object({ id: z.string().uuid(), date: z.string(), time: z.string(), title: z.string().optional(), tags: z.array(z.string()), createdAt: z.string(), updatedAt: z.string(), version: z.number().int() })).optional(),
      size: z.number().optional(), updatedAt: z.string().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ date }) => {
    const startedAt = new Date();
    try {
      const result = await diary.read({ date });
      await writeContentAudit({ auditLog, tool: "read_diary", startedAt, status: result.status, date: result.date });
      return toolResult(result);
    } catch (error) {
      await writeContentAudit({ auditLog, tool: "read_diary", startedAt, status: "error", date });
      return toolFailure(error);
    }
  });

  server.registerTool("list_diary_entries", {
    title: "List diary entries",
    description: "List existing diary dates newest first. Returns metadata only, never diary body content.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(20).optional(), before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional() },
    outputSchema: { entries: z.array(z.object({ date: z.string(), size: z.number(), updatedAt: z.string() })) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ limit, before }) => {
    const startedAt = new Date();
    try {
      const result = await diary.list({ limit, before });
      await writeContentAudit({ auditLog, tool: "list_diary_entries", startedAt, status: "ok", date: before });
      return toolResult(result);
    } catch (error) {
      await writeContentAudit({ auditLog, tool: "list_diary_entries", startedAt, status: "error", date: before });
      return toolFailure(error);
    }
  });
}

function registerDocumentTools(server, documents, auditLog) {
  server.registerTool("create_document", {
    title: "Create Belly Home document",
    description: "Create a standalone Design, Development, or Knowledge document with a stable ID. The gateway owns its storage path, timestamps, and initial version.",
    inputSchema: {
      target: z.enum(DOCUMENT_TARGETS).describe("design, development, or knowledge"),
      title: z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/, "title must be a single line"),
      content: z.string().min(1).max(documents.maxContentLength),
      tags: z.array(z.string().trim().min(1).max(40)).max(documents.maxTags).default([]).optional(),
      attachments: z.array(z.string().trim().min(1).max(500)).max(documents.maxAttachments).default([]).optional()
    },
    outputSchema: {
      status: z.literal("created"),
      id: z.string().uuid(),
      target: z.enum(DOCUMENT_TARGETS),
      title: z.string(),
      tags: z.array(z.string()),
      version: z.literal(1),
      createdAt: z.string(),
      updatedAt: z.string(),
      attachmentCount: z.number().int(),
      size: z.number()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ target, title, content, tags, attachments }) => {
    const startedAt = new Date();
    try {
      const { path: _path, ...result } = await documents.create({ target, title, content, tags, attachments });
      await writeContentAudit({ auditLog, tool: "create_document", startedAt, status: result.status, contentChars: content.length, target });
      return toolResult(result);
    } catch (error) {
      await writeContentAudit({ auditLog, tool: "create_document", startedAt, status: "error", contentChars: typeof content === "string" ? content.length : 0, target });
      return toolFailure(error);
    }
  });

  server.registerTool("append_document", {
    title: "Append Belly Home document",
    description: "Append content to a Belly Home document. Provide title to route to a standalone document, or omit it to retain the legacy aggregate target behavior. The gateway owns IDs, paths, versions, and timestamps.",
    inputSchema: {
      target: z.enum(DOCUMENT_TARGETS).describe("design, development, or knowledge"),
      title: z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/, "title must be a single line").optional(),
      content: z.string().min(1).max(documents.maxContentLength).describe("Markdown content to append verbatim"),
      attachments: z.array(z.string().trim().min(1).max(500)).max(documents.maxAttachments).default([]).optional()
    },
    outputSchema: {
      status: z.enum(["created", "appended"]),
      id: z.string().uuid().optional(),
      target: z.enum(DOCUMENT_TARGETS),
      title: z.string().optional(),
      date: z.string(),
      time: z.string(),
      version: z.number().int().optional(),
      updatedAt: z.string().optional(),
      attachmentCount: z.number().int(),
      size: z.number()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ target, title, content, attachments }) => {
    const startedAt = new Date();
    try {
      const { path: _path, ...result } = await documents.append({ target, title, content, attachments });
      await writeContentAudit({ auditLog, tool: "append_document", startedAt, status: result.status, date: result.date, contentChars: content.length, target });
      return toolResult(result);
    } catch (error) {
      await writeContentAudit({ auditLog, tool: "append_document", startedAt, status: "error", contentChars: typeof content === "string" ? content.length : 0, target });
      return toolFailure(error);
    }
  });

  server.registerTool("read_document", {
    title: "Read Belly Home document",
    description: "Read a shareable Belly Home document. Provide title to route to a standalone document, or omit it to retain the legacy aggregate target behavior. Use offset and limit for character-based pagination.",
    inputSchema: {
      target: z.enum(DOCUMENT_TARGETS).describe("design, development, or knowledge"),
      title: z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/, "title must be a single line").optional(),
      offset: z.number().int().min(0).default(0).optional().describe("Zero-based Unicode character offset"),
      limit: z.number().int().min(1).max(documents.maxReadLength).optional().describe("Maximum Unicode characters to return")
    },
    outputSchema: {
      status: z.enum(["found", "not_found"]),
      id: z.string().uuid().optional(),
      target: z.enum(DOCUMENT_TARGETS),
      title: z.string().optional(),
      tags: z.array(z.string()).optional(),
      version: z.number().int().optional(),
      createdAt: z.string().optional(),
      content: z.string(),
      offset: z.number().int(),
      limit: z.number().int().optional(),
      returnedCharacters: z.number().int(),
      characterCount: z.number().int(),
      hasMore: z.boolean(),
      updatedAt: z.string().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ target, title, offset, limit }) => {
    const startedAt = new Date();
    try {
      const { path: _path, ...result } = await documents.read({ target, title, offset, limit });
      await writeContentAudit({ auditLog, tool: "read_document", startedAt, status: result.status, target });
      return toolResult(result);
    } catch (error) {
      await writeContentAudit({ auditLog, tool: "read_document", startedAt, status: "error", target });
      return toolFailure(error);
    }
  });
}

export function registerMemoryTools(server, { diary, documents, auditLog }) {
  registerDiaryTools(server, diary, auditLog);
  registerDocumentTools(server, documents, auditLog);
}
