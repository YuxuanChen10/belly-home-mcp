import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
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
  assert.equal(result.filename, "Gateway-Refactor.md");
  assert.equal(result.path, join(rootDirectory, "Design", "Documents", result.filename));

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
    ["knowledge", "Knowledge/bugbooklet.md"]
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

test("Design update preserves identity, stores a recoverable revision, and rejects stale writes", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-update-"));
  let now = new Date("2026-10-28T01:00:00Z");
  const documents = new DocumentStore({ rootDirectory, now: () => now });
  const created = await documents.create({ target: "design", title: "Update Test", content: "# Update Test\n\nOriginal body", tags: ["test"] });
  assert.equal((await documents.read({ target: "design", title: "Update Test" })).rawBody, "# Update Test\n\nOriginal body");
  now = new Date("2026-10-28T02:00:00Z");
  const updated = await documents.update({ target: "design", title: "update test", expectedVersion: 1, content: "Replacement body\n", changeSummary: "Replace content" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, now.toISOString());
  assert.equal(updated.version, 2);
  const read = await documents.read({ target: "design", title: "Update Test" });
  assert.equal(read.rawBody, "Replacement body\n");
  assert.equal((read.content.match(/^# Update Test$/gm) || []).length, 1);
  assert.equal((read.content.match(/^Tags: #test$/gm) || []).length, 1);
  const revision = await documents.readRevision(created.id, 1);
  assert.equal(revision.body, "# Update Test\n\nOriginal body");
  assert.equal(revision.metadata.createdAt, created.createdAt);
  assert.equal(revision.changeSummary, "Replace content");
  await assert.rejects(() => documents.update({ target: "design", title: "Update Test", expectedVersion: 1, content: "Stale" }), /VERSION_CONFLICT/);
  assert.equal((await documents.read({ target: "design", title: "Update Test" })).rawBody, "Replacement body\n");
  const afterRestart = new DocumentStore({ rootDirectory });
  assert.equal((await afterRestart.readRevision(created.id, 1)).body, "# Update Test\n\nOriginal body");
  assert.equal((await afterRestart.read({ target: "design", title: "Update Test" })).version, 2);
});

test("Design concurrent updates across store instances allow exactly one winner", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-concurrent-"));
  const stores = [new DocumentStore({ rootDirectory }), new DocumentStore({ rootDirectory })];
  await stores[0].create({ target: "design", title: "Race", content: "Baseline" });
  const results = await Promise.allSettled(stores.map((store, index) => store.update({
    target: "design", title: "Race", expectedVersion: 1, content: `Winner ${index}`
  })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /VERSION_CONFLICT/);
  assert.equal((await stores[0].read({ target: "design", title: "Race" })).version, 2);
});

test("Design concurrent updates across processes allow exactly one winner", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-process-race-"));
  const documents = new DocumentStore({ rootDirectory });
  await documents.create({ target: "design", title: "Process Race", content: "Baseline" });
  const worker = new URL("./fixtures/document-update-worker.mjs", import.meta.url);
  const run = (body) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker.pathname, rootDirectory, body], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output, errors }));
  });
  const results = await Promise.all([run("First"), run("Second")]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 2]);
  assert.match(results.find((result) => result.code === 2).errors, /VERSION_CONFLICT/);
  assert.equal((await documents.read({ target: "design", title: "Process Race" })).version, 2);
});

test("Design update validates scope, title, body, and version without changing the document", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-invalid-"));
  const documents = new DocumentStore({ rootDirectory });
  await documents.create({ target: "design", title: "Safe", content: "Original" });
  await assert.rejects(() => documents.update({ target: "development", title: "Safe", expectedVersion: 1, content: "Bad" }), /target must be design/);
  await assert.rejects(() => documents.update({ target: "knowledge", title: "Safe", expectedVersion: 1, content: "Bad" }), /target must be design/);
  await assert.rejects(() => documents.update({ target: "design", title: "../Safe", expectedVersion: 1, content: "Bad" }), /Document Not Found/);
  await assert.rejects(() => documents.update({ target: "design", title: "Missing", expectedVersion: 1, content: "Bad" }), /Document Not Found/);
  await assert.rejects(() => documents.update({ target: "design", title: "Safe", expectedVersion: 0, content: "Bad" }), /expectedVersion/);
  await assert.rejects(() => documents.update({ target: "design", title: "Safe", expectedVersion: 1, content: "   " }), /content is required/);
  assert.equal((await documents.read({ target: "design", title: "Safe" })).rawBody, "Original");
});

