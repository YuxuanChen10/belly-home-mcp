import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function defaultDiaryLogFile() {
  return join(homedir(), "Library", "Logs", "Belly Home Infra", "diary-mcp.log");
}

export class AuditLog {
  constructor({ file = defaultDiaryLogFile() } = {}) {
    this.file = file;
  }

  async write(event) {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export function createDiaryAuditEvent({
  tool,
  startedAt,
  durationMs,
  status,
  date,
  contentChars = 0
}) {
  return {
    timestamp: startedAt.toISOString(),
    category: "diary",
    tool,
    durationMs,
    status,
    date: date || null,
    contentChars
  };
}
