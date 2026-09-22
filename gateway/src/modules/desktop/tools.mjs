import { z } from "zod";
import { toolFailure, toolResult } from "../../common/mcp-result.mjs";

const relativePath = z.string()
  .min(1)
  .max(2048)
  .refine((value) => !value.startsWith("/") && !value.split("/").some((part) => part === "" || part === "." || part === ".."), {
    message: "must be a safe Desktop-relative path"
  });

async function writeDesktopAudit(auditLog, event) {
  if (!auditLog) return;
  try {
    await auditLog.write({
      timestamp: new Date().toISOString(),
      category: "desktop",
      ...event
    });
  } catch (error) {
    console.error("Desktop audit log write failed:", error instanceof Error ? error.message : error);
  }
}

export function registerDesktopTools(server, { desktop, desktopAuditLog }) {
  server.registerTool("read_file_names", {
    title: "Read Desktop file names",
    description: `Read Desktop metadata without accessing file contents.
                 Use this tool when you need to understand the current workspace before organizing files or making desktop-related decisions.
                 Do not use this tool to read, summarize, or infer file contents. This tool exposes metadata only.
                 The Gateway owns filesystem access, sandbox enforcement, metadata extraction, and permission handling.
                 Callers provide only the request to inspect the Desktop. The returned metadata should be used for reasoning rather than content understanding.`,
    inputSchema: {},
    outputSchema: {
      status: z.literal("ready"),
      snapshotId: z.string().uuid(),
      folders: z.array(z.object({
        folderName: z.string(),
        relativePath: z.string()
      })),
      looseFiles: z.array(z.object({
        filename: z.string(),
        relativePath: z.string(),
        extension: z.string()
      })),
      expiresAt: z.string()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const startedAt = Date.now();
    try {
      const result = await desktop.readFileNames();
      await writeDesktopAudit(desktopAuditLog, {
        tool: "read_file_names",
        status: result.status,
        folderCount: result.folders.length,
        looseFileCount: result.looseFiles.length,
        durationMs: Date.now() - startedAt
      });
      return toolResult(result);
    } catch (error) {
      await writeDesktopAudit(desktopAuditLog, {
        tool: "read_file_names",
        status: "error",
        folderCount: 0,
        looseFileCount: 0,
        durationMs: Date.now() - startedAt,
        errorCode: error?.code || "UNKNOWN"
      });
      return toolFailure(error);
    }
  });

  server.registerTool("move_files", {
    title: "Move approved Desktop files",
    description: `Move Desktop items according to a user-approved organization plan.
                 Use this tool only after the user has explicitly approved the proposed file movements.
                 Do not use this tool to reorganize the Desktop autonomously or without user confirmation.
                 The Gateway validates every move, enforces sandbox boundaries, verifies source and destination paths, and performs the actual filesystem operations.
                 Callers provide only the approved organization plan. They should never construct filesystem paths manually or bypass the Gateway's validation.`,
    inputSchema: {
      snapshotId: z.string().uuid().describe("Recent Desktop snapshot returned by read_file_names"),
      moves: z.array(z.object({
        sourceRelativePath: relativePath,
        destinationRelativePath: relativePath
      })).min(1).max(100)
    },
    outputSchema: {
      status: z.enum(["moved", "cancelled", "failed", "partial_failure"]),
      requestedCount: z.number().int(),
      movedCount: z.number().int(),
      failedCount: z.number().int(),
      results: z.array(z.object({
        sourceRelativePath: z.string(),
        destinationRelativePath: z.string(),
        status: z.enum(["moved", "failed"]),
        errorCode: z.string().optional()
      }))
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ snapshotId, moves }) => {
    const startedAt = Date.now();
    try {
      const result = await desktop.moveFiles({ snapshotId, moves });
      await writeDesktopAudit(desktopAuditLog, {
        tool: "move_files",
        status: result.status,
        itemCount: result.requestedCount,
        successCount: result.movedCount,
        failureCount: result.failedCount,
        durationMs: Date.now() - startedAt
      });
      return toolResult(result);
    } catch (error) {
      await writeDesktopAudit(desktopAuditLog, {
        tool: "move_files",
        status: "error",
        itemCount: Array.isArray(moves) ? moves.length : 0,
        successCount: 0,
        failureCount: Array.isArray(moves) ? moves.length : 0,
        durationMs: Date.now() - startedAt,
        errorCode: error?.code || "UNKNOWN"
      });
      return toolFailure(error);
    }
  });
}
