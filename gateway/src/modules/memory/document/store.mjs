import { constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { access, link, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

const TARGETS = Object.freeze({
  design: { directory: "Design", file: "Design Diary.md", title: "Design Diary" },
  development: { directory: "Development", file: "Development Log.md", title: "Development Log" },
  knowledge: { directory: "Knowledge", file: "bugbooklet.md", title: "bugbooklet" }
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

function decodeMetadataIfPresent(document) {
  const match = /^<!-- belly-home:document-data:([A-Za-z0-9_-]+) -->/.exec(document);
  if (!match) return null;
  return JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
}

function decodeMetadata(document) {
  const metadata = decodeMetadataIfPresent(document);
  if (!metadata) throw new Error("document metadata is missing");
  return metadata;
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

function authoredBody(document, metadata) {
  const readable = readableDocument(document);
  const heading = `# ${metadata.title}\n`;
  const tags = metadata.tags.length > 0
    ? `\nTags: ${metadata.tags.map((tag) => `#${tag}`).join(" ")}\n\n`
    : "";
  const prefix = heading + tags;
  if (!readable.startsWith(prefix)) throw new Error("document serialization is invalid");
  return readable.slice(prefix.length);
}

function validateStandalone(metadata, filePath) {
  if (!metadata || metadata.target !== "design" || !Number.isSafeInteger(metadata.version)
    || metadata.version < 1 || (metadata.filename || `${metadata.id}.md`) !== basename(filePath)
    || typeof metadata.title !== "string" || typeof metadata.createdAt !== "string"
    || typeof metadata.updatedAt !== "string" || !Array.isArray(metadata.tags)) {
    throw new Error("document metadata is invalid");
  }
}

async function durableWrite(path, content) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function durableCreate(path, content) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await durableWrite(temporaryPath, content);
    await link(temporaryPath, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withDocumentLock(filePath, operation) {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")); } catch {}
      let alive = false;
      if (Number.isInteger(owner?.pid)) {
        try { process.kill(owner.pid, 0); alive = true; } catch (error) { alive = error?.code === "EPERM"; }
      }
      let age;
      try { age = Date.now() - (await stat(lockPath)).mtimeMs; }
      catch (error) { if (error?.code === "ENOENT") continue; throw error; }
      if (!alive && age > (owner ? 1_000 : 5_000)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error("document lock timed out");
      await delay(25);
    }
  }
  try {
    await durableWrite(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid }));
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function titleKey(title) {
  return title.normalize("NFKC").toLocaleLowerCase("en-US");
}

function filenameKey(filename) {
  return filename.normalize("NFKC").toLocaleLowerCase("en-US");
}

function filenameStem(title) {
  let stem = title.normalize("NFC").replace(/\.md$/i, "")
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!stem) stem = "Document";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `Document-${stem}`;
  while (Buffer.byteLength(stem, "utf8") > 180) stem = Array.from(stem).slice(0, -1).join("");
  return stem.replace(/[._-]+$/g, "") || "Document";
}

function managedMetadata(document, target) {
  let metadata;
  try { metadata = decodeMetadataIfPresent(document); } catch { return null; }
  if (!metadata || metadata.target !== target || !/^[0-9a-f-]{36}$/i.test(metadata.id)
    || typeof metadata.title !== "string" || !Number.isSafeInteger(metadata.version)
    || metadata.version < 1) return null;
  return metadata;
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

  documentPath(target, filename) {
    if (typeof filename !== "string" || basename(filename) !== filename || !filename.endsWith(".md")) {
      throw new Error("document filename is invalid");
    }
    return join(this.documentsDirectory(target), filename);
  }

  revisionPath(id, version) {
    if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isSafeInteger(version) || version < 1) {
      throw new Error("invalid revision reference");
    }
    return join(this.documentsDirectory("design"), ".revisions", id, `${version}.json`);
  }

  async readRevision(id, version) {
    const revision = JSON.parse(await readFile(this.revisionPath(id, version), "utf8"));
    if (revision.format !== 1 || revision.metadata?.id !== id || revision.metadata.version !== version
      || revision.metadata.target !== "design" || typeof revision.body !== "string"
      || typeof revision.serializedDocument !== "string"
      || authoredBody(revision.serializedDocument, revision.metadata) !== revision.body) {
      throw new Error("stored revision is invalid");
    }
    return revision;
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
      let claim;
      try { claim = JSON.parse(await readFile(claimPath, "utf8")); } catch {}
      if (/^[0-9a-f-]{36}$/i.test(claim?.id) && (!claim.filename || (basename(claim.filename) === claim.filename && claim.filename.endsWith(".md")))) {
        const filePath = this.documentPath(target, claim.filename || `${claim.id}.md`);
        if (await pathExists(filePath)) {
          const document = await readFile(filePath, "utf8");
          const metadata = managedMetadata(document, target);
          if (metadata?.id === claim.id && titleKey(metadata.title) === titleKey(normalizedTitle)) {
            return { filePath, document, metadata };
          }
        }
      }
    }

    let entries;
    try {
      entries = await readdir(this.documentsDirectory(target), { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = join(this.documentsDirectory(target), entry.name);
      const document = await readFile(filePath, "utf8");
      const metadata = managedMetadata(document, target);
      if (!metadata) continue;
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
    const baseMetadata = {
      id,
      target,
      title: normalizedTitle,
      tags: normalizedTags,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const claimPath = this.titleClaimPath(target, normalizedTitle);
    await mkdir(dirname(claimPath), { recursive: true });
    const directory = this.documentsDirectory(target);
    return withDocumentLock(join(directory, ".filename-allocation"), async () => {
      if (await this.findStandaloneDocument(target, normalizedTitle) || await pathExists(claimPath)) {
        throw new Error("a document with this title already exists in the target");
      }
      const used = new Set((await readdir(directory)).map(filenameKey));
      const stem = filenameStem(normalizedTitle);
      for (let suffix = 1; ; suffix += 1) {
        const filename = `${stem}${suffix === 1 ? "" : `--${suffix}`}.md`;
        if (used.has(filenameKey(filename))) continue;
        const filePath = this.documentPath(target, filename);
        const metadata = { ...baseMetadata, filename };
        try {
          await durableWrite(filePath, createdDocument(metadata, normalizedContent, normalizedAttachments));
        } catch (error) {
          if (error?.code === "EEXIST") { used.add(filenameKey(filename)); continue; }
          await rm(filePath, { force: true });
          throw error;
        }
        let claimCreated = false;
        try {
          await durableCreate(claimPath, `${JSON.stringify({ id, title: normalizedTitle, filename })}\n`);
          claimCreated = true;
          await syncDirectory(directory);
        } catch (error) {
          await rm(filePath, { force: true });
          if (claimCreated) await rm(claimPath, { force: true });
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
    });
  }

  async update({ target, title, expectedVersion, content, changeSummary } = {}) {
    if (target !== "design") throw new Error("target must be design");
    const normalizedTitle = normalizeTitle(title);
    const normalizedContent = normalizeContent(content, this.maxContentLength);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("expectedVersion must be a positive integer");
    }
    if (changeSummary !== undefined && (typeof changeSummary !== "string"
      || changeSummary.trim().length === 0 || changeSummary.length > 500)) {
      throw new Error("changeSummary must contain 1 to 500 characters");
    }
    const initial = await this.findStandaloneDocument("design", normalizedTitle);
    if (!initial) throw new Error("Document Not Found");
    return withDocumentLock(initial.filePath, async () => {
      const found = await this.findStandaloneDocument("design", normalizedTitle);
      if (!found || found.filePath !== initial.filePath) throw new Error("Document Not Found");
      validateStandalone(found.metadata, found.filePath);
      if (found.metadata.version !== expectedVersion) {
        throw new Error(`VERSION_CONFLICT: current version is ${found.metadata.version}`);
      }
      const body = authoredBody(found.document, found.metadata);
      const revision = {
        format: 1,
        metadata: found.metadata,
        body,
        serializedDocument: found.document,
        ...(changeSummary === undefined ? {} : { changeSummary: changeSummary.trim() })
      };
      const revisionPath = this.revisionPath(found.metadata.id, found.metadata.version);
      await mkdir(dirname(revisionPath), { recursive: true });
      try {
        await durableCreate(revisionPath, `${JSON.stringify(revision)}\n`);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const saved = await this.readRevision(found.metadata.id, found.metadata.version);
        if (saved.serializedDocument !== found.document) {
          throw new Error("stored revision conflicts with current document");
        }
      }
      const metadata = {
        ...found.metadata,
        version: found.metadata.version + 1,
        updatedAt: new Date(Math.max(this.now().getTime(), Date.parse(found.metadata.updatedAt) + 1)).toISOString()
      };
      const nextDocument = createdDocument(metadata, normalizedContent, []);
      const temporaryPath = `${found.filePath}.${randomUUID()}.tmp`;
      try {
        await durableWrite(temporaryPath, nextDocument);
        await rename(temporaryPath, found.filePath);
        await syncDirectory(dirname(found.filePath));
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
      const file = await stat(found.filePath);
      return { status: "updated", ...metadata, filename: basename(found.filePath), path: found.filePath, size: file.size };
    });
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
        const initial = await this.findStandaloneDocument(target, normalizedTitle);
        if (!initial) throw new Error("Document Not Found");
        const operation = async () => {
        const found = await this.findStandaloneDocument(target, normalizedTitle);
        if (!found || found.filePath !== initial.filePath) throw new Error("Document Not Found");
        const currentTime = this.now();
        const { date, time } = localParts(currentTime, this.timeZone);
        const metadata = {
          ...found.metadata,
          version: found.metadata.version + 1,
          updatedAt: currentTime.toISOString()
        };
        const entry = `\n## ${date} ${time}\n\n${normalizedContent}${attachmentBlock(normalizedAttachments)}\n`;
        const nextDocument = `${replaceMetadata(found.document, metadata).trimEnd()}\n${entry}`;
        const temporaryPath = `${found.filePath}.${randomUUID()}.tmp`;
        try {
          await durableWrite(temporaryPath, nextDocument);
          await rename(temporaryPath, found.filePath);
          if (target === "design") await syncDirectory(dirname(found.filePath));
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
          filename: basename(found.filePath),
          date,
          time,
          version: metadata.version,
          updatedAt: metadata.updatedAt,
          attachmentCount: normalizedAttachments.length,
          path: found.filePath,
          size: file.size
        };
        };
        return target === "design" ? withDocumentLock(initial.filePath, operation) : operation();
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
        filename: basename(standalone.filePath),
        tags: standalone.metadata.tags,
        version: standalone.metadata.version,
        createdAt: standalone.metadata.createdAt,
        ...(target === "design" ? (() => {
          try { return { rawBody: authoredBody(storedContent, standalone.metadata) }; }
          catch { return {}; }
        })() : {})
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