test("Design update leaves the current document intact when revision persistence fails", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-write-failure-"));
  const documents = new DocumentStore({ rootDirectory });
  await documents.create({ target: "design", title: "Failure Test", content: "Unchanged" });
  await writeFile(join(rootDirectory, "Design", "Documents", ".revisions"), "blocked");
  await assert.rejects(() => documents.update({
    target: "design", title: "Failure Test", expectedVersion: 1, content: "Must not appear"
  }));
  const current = await documents.read({ target: "design", title: "Failure Test" });
  assert.equal(current.version, 1);
  assert.equal(current.rawBody, "Unchanged");
});

test("readable filenames avoid case-insensitive collisions and unmanaged Markdown", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-filenames-"));
  const documents = new DocumentStore({ rootDirectory });
  const directory = documents.documentsDirectory("design");
  await documents.create({ target: "design", title: "My Test", content: "one" });
  const caseCollision = await documents.create({ target: "design", title: "my-test", content: "two" });
  assert.equal(caseCollision.filename, "my-test--2.md");
  const punctuation = await documents.create({ target: "design", title: "A/B", content: "three" });
  assert.equal(punctuation.filename, "A-B.md");
  const punctuationCollision = await documents.create({ target: "design", title: "A:B", content: "four" });
  assert.equal(punctuationCollision.filename, "A-B--2.md");
  const unicode = await documents.create({ target: "design", title: "系统 设计", content: "five" });
  assert.equal(unicode.filename, "系统-设计.md");
  const extension = await documents.create({ target: "design", title: "Report.md", content: "extension" });
  assert.equal(extension.filename, "Report.md");
  await writeFile(join(directory, "Unmanaged.md"), "# Unmanaged");
  await writeFile(join(directory, "Malformed.md"), "<!-- belly-home:document-data:broken -->\n# Malformed");
  const unmanagedCollision = await documents.create({ target: "design", title: "Unmanaged", content: "six" });
  assert.equal(unmanagedCollision.filename, "Unmanaged--2.md");
  assert.equal((await readFile(join(directory, "Unmanaged.md"), "utf8")), "# Unmanaged");
  assert.equal((await documents.read({ target: "design", title: "missing" })).status, "not_found");
  assert.equal((await documents.read({ target: "design", title: "系统 设计" })).id, unicode.id);
});

test("legacy UUID documents remain readable, appendable, and updateable", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-legacy-"));
  const documents = new DocumentStore({ rootDirectory });
  const created = await documents.create({ target: "design", title: "Legacy", content: "Original" });
  const oldPath = created.path;
  const legacyPath = documents.createdDocumentPath("design", created.id);
  const stored = await readFile(oldPath, "utf8");
  const metadata = { id: created.id, target: "design", title: "Legacy", tags: [], version: 1, createdAt: created.createdAt, updatedAt: created.updatedAt };
  const encoded = Buffer.from(JSON.stringify(metadata)).toString("base64url");
  await writeFile(oldPath, stored.replace(/^<!-- belly-home:document-data:[A-Za-z0-9_-]+ -->/, `<!-- belly-home:document-data:${encoded} -->`));
  await rename(oldPath, legacyPath);
  await writeFile(documents.titleClaimPath("design", "Legacy"), `${JSON.stringify({ id: created.id, title: "Legacy" })}\n`);
  assert.equal((await documents.read({ target: "design", title: "Legacy" })).filename, `${created.id}.md`);
  const appended = await documents.append({ target: "design", title: "Legacy", content: "Added" });
  assert.equal(appended.version, 2);
  const updated = await documents.update({ target: "design", title: "Legacy", expectedVersion: 2, content: "Replacement" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.filename, `${created.id}.md`);
  assert.equal((await documents.readRevision(created.id, 2)).metadata.id, created.id);
  assert.equal((await documents.read({ target: "design", title: "Legacy" })).rawBody, "Replacement");
  assert.equal((await readFile(legacyPath, "utf8")).includes("Replacement"), true);
});

test("concurrent creates allocate distinct case-insensitive filenames", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-create-race-"));
  const first = new DocumentStore({ rootDirectory });
  const second = new DocumentStore({ rootDirectory });
  const created = await Promise.all([
    first.create({ target: "design", title: "Race Name", content: "first" }),
    second.create({ target: "design", title: "race-name", content: "second" })
  ]);
  assert.equal(new Set(created.map((item) => item.filename.toLocaleLowerCase("en-US"))).size, 2);
  assert.equal(new Set(created.map((item) => item.id)).size, 2);
  assert.equal((await first.read({ target: "design", title: "Race Name" })).id, created[0].id);
  assert.equal((await second.read({ target: "design", title: "race-name" })).id, created[1].id);
});
