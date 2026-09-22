import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DocumentStore } from "../src/document-store.mjs";

test("create writes a standalone version-one document with stable metadata", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  let now = new Date("2026-09-20T05:30:00Z");
  const documents = new DocumentStore({ rootDirectory, now: () => now });

  const result = await documents.create({
    target: "design",
    title: "Gateway Refactor",
    content: "Initial architecture content",
    tags: ["architecture", "architecture", "mcp"],
    attachments: ["diagram-reference"]
  });

  assert.equal(result.status, "created");
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.equal(result.target, "design");
  assert.equal(result.title, "Gateway Refactor");
  assert.deepEqual(result.tags, ["architecture", "mcp"]);
  assert.equal(result.version, 1);
  assert.equal(result.createdAt, now.toISOString());
  assert.equal(result.updatedAt, result.createdAt);
  assert.equal(result.attachmentCount, 1);
  assert.equal(result.path, join(rootDirectory, "Design", "Documents", `${result.id}.md`));

  const text = await readFile(result.path, "utf8");
  assert.match(text, /^<!-- belly-home:document-data:[A-Za-z0-9_-]+ -->/);
  assert.match(text, /^# Gateway Refactor$/m);
  assert.match(text, /Tags: #architecture #mcp/);
  assert.match(text, /Initial architecture content/);
  assert.match(text, /- diagram-reference/);

  const firstRead = await documents.read({ target: "design", title: "gateway refactor" });
  assert.equal(firstRead.status, "found");
  assert.equal(firstRead.id, result.id);
  assert.equal(firstRead.title, "Gateway Refactor");
  assert.equal(firstRead.version, 1);
  assert.equal(firstRead.content.includes("belly-home:document-data"), false);
  assert.match(firstRead.content, /Initial architecture content/);

  now = new Date("2026-09-20T06:30:00Z");
  const appended = await documents.append({
    target: "design",
    title: "GATEWAY REFACTOR",
    content: "Second architecture section"
  });
  assert.equal(appended.id, result.id);
  assert.equal(appended.version, 2);
  assert.equal(appended.updatedAt, now.toISOString());

  const secondRead = await documents.read({ target: "design", title: "Gateway Refactor" });
  assert.equal(secondRead.version, 2);
  assert.match(secondRead.content, /Initial architecture content/);
  assert.match(secondRead.content, /Second architecture section/);

  const concurrent = await Promise.all([
    documents.append({ target: "design", title: "Gateway Refactor", content: "Concurrent section one" }),
    documents.append({ target: "design", title: "Gateway Refactor", content: "Concurrent section two" })
  ]);
  assert.deepEqual(concurrent.map((item) => item.version), [3, 4]);
  const afterConcurrentAppend = await documents.read({ target: "design", title: "Gateway Refactor" });
  assert.equal(afterConcurrentAppend.version, 4);
  assert.match(afterConcurrentAppend.content, /Concurrent section one/);
  assert.match(afterConcurrentAppend.content, /Concurrent section two/);

  await assert.rejects(
    () => documents.create({ target: "design", title: " gateway refactor ", content: "duplicate" }),
    /already exists/
  );

  const crossTarget = await documents.create({
    target: "knowledge",
    title: "Gateway Refactor",
    content: "The same semantic title may exist in another target."
  });
  assert.notEqual(crossTarget.id, result.id);
  assert.equal(crossTarget.target, "knowledge");
});

test("create rejects invalid targets, titles, tags, and oversized content", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  const documents = new DocumentStore({ rootDirectory, maxContentLength: 5, maxTags: 1 });

  await assert.rejects(() => documents.create({ target: "daily", title: "Private", content: "ok" }), /target must be one of/);
  await assert.rejects(() => documents.create({ target: "design", title: "two\nlines", content: "ok" }), /single line/);
  await assert.rejects(() => documents.create({ target: "design", title: "Title", content: "123456" }), /exceeds 5/);
  await assert.rejects(() => documents.create({ target: "design", title: "Title", content: "ok", tags: ["one", "two"] }), /exceeds 1 items/);
  await assert.rejects(() => documents.append({ target: "design", title: "Missing", content: "ok" }), /Document Not Found/);

  const missing = await documents.read({ target: "design", title: "Missing" });
  assert.equal(missing.status, "not_found");
  assert.equal(missing.title, "Missing");
});

