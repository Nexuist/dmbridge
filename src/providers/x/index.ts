import type { ProviderDefinition } from "../types.js";
import { addXAccount } from "./accounts.js";
import { XAdapter } from "./adapter.js";
import {
  normalizeXCredential,
  type XCredential,
} from "./credentials.js";
import { ensureFreshXOAuth } from "./oauth.js";

export { setXPasscode } from "./accounts.js";
export { XAdapter, realmTokensFromJuiceboxConfig } from "./adapter.js";
export type { XAdapterDependencies } from "./adapter.js";
export {
  normalizeXCredential,
  normalizeXOAuthCompletion,
  normalizeXOAuthClient,
  XAccountAddRequestSchema,
  XCredentialSchema,
  XOAuthCallbackURLSchema,
  XOAuthCodeSchema,
  XOAuthCompletionSchema,
  XOAuthClientSchema,
} from "./credentials.js";
export type {
  XCredential,
  XOAuthClient,
  XOAuthCompletion,
} from "./credentials.js";
export {
  beginXOAuth,
  completeXOAuth,
  ensureFreshXOAuth,
  refreshXOAuth,
  X_REFRESH_EARLY_MS,
} from "./oauth.js";
export {
  consumePendingXOAuth,
  forgetXPasscode,
  PendingXOAuthSchema,
  pruneExpiredXOAuth,
  readXPasscode,
  storePendingXOAuth,
  storeXPasscode,
  xPasscodeStatus,
} from "./state.js";
export type { PendingXOAuth } from "./state.js";

export const xProvider: ProviderDefinition = {
  id: "x",
  addAccount: addXAccount,
  async createAdapter(store, account, options) {
    let credential = normalizeXCredential(
      await store.readCredential<XCredential>("x", account),
    );
    if (options.autoRefresh !== false) {
      credential = await ensureFreshXOAuth(store, account, credential);
    }
    return new XAdapter(credential, account, store);
  },
};
