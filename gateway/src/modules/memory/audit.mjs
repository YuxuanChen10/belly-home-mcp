import { createContentAuditEvent } from "./audit-log.mjs";

export async function writeContentAudit({
  auditLog,
  tool,
  startedAt,
  status,
  date,
  contentChars,
  target,
  operation,
  diaryId,
  updatedFields
}) {
  if (!auditLog) return;
  const durationMs = Date.now() - startedAt.getTime();
  try {
    await auditLog.write(createContentAuditEvent({
      tool,
      startedAt,
      durationMs,
      status,
      date,
      contentChars,
      target,
      operation,
      diaryId,
      updatedFields
    }));
  } catch (error) {
    console.error("Content audit log write failed:", error instanceof Error ? error.message : error);
  }
}
