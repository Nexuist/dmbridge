import { createHash, randomBytes } from "node:crypto";

import {
  asDmbridgeError,
  DmbridgeError,
  invalidRequest,
} from "../../protocol.js";
import {
  normalizeXOAuthCompletion,
  normalizeXCredential,
  type XOAuthClient,
  type XCredential,
} from "./credentials.js";
import { record, string } from "../normalize.js";
import type { AuthStore } from "../../auth.js";
import { timeoutSignal } from "../../runtime.js";
import { consumePendingXOAuth, storePendingXOAuth } from "./state.js";

const X_AUTHORIZATION_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_SCOPES = [
  "dm.read",
  "dm.write",
  "tweet.read",
  "users.read",
  "media.write",
  "offline.access",
];
export const X_REFRESH_EARLY_MS = 60_000;

const tokenRequest = async (
  credential: XOAuthClient | XCredential,
  body: URLSearchParams,
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (credential.clientType === "confidential" && credential.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(
      `${credential.clientID}:${credential.clientSecret}`,
    ).toString("base64")}`;
  } else {
    body.set("client_id", credential.clientID);
  }
  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers,
    body,
    signal: timeoutSignal(30_000),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new DmbridgeError(
      "auth.tokenExchangeFailed",
      `X OAuth token exchange failed with HTTP ${response.status}.`,
      { details: { httpStatus: response.status } },
    );
  }
  const value = record(payload);
  const accessToken = string(value?.access_token);
  const expiresIn = value?.expires_in;
  if (!accessToken || typeof expiresIn !== "number") {
    throw new DmbridgeError(
      "auth.tokenExchangeInvalid",
      "X OAuth returned an invalid token response.",
    );
  }
  return {
    accessToken,
    refreshToken: string(value?.refresh_token),
    expiresAt: Date.now() + expiresIn * 1000,
    scopes:
      string(value?.scope)?.split(/\s+/).filter(Boolean) ??
      ("grantedScopes" in credential ? credential.grantedScopes : []),
  };
};

const identity = async (accessToken: string) => {
  const response = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: timeoutSignal(30_000),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const data = record(record(payload)?.data);
  const accountUserID = string(data?.id);
  const accountUsername = string(data?.username);
  if (!response.ok || !accountUserID || !accountUsername) {
    throw new DmbridgeError(
      "auth.identityLookupFailed",
      "X identity lookup failed after OAuth authorization.",
      { details: { httpStatus: response.status } },
    );
  }
  return { accountUserID, accountUsername };
};

export const beginXOAuth = async (
  store: AuthStore,
  account: string,
  client: XOAuthClient,
) => {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await storePendingXOAuth(store, {
    version: 2,
    account,
    client,
    state,
    verifier,
    expiresAt,
  });
  const url = new URL(X_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientID,
    redirect_uri: client.redirectURI,
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return {
    authorizationURL: url.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
    scopes: X_SCOPES,
    next: "After approval, pass the full callback URL to `accounts add x --account <name> --request -` as {\"callbackURL\":\"…\"}.",
  };
};

export const completeXOAuth = async (
  store: AuthStore,
  account: string,
  request: unknown,
) => {
  const completion = normalizeXOAuthCompletion(request);
  let code = "code" in completion ? completion.code : null;
  let state = "state" in completion ? completion.state : null;
  if ("callbackURL" in completion) {
    let parsed: URL;
    try {
      parsed = new URL(completion.callbackURL);
    } catch {
      throw invalidRequest("callbackURL must be an absolute URL.");
    }
    code = parsed.searchParams.get("code")?.trim() || null;
    state = parsed.searchParams.get("state")?.trim() || null;
  }
  if (!code || !state) {
    throw invalidRequest("OAuth completion requires callbackURL or code and state.");
  }
  const pending = await consumePendingXOAuth(store, state, account);
  const tokens = await tokenRequest(
    pending.client,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.client.redirectURI,
      code_verifier: pending.verifier,
    }),
  );
  const accountIdentity = await identity(tokens.accessToken);
  const updated = normalizeXCredential({
    ...pending.client,
    ...accountIdentity,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    grantedScopes: tokens.scopes,
  });
  await store.storeCredential("x", pending.account, updated);
  return {
    account: pending.account,
    accountUserID: updated.accountUserID,
    accountUsername: updated.accountUsername,
    expiresAt: new Date(updated.expiresAt).toISOString(),
    grantedScopes: updated.grantedScopes,
    authorized: true,
  };
};

export const refreshXOAuth = async (
  store: AuthStore,
  account: string,
  current: XCredential,
) => {
  if (!current.refreshToken) {
    throw new DmbridgeError(
      "auth.reauthorizationRequired",
    "The X credential cannot be refreshed; run accounts add x again.",
      { exitCode: 3 },
    );
  }
  let tokens: Awaited<ReturnType<typeof tokenRequest>>;
  try {
    tokens = await tokenRequest(
      current,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      }),
    );
  } catch (error) {
    const normalized = asDmbridgeError(error);
    if (normalized.code === "bridge.timeout") throw normalized;
    const code = normalized.code;
    throw new DmbridgeError(
      "auth.reauthorizationRequired",
      "X rejected the saved refresh credential; run accounts add x again.",
      { exitCode: 3, details: { reasonCode: code }, cause: error },
    );
  }
  const updated = normalizeXCredential({
    ...current,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? current.refreshToken,
    expiresAt: tokens.expiresAt,
    grantedScopes: tokens.scopes,
  });
  await store.storeCredential("x", account, updated);
  return {
    account,
    expiresAt: new Date(updated.expiresAt).toISOString(),
    grantedScopes: updated.grantedScopes,
    refreshed: true,
  };
};

export const ensureFreshXOAuth = async (
  store: AuthStore,
  account: string,
  current: XCredential,
  now = Date.now(),
) => {
  if (current.expiresAt > now + X_REFRESH_EARLY_MS) return current;
  await refreshXOAuth(store, account, current);
  return normalizeXCredential(
    await store.readCredential<XCredential>("x", account),
  );
};
