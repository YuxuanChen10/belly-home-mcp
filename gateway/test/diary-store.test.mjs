import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DiaryStore } from "../src/diary-store.mjs";

test("append creates today's diary file and appends later entries", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "diary-store-"));
  let now = new Date("2026-09-15T23:42:00Z");
  const diary = new DiaryStore({
    rootDirectory,
    timeZone: "Australia/Melbourne",
    now: () => now
  });

  const first = await diary.append({ title: "宝宝鸡第一次伸手", content: "正文 **原样** 保存\n- 一条" });
  assert.equal(first.status, "created");
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.equal(first.date, "2026-09-16");
  assert.equal(first.time, "09:42");
  assert.equal(first.version, 1);

  now = new Date("2026-09-16T13:18:00Z");
  const second = await diary.append({ content: "> 又想起一点事情" });
  assert.equal(second.status, "appended");
  assert.equal(second.date, "2026-09-16");
  assert.equal(second.time, "23:18");

  const text = await readFile(join(rootDirectory, "2026-09-16.md"), "utf8");
  assert.match(text, /# 2026-09-16 · 翎翎日记/);
  assert.match(text, new RegExp(`belly-home:diary-entry:${first.id}:start`));
  assert.match(text, /## 09:42 · 宝宝鸡第一次伸手/);
  assert.match(text, /正文 \*\*原样\*\* 保存\n- 一条/);
  assert.match(text, new RegExp(`belly-home:diary-entry:${second.id}:start`));
  assert.match(text, /## 23:18/);
  assert.match(text, /> 又想起一点事情/);

  const read = await diary.read({ date: "2026-09-16" });
  assert.deepEqual(read.entries.map((entry) => entry.id), [first.id, second.id]);
  assert.equal(read.content.includes("belly-home:diary-data"), false);
  assert.match(read.content, /宝宝鸡第一次伸手/);
});

test("read returns not_found without creating an empty diary file", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "diary-store-"));
  const diary = new DiaryStore({ rootDirectory, now: () => new Date("2026-09-16T00:00:00Z") });

  assert.deepEqual(await diary.read({ date: "2026-09-17" }), {
    status: "not_found",
    date: "2026-09-17"
  });
  assert.deepEqual((await diary.list()).entries, []);
});

test("list returns newest metadata only and supports before", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "diary-store-"));
  let now = new Date("2026-09-14T23:00:00Z");
  const diary = new DiaryStore({
    rootDirectory,
    timeZone: "Australia/Melbourne",
    now: () => now
  });

  await diary.append({ content: "first" });
  now = new Date("2026-09-15T23:00:00Z");
  await diary.append({ content: "second" });

  const all = await diary.list();
  assert.deepEqual(all.entries.map((entry) => entry.date), ["2026-09-16", "2026-09-15"]);
  assert.equal("content" in all.entries[0], false);

  const before = await diary.list({ before: "2026-09-16" });
  assert.deepEqual(before.entries.map((entry) => entry.date), ["2026-09-15"]);
});

test("rejects invalid dates and oversized content", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "diary-store-"));
  const diary = new DiaryStore({ rootDirectory, maxContentLength: 5 });

  await assert.rejects(() => diary.read({ date: "../secret" }), /YYYY-MM-DD/);
  await assert.rejects(() => diary.list({ before: "2026-9-16" }), /YYYY-MM-DD/);
  await assert.rejects(() => diary.append({ content: "123456" }), /exceeds 5 characters/);
});

test("update applies a partial patch, preserves identity, and snapshots the previous version", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "diary-store-"));
  let now = new Date("2026-09-17T00:00:00Z");
  const diary = new DiaryStore({
    rootDirectory,
    timeZone: "Australia/Melbourne",
    now: () => now
  });
  const created = await diary.append({
    title: "Original",
    content: "Original content",
    tags: ["life"]
  });

  now = new Date("2026-09-17T01:30:00Z");
  const updated = await diary.update(created.id, {
    title: "New Title",
    content: "Updated content...",
    tags: ["life", "study", "study"]
  });

  assert.equal(updated.message, "Diary Updated");
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, now.toISOString());
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.tags, ["life", "study"]);
  assert.deepEqual(updated.updatedFields, ["title", "content", "tags"]);

  const text = await readFile(join(rootDirectory, `${created.date}.md`), "utf8");
  assert.match(text, /## 10:00 · New Title/);
  assert.match(text, /Tags: #life #study/);
  assert.match(text, /Updated content\.\.\./);
  assert.doesNotMatch(text, /Original content/);

  const history = JSON.parse(
    await readFile(join(rootDirectory, ".history", created.id, "v1.json"), "utf8")
  );
  assert.equal(history.id, created.id);
  assert.equal(history.createdAt, created.createdAt);
  assert.equal(history.content, "Original content");
  assert.equal(history.version, 1);
});

test("update returns not found and rejects empty or invalid patches", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "diary-store-"));
  const diary = new DiaryStore({ rootDirectory, maxContentLength: 5, maxTags: 1 });
  const created = await diary.append({ content: "hello" });

  await assert.rejects(
    () => diary.update("00000000-0000-4000-8000-000000000000", { title: "Missing" }),
    /Diary Not Found/
  );
  await assert.rejects(() => diary.update(created.id, {}), /patch must include/);
  await assert.rejects(() => diary.update(created.id, { content: "123456" }), /exceeds 5/);
  await assert.rejects(() => diary.update(created.id, { tags: ["one", "two"] }), /exceeds 1/);
});
