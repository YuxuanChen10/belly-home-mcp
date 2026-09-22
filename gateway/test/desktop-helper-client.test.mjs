import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DesktopHelperClient } from "../src/modules/desktop/helper-client.mjs";

const gatewayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Desktop Helper client uses a narrow environment and transports metadata and moves", async () => {
  const client = new DesktopHelperClient({
    helperPath: process.execPath,
    helperArguments: [join(gatewayRoot, "test", "fixtures", "fake-desktop-helper.mjs")],
    environment: {
      ...process.env,
      ALARM_PLUGIN_TOKEN: "must-not-reach-helper"
    }
  });

  const listed = await client.readFileNames();
  assert.equal(listed.folders[0].folderName, "Career");
  assert.equal(listed.looseFiles[0].filename, "Resume.pdf");
  const environmentProbe = await client.invoke("list", { debugEnvironment: true }, 30_000);
  assert.equal(environmentProbe.environmentHasAlarmToken, false);

  const moved = await client.moveFiles({
    snapshotId: listed.snapshotId,
    moves: [{ sourceRelativePath: "Resume.pdf", destinationRelativePath: "Career/Resume.pdf" }]
  });
  assert.equal(moved.status, "moved");
  assert.equal(moved.movedCount, 1);
});
