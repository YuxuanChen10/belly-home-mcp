import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DocumentStore } from "../src/document-store.mjs";

test("append maps every logical target to its fixed Belly Home path", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-store-"));
  const documents = new DocumentStore({
    rootDirectory,
    timeZone: "Australia/Melbourne",
    now: () => new Date("2026-09-17T02:34:00Z")
  });

  const targets = [
    ["daily", "Diary/2026-09-17.md"],
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

  await assert.rejects(() => documents.append({ target: "daily", content: "123456" }), /exceeds 5/);
  await assert.rejects(
    () => documents.append({ target: "daily", content: "ok", attachments: ["one", "two"] }),
    /exceeds 1 items/
  );
});
