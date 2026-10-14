import type { AuthStore } from "../auth.js";
import { invalidRequest, type ProviderID } from "../protocol.js";
import { instagramProvider } from "./instagram/adapter.js";
import type { ProviderDefinition } from "./types.js";
import { xProvider } from "./x/index.js";

const providers: Record<ProviderID, ProviderDefinition> = {
  instagram: instagramProvider,
  x: xProvider,
};

export const parseProvider = (value: string): ProviderID => {
  if (value === "instagram" || value === "x") return value;
  throw invalidRequest("Provider must be x or instagram.");
};

export const providerDefinition = (provider: ProviderID) => providers[provider];

export const createProvider = async (
  store: AuthStore,
  provider: ProviderID,
  requestedAccount: string | null,
  options: { autoRefresh?: boolean } = {},
 ) => {
  const account = await store.resolveAccount(provider, requestedAccount);
  return {
    account,
    adapter: await providerDefinition(provider).createAdapter(
      store,
      account,
      options,
    ),
  };
};
