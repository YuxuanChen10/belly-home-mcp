import { constants as fsConstants } from "node:fs";
import { randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTRY_MARKER_PREFIX = "belly-home:diary-entry";

export class DiaryNotFoundError extends Error {
  constructor() {
    super("Diary Not Found");
    this.name = "DiaryNotFoundError";
    this.status = 404;
  }
}

function defaultRootDirectory() {
  return join(homedir(), "Library", "Application Support", "Belly Home Infra", "Diary");
}

function melbourneParts(now, timeZone) {
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

function assertDate(date) {
  if (!DATE_PATTERN.test(date)) throw new Error("date must use YYYY-MM-DD");
}

function normalizeContent(content, maxContentLength) {
  if (typeof content !== "string") throw new Error("content must be a string");
  if (content.trim().length === 0) throw new Error("content is required");
  if (content.length > maxContentLength) {
    throw new Error(`content exceeds ${maxContentLength} characters`);
  }
  return content;
}

function normalizeTitle(title) {
  if (title === undefined || title === null || title === "") return "";
  if (typeof title !== "string") throw new Error("title must be a string");
  const trimmed = title.trim();
  if (trimmed.length > 80) throw new Error("title must be 80 characters or fewer");
  return trimmed;
}

function normalizeTags(tags, maxTags) {
  if (tags === undefined) return [];
  if (!Array.isArray(tags)) throw new Error("tags must be an array");
  if (tags.length > maxTags) throw new Error(`tags exceeds ${maxTags} items`);
  const normalized = tags.map((tag) => {
    if (typeof tag !== "string") throw new Error("each tag must be a string");
    const value = tag.trim();
    if (value.length === 0 || value.length > 40) {
      throw new Error("each tag must contain 1 to 40 characters");
    }
    return value;
  });
  return [...new Set(normalized)];
}

function encodeMetadata(metadata) {
  return Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
}

function decodeMetadata(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function renderEntry(metadata, content) {
  const heading = metadata.title ? `## ${metadata.time} · ${metadata.title}` : `## ${metadata.time}`;
  const tags = metadata.tags.length > 0 ? `\nTags: ${metadata.tags.map((tag) => `#${tag}`).join(" ")}` : "";
  return [
    `<!-- ${ENTRY_MARKER_PREFIX}:${metadata.id}:start -->`,
    `<!-- belly-home:diary-data:${encodeMetadata(metadata)} -->`,
    `${heading}${tags}`,
    "",
    content,
    `<!-- ${ENTRY_MARKER_PREFIX}:${metadata.id}:end -->`
  ].join("\n");
}

function parseEntryBlock(block) {
  const metadataMatch = /<!-- belly-home:diary-data:([A-Za-z0-9_-]+) -->/.exec(block);
  if (!metadataMatch) throw new Error("diary entry metadata is missing");
  const metadata = decodeMetadata(metadataMatch[1]);
  const bodyStart = block.indexOf("\n\n", metadataMatch.index + metadataMatch[0].length);
  const endMarker = `\n<!-- ${ENTRY_MARKER_PREFIX}:${metadata.id}:end -->`;
  const bodyEnd = block.lastIndexOf(endMarker);
  if (bodyStart < 0 || bodyEnd < bodyStart) throw new Error("diary entry format is invalid");
  return { metadata, content: block.slice(bodyStart + 2, bodyEnd) };
}

function publicEntryMetadata(metadata) {
  return {
    id: metadata.id,
    date: metadata.date,
    time: metadata.time,
    ...(metadata.title ? { title: metadata.title } : {}),
    tags: metadata.tags,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    version: metadata.version
  };
}

function readView(document) {
  const entries = [];
  const pattern = new RegExp(
    `<!-- ${ENTRY_MARKER_PREFIX}:([0-9a-f-]+):start -->([\\s\\S]*?)<!-- ${ENTRY_MARKER_PREFIX}:\\1:end -->`,
    "gi"
  );
  for (const match of document.matchAll(pattern)) {
    entries.push(publicEntryMetadata(parseEntryBlock(match[0]).metadata));
  }
  const content = document
    .replace(new RegExp(`^<!-- ${ENTRY_MARKER_PREFIX}:[0-9a-f-]+:(?:start|end) -->\\n?`, "gim"), "")
    .replace(/^<!-- belly-home:diary-data:[A-Za-z0-9_-]+ -->\n?/gim, "");
  return { content, entries };
}

export class DiaryStore {
  constructor({
    rootDirectory = defaultRootDirectory(),
    timeZone = "Australia/Melbourne",
    now = () => new Date(),
    maxContentLength = 100_000,
    maxTags = 20
  } = {}) {
    this.rootDirectory = rootDirectory;
    this.timeZone = timeZone;
    this.now = now;
    this.maxContentLength = maxContentLength;
    this.maxTags = maxTags;
  }

  entryPath(date) {
    assertDate(date);
    return join(this.rootDirectory, `${date}.md`);
  }

  async append({ content, title, tags } = {}) {
    const normalizedContent = normalizeContent(content, this.maxContentLength);
    const normalizedTitle = normalizeTitle(title);
    const normalizedTags = normalizeTags(tags, this.maxTags);
    const currentTime = this.now();
    const { date, time } = melbourneParts(currentTime, this.timeZone);
    const filePath = this.entryPath(date);
    await mkdir(this.rootDirectory, { recursive: true });

    const exists = await pathExists(filePath);
    const timestamp = currentTime.toISOString();
    const metadata = {
      id: randomUUID(),
      version: 1,
      date,
      time,
      title: normalizedTitle,
      tags: normalizedTags,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const prefix = exists ? "\n" : `# ${date} · 翎翎日记\n> ${this.timeZone}\n\n`;
    const entry = `${prefix}${renderEntry(metadata, normalizedContent)}\n`;

    const handle = await open(filePath, "a");
    try {
      await handle.writeFile(entry, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    const file = await stat(filePath);
    return {
      status: exists ? "appended" : "created",
      id: metadata.id,
      date,
      time,
      title: normalizedTitle || undefined,
      tags: normalizedTags,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      path: filePath,
      size: file.size
    };
  }

  async update(id, patch = {}) {
    if (!ENTRY_ID_PATTERN.test(id)) throw new DiaryNotFoundError();
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("patch must be an object");
    }
    const suppliedFields = ["title", "content", "tags"].filter((field) => Object.hasOwn(patch, field));
    if (suppliedFields.length === 0) throw new Error("patch must include title, content, or tags");
    for (const field of Object.keys(patch)) {
      if (!["title", "content", "tags"].includes(field)) throw new Error(`unsupported patch field: ${field}`);
    }

    const files = (await readdir(this.rootDirectory, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }))
      .filter((entry) => entry.isFile() && DATE_PATTERN.test(entry.name.slice(0, -3)) && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
    const startMarker = `<!-- ${ENTRY_MARKER_PREFIX}:${id}:start -->`;
    const endMarker = `<!-- ${ENTRY_MARKER_PREFIX}:${id}:end -->`;

    for (const file of files) {
      const filePath = join(this.rootDirectory, file);
      const document = await readFile(filePath, "utf8");
      const start = document.indexOf(startMarker);
      if (start < 0) continue;
      const endStart = document.indexOf(endMarker, start);
      if (endStart < 0) throw new Error("diary entry end marker is missing");
      const end = endStart + endMarker.length;
      const previous = parseEntryBlock(document.slice(start, end));
      const title = Object.hasOwn(patch, "title") ? normalizeTitle(patch.title) : previous.metadata.title;
      const content = Object.hasOwn(patch, "content")
        ? normalizeContent(patch.content, this.maxContentLength)
        : previous.content;
      const tags = Object.hasOwn(patch, "tags")
        ? normalizeTags(patch.tags, this.maxTags)
        : previous.metadata.tags;
      const updatedAt = this.now().toISOString();
      const metadata = {
        ...previous.metadata,
        version: previous.metadata.version + 1,
        title,
        tags,
        updatedAt
      };

      const historyDirectory = join(this.rootDirectory, ".history", id);
      await mkdir(historyDirectory, { recursive: true });
      await writeFile(
        join(historyDirectory, `v${previous.metadata.version}.json`),
        `${JSON.stringify({ ...previous.metadata, content: previous.content }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" }
      );

      const updatedDocument = `${document.slice(0, start)}${renderEntry(metadata, content)}${document.slice(end)}`;
      const temporary = `${filePath}.tmp`;
      await writeFile(temporary, updatedDocument, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, filePath);
      const fileStat = await stat(filePath);
      return {
        status: "updated",
        message: "Diary Updated",
        id,
        date: metadata.date,
        title: title || undefined,
        tags,
        createdAt: metadata.createdAt,
        updatedAt,
        version: metadata.version,
        updatedFields: suppliedFields,
        path: filePath,
        size: fileStat.size
      };
    }
    throw new DiaryNotFoundError();
  }

  async read({ date } = {}) {
    const targetDate = date || melbourneParts(this.now(), this.timeZone).date;
    assertDate(targetDate);
    const filePath = this.entryPath(targetDate);
    if (!(await pathExists(filePath))) {
      return { status: "not_found", date: targetDate };
    }
    const handle = await open(filePath, "r");
    try {
      const document = await handle.readFile("utf8");
      const { content, entries } = readView(document);
      const file = await handle.stat();
      return {
        status: "found",
        date: targetDate,
        content,
        entries,
        size: file.size,
        updatedAt: file.mtime.toISOString()
      };
    } finally {
      await handle.close();
    }
  }

  async list({ limit = 20, before } = {}) {
    const normalizedLimit = Number.isInteger(limit) ? limit : Number.parseInt(`${limit}`, 10);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 100) {
      throw new Error("limit must be an integer between 1 and 100");
    }
    if (before !== undefined) assertDate(before);
    await mkdir(this.rootDirectory, { recursive: true });
    const files = await readdir(this.rootDirectory);
    const dates = files
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3))
      .filter((date) => DATE_PATTERN.test(date))
      .filter((date) => before === undefined || date < before)
      .sort()
      .reverse()
      .slice(0, normalizedLimit);

    const entries = [];
    for (const date of dates) {
      const file = await stat(this.entryPath(date));
      entries.push({
        date,
        size: file.size,
        updatedAt: file.mtime.toISOString()
      });
    }
    return { entries };
  }
}
