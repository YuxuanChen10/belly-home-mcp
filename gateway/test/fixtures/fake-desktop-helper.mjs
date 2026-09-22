#!/usr/bin/env node

const command = process.argv[2];
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

if (command === "list") {
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    snapshotId: "8d01dba2-a763-47ed-8ce0-857a34ac83ae",
    folders: [{ folderName: "Career", relativePath: "Career" }],
    looseFiles: [{ filename: "Resume.pdf", relativePath: "Resume.pdf", extension: "pdf" }],
    expiresAt: "2026-09-21T06:00:00Z",
    ...(request.debugEnvironment ? {
      environmentHasAlarmToken: Object.hasOwn(process.env, "ALARM_PLUGIN_TOKEN")
    } : {})
  })}\n`);
} else if (command === "move") {
  process.stdout.write(`${JSON.stringify({
    status: "moved",
    requestedCount: request.moves.length,
    movedCount: request.moves.length,
    failedCount: 0,
    results: request.moves.map((move) => ({ ...move, status: "moved" }))
  })}\n`);
} else {
  process.stdout.write('{"status":"error","code":"INVALID_COMMAND","message":"invalid"}\n');
  process.exitCode = 1;
}
