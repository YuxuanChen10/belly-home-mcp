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
    description: "Read metadata from only the first level of the user's macOS Desktop. Returns existing first-level folders and loose files with names, Desktop-relative paths, and extensions. It never scans inside folders and never opens or reads file contents. Use the folders as existing categories and analyze only looseFiles.",
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
    description: "Move loose files from the first level of Desktop into existing first-level Desktop folders after the user explicitly approves the proposed plan. Default is the only folder that may be created when absent. This operation cannot move folders or rename files. One native macOS window summarizes the full batch; duplicate destination names become Name (1), Name (2), and so on without overwriting.",
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
