import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  DmbridgeError,
  invalidRequest,
  ProviderIDSchema,
  type ProviderID,
} from "./protocol.js";

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const STATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const StoredCredentialSchema = z.object({
  version: z.literal(1),
  provider: ProviderIDSchema,
  account: z.string(),
  credential: z.unknown(),
  importedAt: z.string(),
});

type StoredCredential = z.infer<typeof StoredCredentialSchema>;

const ConfigSchema = z.object({
  version: z.literal(1),
  defaults: z.object({
    x: z.string().optional(),
    instagram: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

const validateName = (value: string, label: string) => {
  if (!NAME_PATTERN.test(value)) {
    throw invalidRequest(
      `${label} must start with a lowercase letter or digit and contain only lowercase letters, digits, dot, underscore, or dash.`,
    );
  }
  return value;
};

const validateStateKey = (value: string) => {
  if (!STATE_KEY_PATTERN.test(value)) {
    throw invalidRequest("State key contains invalid characters or length.");
  }
  return value;
};

const ensureOwnedDirectory = async (path: string) => {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new DmbridgeError(
      "auth.unsafePath",
      `Credential directory is not a real directory: ${path}`,
    );
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new DmbridgeError(
      "auth.unsafeOwnership",
      `Credential directory is not owned by the current user: ${path}`,
    );
  }
  await chmod(path, 0o700);
};

const atomicWrite = async (path: string, value: string, mode = 0o600) => {
  const temporaryPath = `${path}.${randomBytes(10).toString("hex")}.tmp`;
  const handle = await open(temporaryPath, "wx", mode);
  try {
    await handle.writeFile(value, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporaryPath, mode);
  await rename(temporaryPath, path);
  await chmod(path, mode);
};

const readSafeFile = async (path: string) => {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new DmbridgeError(
      "auth.unsafePath",
      `Credential path is not a regular file: ${path}`,
    );
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new DmbridgeError(
      "auth.unsafeOwnership",
      `Credential file is not owned by the current user: ${path}`,
    );
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new DmbridgeError(
      "auth.unsafePermissions",
      `Credential file must not be accessible by group or other users: ${path}`,
    );
  }
  return readFile(path, "utf8");
};

const readValidatedJSON = async <T extends z.ZodType>(path: string, schema: T) => {
  const value = await readSafeFile(path);
  return value === null ? null : schema.parse(JSON.parse(value));
};

const writeJSON = (path: string, value: unknown, pretty = false) =>
  atomicWrite(path, `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);

export const resolveHome = (override: string | null) => {
  const configured = override ?? process.env.DMBRIDGE_HOME ?? join(homedir(), ".dmbridge");
  if (!isAbsolute(configured)) {
    throw invalidRequest("dmbridge home must be absolute.");
  }
  return resolve(configured);
};

export class AuthStore {
  readonly home: string;

  constructor(home: string) {
    this.home = home;
  }

  async initialize() {
    await ensureOwnedDirectory(this.home);
    await ensureOwnedDirectory(join(this.home, "auth"));
    await ensureOwnedDirectory(join(this.home, "state"));
    await ensureOwnedDirectory(join(this.home, "tmp"));
  }

  private providerDirectory(provider: ProviderID) {
    return join(this.home, "auth", validateName(provider, "provider"));
  }

  private accountDirectory(provider: ProviderID, account: string) {
    return join(
      this.providerDirectory(provider),
      validateName(account, "account"),
    );
  }

  private async ensureAccountDirectory(provider: ProviderID, account: string) {
    await ensureOwnedDirectory(this.providerDirectory(provider));
    const path = this.accountDirectory(provider, account);
    await ensureOwnedDirectory(path);
    return path;
  }

  async storeCredential(
    provider: ProviderID,
    account: string,
    credential: unknown,
  ) {
    const directory = await this.ensureAccountDirectory(provider, account);
    const envelope: StoredCredential = {
      version: 1,
      provider,
      account,
      credential,
      importedAt: new Date().toISOString(),
    };
    await writeJSON(join(directory, "credentials.json"), envelope, true);
    const accounts = await this.listAccounts(provider);
    if (accounts.length === 1) await this.setDefaultAccount(provider, account);
  }

  async readCredential<T>(provider: ProviderID, account: string): Promise<T> {
    const path = join(
      this.accountDirectory(provider, account),
      "credentials.json",
    );
    let parsed: StoredCredential | null;
    try {
      parsed = await readValidatedJSON(path, StoredCredentialSchema);
    } catch (error) {
      throw new DmbridgeError(
        "auth.invalidCredential",
        `${provider} account ${account} has an invalid credential file.`,
        { exitCode: 3, cause: error },
      );
    }
    if (parsed === null) {
      throw new DmbridgeError(
        "auth.notConfigured",
        `${provider} account ${account} is not configured.`,
        { exitCode: 3 },
      );
    }
    try {
      if (
        parsed.version !== 1 ||
        parsed.provider !== provider ||
        parsed.account !== account
      ) {
        throw new Error("credential envelope does not match its path");
      }
      return parsed.credential as T;
    } catch (error) {
      throw new DmbridgeError(
        "auth.invalidCredential",
        `${provider} account ${account} has an invalid credential file.`,
        { exitCode: 3, cause: error },
      );
    }
  }

  async listAccounts(provider: ProviderID) {
    const path = this.providerDirectory(provider);
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const accounts: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !NAME_PATTERN.test(entry.name)) continue;
      const credential = await readSafeFile(
        join(path, entry.name, "credentials.json"),
      );
      if (credential !== null) accounts.push(entry.name);
    }
    return accounts.sort();
  }

  async removeAccount(provider: ProviderID, account: string) {
    const path = this.accountDirectory(provider, account);
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat === null) {
      return false;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new DmbridgeError(
        "auth.unsafePath",
        `Account path is not a real directory: ${path}`,
      );
    }
    await rm(path, { recursive: true });
    const config = await this.readConfig();
    if (config.defaults[provider] === account) {
      delete config.defaults[provider];
      await writeJSON(join(this.home, "config.json"), config, true);
    }
    return true;
  }

  private async readConfig(): Promise<Config> {
    try {
      return (
        (await readValidatedJSON(join(this.home, "config.json"), ConfigSchema)) ??
        { version: 1, defaults: {} }
      );
    } catch (error) {
      throw new DmbridgeError("config.invalid", "dmbridge config is invalid.", {
        cause: error,
      });
    }
  }

  async setDefaultAccount(provider: ProviderID, account: string) {
    if (!(await this.listAccounts(provider)).includes(account)) {
      throw new DmbridgeError(
        "account.notFound",
        `${provider} account ${account} is not configured.`,
      );
    }
    const config = await this.readConfig();
    config.defaults[provider] = account;
    await writeJSON(join(this.home, "config.json"), config, true);
  }

  async resolveAccount(provider: ProviderID, requested: string | null) {
    if (requested) {
      validateName(requested, "account");
      if (!(await this.listAccounts(provider)).includes(requested)) {
        throw new DmbridgeError(
          "account.notFound",
          `${provider} account ${requested} is not configured.`,
          { exitCode: 3 },
        );
      }
      return requested;
    }
    const accounts = await this.listAccounts(provider);
    const configuredDefault = (await this.readConfig()).defaults[provider];
    if (configuredDefault && accounts.includes(configuredDefault)) {
      return configuredDefault;
    }
    if (accounts.length === 1 && accounts[0]) return accounts[0];
    if (accounts.length === 0) {
      throw new DmbridgeError(
        "auth.notConfigured",
        `No ${provider} accounts are configured.`,
        { exitCode: 3 },
      );
    }
    throw new DmbridgeError(
      "account.selectionRequired",
      `Select one of the configured ${provider} accounts with --account.`,
      { details: { accounts }, exitCode: 3 },
    );
  }

  async storeAccountSecret(
    provider: ProviderID,
    account: string,
    name: string,
    value: Uint8Array,
  ) {
    const directory = await this.ensureAccountDirectory(provider, account);
    await atomicWrite(
      join(directory, validateName(name, "secret")),
      new TextDecoder().decode(value),
    );
  }

  async readAccountSecret(
    provider: ProviderID,
    account: string,
    name: string,
  ) {
    const value = await readSafeFile(
      join(this.accountDirectory(provider, account), validateName(name, "secret")),
    );
    return value === null ? null : new TextEncoder().encode(value);
  }

  async forgetAccountSecret(
    provider: ProviderID,
    account: string,
    name: string,
  ) {
    await rm(
      join(this.accountDirectory(provider, account), validateName(name, "secret")),
      { force: true },
    );
  }

  private stateDirectory(namespace: string) {
    return join(this.home, "state", validateName(namespace, "state namespace"));
  }

  async writeState(namespace: string, key: string, value: unknown) {
    const directory = this.stateDirectory(namespace);
    await ensureOwnedDirectory(directory);
    await writeJSON(join(directory, `${validateStateKey(key)}.json`), value);
  }

  async readState(namespace: string, key: string) {
    const value = await readSafeFile(
      join(this.stateDirectory(namespace), `${validateStateKey(key)}.json`),
    );
    return value === null ? null : JSON.parse(value) as unknown;
  }

  async listStateKeys(namespace: string) {
    let entries;
    try {
      entries = await readdir(this.stateDirectory(namespace), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
  }

  async removeState(namespace: string, key: string) {
    await rm(
      join(this.stateDirectory(namespace), `${validateStateKey(key)}.json`),
      { force: true },
    );
  }
}
