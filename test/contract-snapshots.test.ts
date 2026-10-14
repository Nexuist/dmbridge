import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { getCLIHelp } from "../src/commands.js";
import {
  AccountAddRequestSchema,
  schemas,
  SCHEMA_VERSION,
} from "../src/protocol.js";

const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const snapshot = (name: string) =>
  readFile(join(process.cwd(), "test", "snapshots", name), "utf8");

test("public command catalog matches its reviewed snapshot", async () => {
  assert.equal(
    serialize(getCLIHelp().commands),
    await snapshot("command-catalog.json"),
  );
});

test("public schemas match their reviewed versioned snapshot", async () => {
  assert.equal(
    serialize({ schemaVersion: SCHEMA_VERSION, schemas }),
    await snapshot("schemas.json"),
  );
});

test("account setup accepts exactly the four published request shapes", () => {
  const accepted = [
    { accessToken: "instagram-token" },
    {
      clientID: "x-client",
      clientType: "public",
      clientSecret: null,
      redirectURI: "http://localhost/callback",
    },
    { callbackURL: "http://localhost/callback?code=code&state=state" },
    { code: "code", state: "state" },
  ];
  for (const value of accepted) {
    assert.equal(AccountAddRequestSchema.safeParse(value).success, true);
  }

  for (const value of [
    {},
    { token: "legacy-token" },
    { callbackURL: "http://localhost/callback", extra: true },
    { code: "code" },
    { code: "code", state: "state", callbackURL: "http://localhost/callback" },
  ]) {
    assert.equal(AccountAddRequestSchema.safeParse(value).success, false);
  }

  const emitted = schemas["accounts.add.request"];
  assert.ok(Array.isArray(emitted.oneOf));
  assert.equal(emitted.oneOf.length, 4);
  assert.equal("anyOf" in emitted, false);
});
