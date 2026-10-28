import { DocumentStore } from "../../src/modules/memory/document/store.mjs";

try {
  const documents = new DocumentStore({ rootDirectory: process.argv[2] });
  const result = await documents.update({ target: "design", title: "Process Race", expectedVersion: 1, content: process.argv[3] });
  process.stdout.write(`${result.version}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
