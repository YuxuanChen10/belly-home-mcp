import { constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const TARGETS = Object.freeze({
  design: { directory: "Design", file: "Design Diary.md", title: "Design Diary" },
  development: { directory: "Development", file: "Development Log.md", title: "Development Log" },
  knowledge: { directory: "Knowledge", file: "Lessons Learned.md", title: "Lessons Learned" }
});

export const DOCUMENT_TARGETS = Object.freeze(Object.keys(TARGETS));

export const DOCUMENT_TARGET_SCHEMA = z
  .enum(DOCUMENT_TARGETS)
  .describe(
    "Document collection. Each collection contains one aggregate document and zero or more standalone documents."
  );

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

function normalizeTitle(title) {
  if (typeof title !== "string") throw new Error("title must be a string");
  const normalized = title.trim();
  if (normalized.length === 0 || normalized.length > 160) {
    throw new Error("title must contain 1 to 160 characters");
  }
  if (/[\r\n]/.test(normalized)) throw new Error("title must be a single line");
  return normalized;
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

function encodeMetadata(metadata) {
  return Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
}

function decodeMetadata(document) {
  const match = /^<!-- belly-home:document-data:([A-Za-z0-9_-]+) -->/.exec(document);
  if (!match) throw new Error("document metadata is missing");
  return JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
}

function replaceMetadata(document, metadata) {
  return document.replace(
    /^<!-- belly-home:document-data:[A-Za-z0-9_-]+ -->/,
    `<!-- belly-home:document-data:${encodeMetadata(metadata)} -->`
  );
}

function readableDocument(document) {
  return document.replace(/^<!-- belly-home:document-data:[A-Za-z0-9_-]+ -->\n?/, "");
}

function titleKey(title) {
  return title.normalize("NFKC").toLocaleLowerCase("en-US");
}

function createdDocument(metadata, content, attachments) {
  const tags = metadata.tags.length > 0 ? `\nTags: ${metadata.tags.map((tag) => `#${tag}`).join(" ")}\n` : "";
  return [
    `<!-- belly-home:document-data:${encodeMetadata(metadata)} -->`,
    `# ${metadata.title}`,
    tags,
    content,
    attachmentBlock(attachments).trimStart(),
    ""
  ].filter((part) => part !== "").join("\n");
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
    maxTags = 20,
    maxReadLength = 100_000
  } = {}) {
    this.rootDirectory = rootDirectory;
    this.timeZone = timeZone;
    this.now = now;
    this.maxContentLength = maxContentLength;
    this.maxAttachments = maxAttachments;
    this.maxTags = maxTags;
    this.maxReadLength = maxReadLength;
    this.standaloneWrites = new Map();
  }

  targetPath(target) {
    const definition = TARGETS[target];
    if (!definition) throw new Error(`target must be one of: ${DOCUMENT_TARGETS.join(", ")}`);
    return join(this.rootDirectory, definition.directory, definition.file);
  }

  documentsDirectory(target) {
    const definition = TARGETS[target];
    if (!definition) throw new Error(`target must be one of: ${DOCUMENT_TARGETS.join(", ")}`);
    return join(this.rootDirectory, definition.directory, "Documents");
  }

  createdDocumentPath(target, id) {
    return join(this.documentsDirectory(target), `${id}.md`);
  }

  titleClaimPath(target, title) {
    const digest = createHash("sha256").update(titleKey(title)).digest("hex");
    return join(this.documentsDirectory(target), ".titles", `${digest}.json`);
  }

  async serializeStandaloneWrite(key, operation) {
    const previous = this.standaloneWrites.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.standaloneWrites.set(key, current);
    try {
      return await current;
    } finally {
      if (this.standaloneWrites.get(key) === current) this.standaloneWrites.delete(key);
    }
  }

  async findStandaloneDocument(target, title) {
    const normalizedTitle = normalizeTitle(title);
    const claimPath = this.titleClaimPath(target, normalizedTitle);
    if (await pathExists(claimPath)) {
      const claim = JSON.parse(await readFile(claimPath, "utf8"));
      const filePath = this.createdDocumentPath(target, claim.id);
      if (!(await pathExists(filePath))) throw new Error("document title index is invalid");
      const document = await readFile(filePath, "utf8");
      return { filePath, document, metadata: decodeMetadata(document) };
    }

    let entries;
    try {
      entries = await readdir(this.documentsDirectory(target), { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = join(this.documentsDirectory(target), entry.name);
      const document = await readFile(filePath, "utf8");
      const metadata = decodeMetadata(document);
      if (titleKey(metadata.title) === titleKey(normalizedTitle)) {
        return { filePath, document, metadata };
      }
    }
    return null;
  }

  async create({ target, title, content, tags, attachments } = {}) {
    if (!DOCUMENT_TARGETS.includes(target)) {
      throw new Error(`target must be one of: ${DOCUMENT_TARGETS.join(", ")}`);
    }
    const normalizedTitle = normalizeTitle(title);
    const normalizedContent = normalizeContent(content, this.maxContentLength);
    const normalizedTags = normalizeTags(tags, this.maxTags);
    const normalizedAttachments = normalizeAttachments(attachments, this.maxAttachments);
    const id = randomUUID();
    const timestamp = this.now().toISOString();
    const metadata = {
      id,
      target,
      title: normalizedTitle,
      tags: normalizedTags,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const filePath = this.createdDocumentPath(target, id);
    const claimPath = this.titleClaimPath(target, normalizedTitle);
    await mkdir(dirname(claimPath), { recursive: true });

    if (await this.findStandaloneDocument(target, normalizedTitle)) {
      throw new Error("a document with this title already exists in the target");
    }

    let claimHandle;
    try {
      claimHandle = await open(claimPath, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("a document with this title already exists in the target");
      throw error;
    }

    try {
      await claimHandle.writeFile(`${JSON.stringify({ id, title: normalizedTitle })}\n`, "utf8");
      await claimHandle.sync();
      await claimHandle.close();
      claimHandle = null;

      const handle = await open(filePath, "wx", 0o600);
      try {
        await handle.writeFile(createdDocument(metadata, normalizedContent, normalizedAttachments), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (claimHandle) await claimHandle.close();
      await rm(claimPath, { force: true });
      await rm(filePath, { force: true });
      throw error;
    }

    const file = await stat(filePath);
    return {
      status: "created",
      ...metadata,
      attachmentCount: normalizedAttachments.length,
      path: filePath,
      size: file.size
    };
  }

  async append({ target, title, content, attachments } = {}) {
    if (!DOCUMENT_TARGETS.includes(target)) {
      throw new Error(`target must be one of: ${DOCUMENT_TARGETS.join(", ")}`);
    }
    const normalizedContent = normalizeContent(content, this.maxContentLength);
    const normalizedAttachments = normalizeAttachments(attachments, this.maxAttachments);
    if (title !== undefined) {
      const normalizedTitle = normalizeTitle(title);
      const writeKey = `${target}:${titleKey(normalizedTitle)}`;
      return this.serializeStandaloneWrite(writeKey, async () => {
        const found = await this.findStandaloneDocument(target, normalizedTitle);
        if (!found) throw new Error("Document Not Found");
        const currentTime = this.now();
        const { date, time } = localParts(currentTime, this.timeZone);
        const metadata = {
          ...found.metadata,
          version: found.metadata.version + 1,
          updatedAt: currentTime.toISOString()
        };
        const entry = `\n## ${date} ${time}\n\n${normalizedContent}${attachmentBlock(normalizedAttachments)}\n`;
        const nextDocument = `${replaceMetadata(found.document, metadata).trimEnd()}\n${entry}`;
        const temporaryPath = `${found.filePath}.tmp`;
        try {
          await writeFile(temporaryPath, nextDocument, { encoding: "utf8", mode: 0o600 });
          await rename(temporaryPath, found.filePath);
        } catch (error) {
          await rm(temporaryPath, { force: true });
          throw error;
        }
        const file = await stat(found.filePath);
        return {
          status: "appended",
          id: metadata.id,
          target,
          title: metadata.title,
          date,
          time,
          version: metadata.version,
          updatedAt: metadata.updatedAt,
          attachmentCount: normalizedAttachments.length,
          path: found.filePath,
          size: file.size
        };
      });
    }

    const currentTime = this.now();
    const { date, time } = localParts(currentTime, this.timeZone);
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

  async read({ target, title, offset = 0, limit } = {}) {
    if (!DOCUMENT_TARGETS.includes(target)) {
      throw new Error(`target must be one of: ${DOCUMENT_TARGETS.join(", ")}`);
    }
    const page = normalizePage(offset, limit, this.maxReadLength);
    const standalone = title === undefined ? null : await this.findStandaloneDocument(target, title);
    const filePath = standalone?.filePath || this.targetPath(target);

    if ((title !== undefined && !standalone) || !(await pathExists(filePath))) {
      return {
        status: "not_found",
        target,
        ...(title !== undefined ? { title: normalizeTitle(title) } : {}),
        content: "",
        offset: page.offset,
        ...(page.limit !== undefined ? { limit: page.limit } : {}),
        returnedCharacters: 0,
        characterCount: 0,
        hasMore: false
      };
    }

    const [storedContent, file] = await Promise.all([
      standalone ? Promise.resolve(standalone.document) : readFile(filePath, "utf8"),
      stat(filePath)
    ]);
    const rawContent = standalone ? readableDocument(storedContent) : storedContent;
    const characters = Array.from(rawContent);
    const end = page.limit === undefined
      ? characters.length
      : Math.min(page.offset + page.limit, characters.length);
    const content = characters.slice(page.offset, end).join("");

    return {
      status: "found",
      target,
      ...(standalone ? {
        id: standalone.metadata.id,
        title: standalone.metadata.title,
        tags: standalone.metadata.tags,
        version: standalone.metadata.version,
        createdAt: standalone.metadata.createdAt
      } : {}),
      content,
      offset: page.offset,
      ...(page.limit !== undefined ? { limit: page.limit } : {}),
      returnedCharacters: Array.from(content).length,
      characterCount: characters.length,
      hasMore: end < characters.length,
      updatedAt: standalone?.metadata.updatedAt || file.mtime.toISOString()
    };
  }
}
