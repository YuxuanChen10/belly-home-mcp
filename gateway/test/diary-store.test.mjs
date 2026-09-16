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
  assert.equal(first.date, "2026-09-16");
  assert.equal(first.time, "09:42");

  now = new Date("2026-09-16T13:18:00Z");
  const second = await diary.append({ content: "> 又想起一点事情" });
  assert.equal(second.status, "appended");
  assert.equal(second.date, "2026-09-16");
  assert.equal(second.time, "23:18");

  const text = await readFile(join(rootDirectory, "2026-09-16.md"), "utf8");
  assert.equal(text, [
    "# 2026-09-16 · 翎翎日记",
    "> Australia/Melbourne",
    "",
    "## 09:42 · 宝宝鸡第一次伸手",
    "",
    "正文 **原样** 保存",
    "- 一条",
    "",
    "## 23:18",
    "",
    "> 又想起一点事情",
    ""
  ].join("\n"));
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
