import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

export class DiaryStore {
  constructor({
    rootDirectory = defaultRootDirectory(),
    timeZone = "Australia/Melbourne",
    now = () => new Date(),
    maxContentLength = 100_000
  } = {}) {
    this.rootDirectory = rootDirectory;
    this.timeZone = timeZone;
    this.now = now;
    this.maxContentLength = maxContentLength;
  }

  entryPath(date) {
    assertDate(date);
    return join(this.rootDirectory, `${date}.md`);
  }

  async append({ content, title } = {}) {
    const normalizedContent = normalizeContent(content, this.maxContentLength);
    const normalizedTitle = normalizeTitle(title);
    const { date, time } = melbourneParts(this.now(), this.timeZone);
    const filePath = this.entryPath(date);
    await mkdir(this.rootDirectory, { recursive: true });

    const exists = await pathExists(filePath);
    const heading = normalizedTitle ? `## ${time} · ${normalizedTitle}` : `## ${time}`;
    const prefix = exists ? "\n" : `# ${date} · 翎翎日记\n> ${this.timeZone}\n\n`;
    const entry = `${prefix}${heading}\n\n${normalizedContent}\n`;

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
      date,
      time,
      title: normalizedTitle || undefined,
      path: filePath,
      size: file.size
    };
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
      const content = await handle.readFile("utf8");
      const file = await handle.stat();
      return {
        status: "found",
        date: targetDate,
        content,
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
