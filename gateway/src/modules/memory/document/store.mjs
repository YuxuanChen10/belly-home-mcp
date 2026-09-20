import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const TARGETS = Object.freeze({
  design: { directory: "Design", file: "Design Diary.md", title: "Design Diary" },
  development: { directory: "Development", file: "Development Log.md", title: "Development Log" },
  knowledge: { directory: "Knowledge", file: "Lessons Learned.md", title: "Lessons Learned" }
});

export const DOCUMENT_TARGETS = Object.freeze(Object.keys(TARGETS));

function defaultRootDirectory() {
  return join(homedir(), "Library", "Application Support", "Belly Home Infra");
}

function localParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function normalizeContent(content, maxContentLength) {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("content is required");
  }
  if (content.length > maxContentLength) {
    throw new Error(`content exceeds ${maxContentLength} characters`);
  }
  return content;
}

function normalizeAttachments(attachments, maxAttachments) {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments)) throw new Error("attachments must be an array");
  if (attachments.length > maxAttachments) {
    throw new Error(`attachments exceeds ${maxAttachments} items`);
  }
  return attachments.map((attachment) => {
    if (typeof attachment !== "string") throw new Error("each attachment must be a string reference");
    const normalized = attachment.trim();
    if (normalized.length === 0 || normalized.length > 500) {
      throw new Error("each attachment reference must contain 1 to 500 characters");
    }
    return normalized;
  });
}

function attachmentBlock(attachments) {
  if (attachments.length === 0) return "";
  return `\n\n### Attachments\n\n${attachments.map((item) => `- ${item}`).join("\n")}`;
}

function normalizePage(offset, limit, maxReadLength) {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > maxReadLength)) {
    throw new Error(`limit must be an integer from 1 to ${maxReadLength}`);
  }
  return { offset, limit };
}

export class DocumentStore {
  constructor({
    rootDirectory = defaultRootDirectory(),
    timeZone = "Australia/Melbourne",
    now = () => new Date(),
    maxContentLength = 100_000,
    maxAttachments = 20,
    maxReadLength = 100_000
  } = {}) {
    this.rootDirectory = rootDirectory;
    this.timeZone = timeZone;
    this.now = now;
    this.maxContentLength = maxContentLength;
    this.maxAttachments = maxAttachments;
    this.maxReadLength = maxReadLength;
  }

  targetPath(target) {
    const definition = TARGETS[target];
    if (!definition) throw new Error(`target must be one of: ${DOCUMENT_TARGETS.join(", ")}`);
    return join(this.rootDirectory, definition.directory, definition.file);
  }

  async append({ target, content, attachments } = {}) {
    if (!DOCUMENT_TARGETS.includes(target)) {
      throw new Error(`target must be one of: ${DOCUMENT_TARGETS.join(", ")}`);
    }
    const normalizedContent = normalizeContent(content, this.maxContentLength);
    const normalizedAttachments = normalizeAttachments(attachments, this.maxAttachments);
    const { date, time } = localParts(this.now(), this.timeZone);
    const filePath = this.targetPath(target);
    await mkdir(dirname(filePath), { recursive: true });

    const exists = await pathExists(filePath);
    const documentTitle = TARGETS[target].title;
    const prefix = exists ? "\n" : `# ${documentTitle}\n> ${this.timeZone}\n\n`;
    const entry = `${prefix}## ${date} ${time}\n\n${normalizedContent}${attachmentBlock(normalizedAttachments)}\n`;

    const handle = await open(filePath, "a", 0o600);
    try {
      await handle.writeFile(entry, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    const file = await stat(filePath);
    return {
      status: exists ? "appended" : "created",
      target,
      date,
      time,
      attachmentCount: normalizedAttachments.length,
      path: filePath,
      size: file.size
    };
  }

  async read({ target, offset = 0, limit } = {}) {
    if (!DOCUMENT_TARGETS.includes(target)) {
      throw new Error(`target must be one of: ${DOCUMENT_TARGETS.join(", ")}`);
    }
    const page = normalizePage(offset, limit, this.maxReadLength);
    const filePath = this.targetPath(target);

    if (!(await pathExists(filePath))) {
      return {
        status: "not_found",
        target,
        content: "",
        offset: page.offset,
        ...(page.limit !== undefined ? { limit: page.limit } : {}),
        returnedCharacters: 0,
        characterCount: 0,
        hasMore: false
      };
    }

    const [rawContent, file] = await Promise.all([
      readFile(filePath, "utf8"),
      stat(filePath)
    ]);
    const characters = Array.from(rawContent);
    const end = page.limit === undefined
      ? characters.length
      : Math.min(page.offset + page.limit, characters.length);
    const content = characters.slice(page.offset, end).join("");

    return {
      status: "found",
      target,
      content,
      offset: page.offset,
      ...(page.limit !== undefined ? { limit: page.limit } : {}),
      returnedCharacters: Array.from(content).length,
      characterCount: characters.length,
      hasMore: end < characters.length,
      updatedAt: file.mtime.toISOString()
    };
  }
}
