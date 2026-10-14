import { z } from "zod";

import type { AuthStore } from "../../auth.js";
import { DmbridgeError, invalidRequest } from "../../protocol.js";
import { XOAuthClientSchema } from "./credentials.js";

const OAUTH_NAMESPACE = "x-oauth";
const PASSCODE_SECRET = "xchat-passcode";

export const PendingXOAuthSchema = z.object({
  version: z.literal(2),
  account: z.string(),
  client: XOAuthClientSchema,
  state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  verifier: z.string().min(1),
  expiresAt: z.number().finite(),
});

export type PendingXOAuth = z.infer<typeof PendingXOAuthSchema>;

export const storeXPasscode = async (
  store: AuthStore,
  account: string,
  passcode: Uint8Array,
) => {
  if (passcode.byteLength < 4) {
    throw invalidRequest("XChat passcode must contain at least four bytes.");
  }
  const value = new TextEncoder().encode(
    new TextDecoder().decode(passcode).replace(/[\r\n]+$/, ""),
  );
  try {
    await store.storeAccountSecret("x", account, PASSCODE_SECRET, value);
  } finally {
    value.fill(0);
  }
};

export const xPasscodeStatus = async (store: AuthStore, account: string) => {
  const stored = await store.readAccountSecret("x", account, PASSCODE_SECRET);
  if (stored) stored.fill(0);
  return { stored: stored !== null, enabled: stored !== null };
};

export const readXPasscode = async (store: AuthStore, account: string) => {
  const value = await store.readAccountSecret("x", account, PASSCODE_SECRET);
  if (value === null) {
    throw new DmbridgeError(
      "xchat.passcodeNotStored",
      `No enabled XChat passcode is stored for account ${account}.`,
      { exitCode: 3 },
    );
  }
  return value;
};

export const forgetXPasscode = (store: AuthStore, account: string) =>
  store.forgetAccountSecret("x", account, PASSCODE_SECRET);

export const pruneExpiredXOAuth = async (
  store: AuthStore,
  now = Date.now(),
) => {
  let removed = 0;
  for (const key of await store.listStateKeys(OAUTH_NAMESPACE)) {
    let expired = true;
    try {
      const parsed = PendingXOAuthSchema.safeParse(
        await store.readState(OAUTH_NAMESPACE, key),
      );
      expired = !parsed.success || parsed.data.expiresAt <= now;
    } catch {
      expired = true;
    }
    if (expired) {
      await store.removeState(OAUTH_NAMESPACE, key);
      removed += 1;
    }
  }
  return removed;
};

export const storePendingXOAuth = async (
  store: AuthStore,
  value: PendingXOAuth,
) => {
  const result = PendingXOAuthSchema.safeParse(value);
  if (!result.success) {
    throw invalidRequest("OAuth state is invalid.", {
      issues: result.error.issues,
    });
  }
  await pruneExpiredXOAuth(store);
  await store.writeState(OAUTH_NAMESPACE, result.data.state, result.data);
};

export const consumePendingXOAuth = async (
  store: AuthStore,
  state: string,
  expectedAccount?: string,
) => {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
    throw invalidRequest("OAuth state is invalid.");
  }
  let value: unknown;
  try {
    value = await store.readState(OAUTH_NAMESPACE, state);
  } catch (error) {
    await store.removeState(OAUTH_NAMESPACE, state);
    throw new DmbridgeError(
      "auth.oauthStateInvalid",
      "The saved X OAuth state is invalid.",
      { exitCode: 3, cause: error },
    );
  }
  if (value === null) {
    throw new DmbridgeError(
      "auth.oauthStateNotFound",
      "The X OAuth state was not found or was already consumed.",
      { exitCode: 3 },
    );
  }
  const result = PendingXOAuthSchema.safeParse(value);
  if (!result.success) {
    await store.removeState(OAUTH_NAMESPACE, state);
    throw new DmbridgeError(
      "auth.oauthStateInvalid",
      "The saved X OAuth state is invalid.",
      { exitCode: 3, cause: result.error },
    );
  }
  const parsed = result.data;
  if (parsed.state !== state) {
    await store.removeState(OAUTH_NAMESPACE, state);
    throw new DmbridgeError(
      "auth.oauthStateInvalid",
      "The saved X OAuth state is invalid.",
      { exitCode: 3 },
    );
  }
  if (expectedAccount && parsed.account !== expectedAccount) {
    throw invalidRequest(
      "OAuth callback account does not match the pending authorization.",
    );
  }
  if (parsed.expiresAt <= Date.now()) {
    await store.removeState(OAUTH_NAMESPACE, state);
    throw new DmbridgeError(
      "auth.oauthStateExpired",
      "The X OAuth state expired. Start authorization again.",
      { exitCode: 3 },
    );
  }
  await store.removeState(OAUTH_NAMESPACE, state);
  return parsed;
};
