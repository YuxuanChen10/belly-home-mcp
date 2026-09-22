import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const gatewayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, { input, environment = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: environment, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.once("error", reject);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("exit", (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

async function expectMoveError(binary, environment, snapshotId, move, code) {
  const result = await run(binary, ["move"], {
    input: { snapshotId, moves: [move] },
    environment: { ...environment, BELLY_DESKTOP_TEST_CONFIRMATION: "approve" }
  });
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).code, code);
}

test("native Desktop Helper lists first-level metadata and only moves loose files", { timeout: 60_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), "belly-desktop-native-"));
  const root = join(fixture, "Desktop");
  const state = join(fixture, "state");
  const binary = join(fixture, "belly-desktop-helper");
  await mkdir(join(root, "University", "COMP90015"), { recursive: true });
  await mkdir(join(root, "Career"), { recursive: true });
  await mkdir(join(root, "Example.app", "Contents"), { recursive: true });
  await mkdir(join(root, ".hidden"), { recursive: true });
  await writeFile(join(root, "University", "COMP90015", "notes.pdf"), "PRIVATE COURSE NOTES");
  await writeFile(join(root, "University", "Resume.pdf"), "EXISTING RESUME");
  await writeFile(join(root, "Resume.pdf"), "LOOSE RESUME");
  await writeFile(join(root, "abc.png"), "LOOSE IMAGE");
  await writeFile(join(root, "Example.app", "Contents", "private.txt"), "PACKAGE CONTENT");
  await writeFile(join(root, ".hidden", "secret.txt"), "HIDDEN CONTENT");
  await symlink("/tmp", join(root, "outside-link"));

  const build = await run(process.execPath, [
    join(gatewayRoot, "scripts", "build-desktop-helper.mjs"),
    "--debug",
    `--output=${binary}`
  ]);
  assert.equal(build.code, 0, build.stderr);

  const baseEnvironment = {
    ...process.env,
    BELLY_DESKTOP_TEST_ROOT: root,
    BELLY_DESKTOP_TEST_STATE_DIR: state
  };
  const listed = await run(binary, ["list"], { input: {}, environment: baseEnvironment });
  assert.equal(listed.code, 0, listed.stderr);
  const snapshot = JSON.parse(listed.stdout);
  assert.deepEqual(snapshot.folders.map((item) => item.relativePath), ["Career", "University"]);
  assert.deepEqual(snapshot.looseFiles.map((item) => item.relativePath), ["abc.png", "Resume.pdf"]);
  assert.equal(JSON.stringify(snapshot).includes("COMP90015"), false);
  assert.equal(JSON.stringify(snapshot).includes("private.txt"), false);
  assert.equal(JSON.stringify(snapshot).includes("outside-link"), false);
  assert.deepEqual(Object.keys(snapshot.folders[0]).sort(), ["folderName", "relativePath"]);
  assert.deepEqual(Object.keys(snapshot.looseFiles[0]).sort(), ["extension", "filename", "relativePath"]);

  const resumeMove = {
    sourceRelativePath: "Resume.pdf",
    destinationRelativePath: "University/Resume.pdf"
  };
  const cancelled = await run(binary, ["move"], {
    input: { snapshotId: snapshot.snapshotId, moves: [resumeMove] },
    environment: { ...baseEnvironment, BELLY_DESKTOP_TEST_CONFIRMATION: "cancel" }
  });
  assert.equal(cancelled.code, 0, cancelled.stderr);
  assert.equal(JSON.parse(cancelled.stdout).status, "cancelled");
  assert.equal(await readFile(join(root, "Resume.pdf"), "utf8"), "LOOSE RESUME");

  const moved = await run(binary, ["move"], {
    input: { snapshotId: snapshot.snapshotId, moves: [resumeMove] },
    environment: { ...baseEnvironment, BELLY_DESKTOP_TEST_CONFIRMATION: "approve" }
  });
  assert.equal(moved.code, 0, moved.stderr);
  const movedResponse = JSON.parse(moved.stdout);
  assert.equal(movedResponse.status, "moved");
  assert.equal(movedResponse.results[0].destinationRelativePath, "University/Resume (1).pdf");
  assert.equal(await readFile(join(root, "University", "Resume.pdf"), "utf8"), "EXISTING RESUME");
  assert.equal(await readFile(join(root, "University", "Resume (1).pdf"), "utf8"), "LOOSE RESUME");

  await expectMoveError(binary, baseEnvironment, snapshot.snapshotId, {
    sourceRelativePath: "University",
    destinationRelativePath: "Career/University"
  }, "SOURCE_NOT_LOOSE_FILE");
  await expectMoveError(binary, baseEnvironment, snapshot.snapshotId, {
    sourceRelativePath: "University/COMP90015/notes.pdf",
    destinationRelativePath: "Career/notes.pdf"
  }, "SOURCE_NOT_TOP_LEVEL");
  await expectMoveError(binary, baseEnvironment, snapshot.snapshotId, {
    sourceRelativePath: "abc.png",
    destinationRelativePath: "Career/Images/abc.png"
  }, "DESTINATION_NOT_TOP_LEVEL_FOLDER");
  await expectMoveError(binary, baseEnvironment, snapshot.snapshotId, {
    sourceRelativePath: "abc.png",
    destinationRelativePath: "Archive/abc.png"
  }, "DESTINATION_FOLDER_NOT_FOUND");
  await expectMoveError(binary, baseEnvironment, snapshot.snapshotId, {
    sourceRelativePath: "abc.png",
    destinationRelativePath: "Career/renamed.png"
  }, "RENAME_NOT_ALLOWED");

  const defaultCancelled = await run(binary, ["move"], {
    input: {
      snapshotId: snapshot.snapshotId,
      moves: [{ sourceRelativePath: "abc.png", destinationRelativePath: "Default/abc.png" }]
    },
    environment: { ...baseEnvironment, BELLY_DESKTOP_TEST_CONFIRMATION: "cancel" }
  });
  assert.equal(JSON.parse(defaultCancelled.stdout).status, "cancelled");
  await assert.rejects(access(join(root, "Default")));

  const defaultMoved = await run(binary, ["move"], {
    input: {
      snapshotId: snapshot.snapshotId,
      moves: [{ sourceRelativePath: "abc.png", destinationRelativePath: "Default/abc.png" }]
    },
    environment: { ...baseEnvironment, BELLY_DESKTOP_TEST_CONFIRMATION: "approve" }
  });
  assert.equal(defaultMoved.code, 0, defaultMoved.stderr);
  assert.equal(JSON.parse(defaultMoved.stdout).status, "moved");
  assert.equal(await readFile(join(root, "Default", "abc.png"), "utf8"), "LOOSE IMAGE");
});
