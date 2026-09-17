import assert from "node:assert/strict";
import { test } from "node:test";
import { getBellyHomeBaseUrl, getBellyHomePort } from "../src/config.mjs";

test("one BELLY_HOME_PORT controls the local Gateway and MCP origin", () => {
  const environment = { BELLY_HOME_PORT: "43123" };
  assert.equal(getBellyHomePort(environment), 43123);
  assert.equal(getBellyHomeBaseUrl(environment), "http://127.0.0.1:43123");
  for (const value of ["0", "65536", "8787x", "12.5"]) {
    assert.throws(() => getBellyHomePort({ BELLY_HOME_PORT: value }), /BELLY_HOME_PORT/);
  }
});
