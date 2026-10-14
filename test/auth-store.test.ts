import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  forgetXPasscode,
  storePendingXOAuth,
  storeXPasscode,
  xPasscodeStatus,
} from "../src/providers/x/index.js";
import { temporaryStore } from "./helpers.js";

test("AuthStore keeps multiple accounts and secrets private", async () => {
  const { home, store } = await temporaryStore("dmbridge-auth-");
  await store.storeCredential("instagram", "personal", {
    accessToken: "test-token",
  });
  await store.storeCredential("instagram", "studio", {
    accessToken: "test-token-2",
  });
  assert.deepEqual(await store.listAccounts("instagram"), ["personal", "studio"]);
  assert.equal(await store.resolveAccount("instagram", "studio"), "studio");

  const credentialPath = join(
    home,
    "auth",
    "instagram",
    "personal",
    "credentials.json",
  );
  assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
  assert.match(await readFile(credentialPath, "utf8"), /test-token/);
});

test("stored XChat passcode is forgotten after rejection", async () => {
  const { store } = await temporaryStore("dmbridge-passcode-");
  await store.storeCredential("x", "personal", { test: true });
  const passcode = new TextEncoder().encode("2580");
  await storeXPasscode(store, "personal", passcode);
  assert.deepEqual(await xPasscodeStatus(store, "personal"), {
    stored: true,
    enabled: true,
  });
  await forgetXPasscode(store, "personal");
  assert.deepEqual(await xPasscodeStatus(store, "personal"), {
    stored: false,
    enabled: false,
  });
});

test("AuthStore rejects malformed persisted credential envelopes", async () => {
  const { home, store } = await temporaryStore("dmbridge-invalid-auth-");
  await store.storeCredential("instagram", "personal", {
    accessToken: "test-token",
  });
  await writeFile(
    join(home, "auth", "instagram", "personal", "credentials.json"),
    JSON.stringify({
      version: 1,
      provider: "instagram",
      account: "personal",
    }),
  );
  await assert.rejects(
    store.readCredential("instagram", "personal"),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "auth.invalidCredential",
      );
      return true;
    },
  );
});

test("expired OAuth PKCE state is pruned before a new authorization", async () => {
  const { home, store } = await temporaryStore("dmbridge-oauth-state-");
  await storePendingXOAuth(store, {
    version: 2,
    account: "personal",
    client: {
      clientID: "client",
      clientSecret: null,
      clientType: "public",
      redirectURI: "http://localhost/callback",
      realmTokenIssuerURL: null,
    },
    state: "a".repeat(32),
    verifier: "expired-verifier",
    expiresAt: Date.now() - 1,
  });
  await storePendingXOAuth(store, {
    version: 2,
    account: "personal",
    client: {
      clientID: "client",
      clientSecret: null,
      clientType: "public",
      redirectURI: "http://localhost/callback",
      realmTokenIssuerURL: null,
    },
    state: "b".repeat(32),
    verifier: "current-verifier",
    expiresAt: Date.now() + 60_000,
  });
  assert.deepEqual(
    await readdir(join(home, "state", "x-oauth")),
    [`${"b".repeat(32)}.json`],
  );
});
