import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function plist(name) {
  return readFile(join(root, "launchd", name), "utf8");
}

test("LaunchAgent plists use stable runtime and log directories", async () => {
  for (const file of ["com.belly.home.gateway.plist", "com.belly.home.mcp-http.plist"]) {
    const text = await plist(file);
    assert.match(text, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(text, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.match(text, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/cc\/Library\/Application Support\/Belly Home Infra\/Runtime<\/string>/);
    assert.match(text, /<key>StandardOutPath<\/key>\s*<string>\/Users\/cc\/Library\/Logs\/Belly Home Infra\//);
    assert.match(text, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/cc\/Library\/Logs\/Belly Home Infra\//);
    assert.doesNotMatch(text, /<key>WorkingDirectory<\/key>\s*<string>[^<]*(Desktop|Documents|Downloads)/);
  }
});
