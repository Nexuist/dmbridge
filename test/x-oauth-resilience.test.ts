import assert from "node:assert/strict";
import test from "node:test";

import {
  beginXOAuth,
  completeXOAuth,
  ensureFreshXOAuth,
  normalizeXCredential,
} from "../src/providers/x/index.js";
import { mockFetch, temporaryStore, xCredential } from "./helpers.js";

const credential = () =>
  xCredential({
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: Date.now() - 1,
    accountUserID: "owner",
  });

test("X credentials reject legacy nested import envelopes", () => {
  assert.throws(
    () => normalizeXCredential({
      client: {
        clientID: "oauth-client",
        clientType: "public",
        redirectURI: "http://localhost/callback",
      },
      tokens: {
        accessToken: "access",
        expiresAt: Date.now() + 60_000,
        accountUserID: "owner-id",
        accountUsername: "owner",
      },
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "bridge.invalidRequest");
      return true;
    },
  );
});

test("one accounts-add OAuth flow generates a link and completes its callback", async (t) => {
  const { store } = await temporaryStore("dmbridge-oauth-add-");
  const client = {
    clientID: "oauth-client",
    clientSecret: null,
    clientType: "public" as const,
    redirectURI: "http://localhost/callback",
    realmTokenIssuerURL: null,
  };
  const begun = await beginXOAuth(store, "personal", client);
  const authorizationURL = new URL(begun.authorizationURL);
  assert.equal(authorizationURL.searchParams.get("client_id"), "oauth-client");
  const state = authorizationURL.searchParams.get("state");
  assert.ok(state);

  mockFetch(t, async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2/token")) {
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /grant_type=authorization_code/);
      return new Response(JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 7200,
        scope: "users.read tweet.read dm.read dm.write offline.access",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.match(url, /\/2\/users\/me$/);
    return new Response(JSON.stringify({
      data: { id: "owner-id", username: "owner" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const completed = await completeXOAuth(store, "personal", {
    callbackURL: `http://localhost/callback?code=oauth-code&state=${state}`,
  });
  assert.equal(completed.authorized, true);
  assert.equal(completed.account, "personal");
  const saved = normalizeXCredential(
    await store.readCredential("x", "personal"),
  );
  assert.equal(saved.clientID, "oauth-client");
  assert.equal(saved.accessToken, "new-access");
  assert.equal(saved.accountUserID, "owner-id");
});

test("expiring X OAuth credentials refresh and persist rotated tokens atomically", async (t) => {
  mockFetch(t, async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.match(String(init?.body), /refresh_token=old-refresh/);
    return new Response(
      JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 7200,
        scope: "users.read tweet.read dm.read dm.write offline.access",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const { store } = await temporaryStore("dmbridge-refresh-");
  await store.storeCredential("x", "personal", credential());
  const refreshed = await ensureFreshXOAuth(
    store,
    "personal",
    credential(),
  );
  assert.equal(refreshed.accessToken, "new-access");
  assert.equal(refreshed.refreshToken, "new-refresh");
  const saved = normalizeXCredential(
    await store.readCredential("x", "personal"),
  );
  assert.equal(saved.accessToken, "new-access");
  assert.equal(saved.refreshToken, "new-refresh");
});

test("rejected X refresh produces an actionable reauthorization error", async (t) => {
  mockFetch(t, async () =>
    new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
  const { store } = await temporaryStore("dmbridge-reauth-");
  await assert.rejects(
    ensureFreshXOAuth(store, "personal", credential()),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "auth.reauthorizationRequired",
      );
      assert.match((error as Error).message, /accounts add x/);
      return true;
    },
  );
});
