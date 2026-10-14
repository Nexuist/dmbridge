import type { AuthStore } from "../../auth.js";
import { invalidRequest, readSecret } from "../../protocol.js";
import { confirmDestructive } from "../../runtime.js";
import { record } from "../normalize.js";
import { normalizeXOAuthClient } from "./credentials.js";
import { beginXOAuth, completeXOAuth } from "./oauth.js";
import { storeXPasscode, xPasscodeStatus } from "./state.js";

const dryRunResult = (
  account: string,
  operation: string,
  request?: unknown,
) => ({
  dryRun: true,
  provider: "x" as const,
  account,
  operation,
  target: account,
  ...(request === undefined ? {} : { request }),
});

export const addXAccount = async (
  store: AuthStore,
  account: string,
  request: unknown,
  dryRun: boolean,
) => {
  const value = record(request);
  const callback = Boolean(
    value &&
      ("callbackURL" in value || "code" in value || "state" in value),
  );
  if (callback) {
    return dryRun
      ? dryRunResult(account, "account.add.oauth-complete")
      : completeXOAuth(store, account, request);
  }
  const client = normalizeXOAuthClient(request);
  return dryRun
    ? dryRunResult(account, "account.add.oauth-begin", {
        clientID: client.clientID,
        clientType: client.clientType,
        redirectURI: client.redirectURI,
      })
    : beginXOAuth(store, account, client);
};

export const setXPasscode = async (
  store: AuthStore,
  account: string,
  secretPath: string,
  dryRun: boolean,
  yes: boolean,
) => {
  await store.resolveAccount("x", account);
  const secret = await readSecret(secretPath);
  try {
    const status = await xPasscodeStatus(store, account);
    if (status.stored && !dryRun) {
      await confirmDestructive(
        yes,
        `Replace the stored XChat passcode for account ${account}?`,
      );
    }
    if (dryRun) {
      if (secret.byteLength < 4) {
        throw invalidRequest("XChat passcode must contain at least four bytes.");
      }
      return dryRunResult(account, "account.set-passcode");
    }
    await storeXPasscode(store, account, secret);
  } finally {
    secret.fill(0);
  }
  return { provider: "x" as const, account, stored: true };
};