test("append maps every logical target to its fixed Belly Home path", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  const documents = new DocumentStore({
    rootDirectory,
    timeZone: "Australia/Melbourne",
    now: () => new Date("2026-09-17T02:34:00Z")
  });

  const targets = [
    ["design", "Design/Design Diary.md"],
    ["development", "Development/Development Log.md"],
    ["knowledge", "Knowledge/Lessons Learned.md"]
  ];

  for (const [target, relativePath] of targets) {
    const result = await documents.append({
      target,
      content: `${target} content`,
      attachments: ["attachment-ref-1"]
    });
    assert.equal(result.status, "created");
    assert.equal(result.target, target);
    assert.equal(result.attachmentCount, 1);

    const text = await readFile(join(rootDirectory, relativePath), "utf8");
    assert.match(text, new RegExp(`${target} content`));
    assert.match(text, /- attachment-ref-1/);
  }
});

test("append adds entries to stable documents and rejects arbitrary targets", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  const documents = new DocumentStore({ rootDirectory });

  await documents.append({ target: "design", content: "first" });
  const second = await documents.append({ target: "design", content: "second" });
  assert.equal(second.status, "appended");

  const text = await readFile(join(rootDirectory, "Design", "Design Diary.md"), "utf8");
  assert.equal((text.match(/^# Design Diary$/gm) || []).length, 1);
  await assert.rejects(
    () => documents.append({ target: "../../secret", content: "blocked" }),
    /target must be one of/
  );
});

test("append validates content and attachment references", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  const documents = new DocumentStore({ rootDirectory, maxContentLength: 5, maxAttachments: 1 });

  await assert.rejects(() => documents.append({ target: "design", content: "123456" }), /exceeds 5/);
  await assert.rejects(
    () => documents.append({ target: "design", content: "ok", attachments: ["one", "two"] }),
    /exceeds 1 items/
  );
});

test("read returns full documents and supports Unicode character pagination", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  const documents = new DocumentStore({ rootDirectory, maxReadLength: 20 });
  await documents.append({ target: "development", content: "A😀BCDE" });

  const full = await documents.read({ target: "development" });
  assert.equal(full.status, "found");
  assert.match(full.content, /A😀BCDE/);
  assert.equal(full.characterCount, Array.from(full.content).length);
  assert.equal(full.returnedCharacters, full.characterCount);
  assert.equal(full.hasMore, false);
  assert.match(full.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const emojiOffset = Array.from(full.content).indexOf("😀");
  const page = await documents.read({ target: "development", offset: emojiOffset, limit: 3 });
  assert.equal(page.content, "😀BC");
  assert.equal(page.returnedCharacters, 3);
  assert.equal(page.characterCount, full.characterCount);
  assert.equal(page.hasMore, true);
});

test("read maps only document targets and rejects the diary domain", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  const documents = new DocumentStore({ rootDirectory });

  for (const target of ["design", "development", "knowledge"]) {
    const missing = await documents.read({ target });
    assert.equal(missing.status, "not_found");
    assert.equal(missing.content, "");
    assert.equal(missing.hasMore, false);
  }

  await assert.rejects(() => documents.append({ target: "daily", content: "private" }), /target must be one of/);
  await assert.rejects(() => documents.read({ target: "daily" }), /target must be one of/);
});

test("read rejects arbitrary targets and invalid pagination", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  const documents = new DocumentStore({ rootDirectory, maxReadLength: 10 });

  await assert.rejects(() => documents.read({ target: "../../secret" }), /target must be one of/);
  await assert.rejects(() => documents.read({ target: "design", offset: -1 }), /non-negative integer/);
  await assert.rejects(() => documents.read({ target: "design", limit: 11 }), /from 1 to 10/);
});
