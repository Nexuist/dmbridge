import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";

import { AuthStore } from "../src/auth.js";
import type { InstagramCredential } from "../src/providers/instagram/credentials.js";
import type { XCredential } from "../src/providers/x/index.js";
import type { ListOptions, PageOptions } from "../src/providers/types.js";
import type { Envelope } from "../src/protocol.js";

const run = promisify(execFile);

export const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

export const mockFetch = (
  context: TestContext,
  implementation: typeof globalThis.fetch,
) => {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  context.after(() => {
    globalThis.fetch = original;
  });
};

export type MockRequest = {
  url: string;
  method: string;
  init?: RequestInit;
};

type MockRouteResult = unknown | Response;
type MockRouteHandler = (
  request: MockRequest,
) => MockRouteResult | Promise<MockRouteResult>;

const asResponse = (value: MockRouteResult) =>
  value instanceof Response ? value : jsonResponse(value);

export const mockRoutes = (
  context: TestContext,
  routes: Record<string, MockRouteResult | MockRouteHandler>,
  fallback?: MockRouteResult | MockRouteHandler,
) => {
  const requests: MockRequest[] = [];
  mockFetch(context, async (input, init) => {
    const request: MockRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      ...(init ? { init } : {}),
    };
    requests.push(request);
    const match = Object.entries(routes).find(([key]) => {
      const separator = key.indexOf(" ");
      return request.method === key.slice(0, separator) &&
        request.url.includes(key.slice(separator + 1));
    })?.[1] ?? fallback;
    if (match === undefined) throw new Error(`No mock route for ${request.method} ${request.url}`);
    return asResponse(typeof match === "function" ? await match(request) : match);
  });
  return requests;
};

export const temporaryStore = async (prefix = "dmbridge-test-") => {
  const home = await mkdtemp(join(tmpdir(), prefix));
  const store = new AuthStore(home);
  await store.initialize();
  return { home, store };
};

export const instagramCredential = (
  overrides: Partial<InstagramCredential> = {},
): InstagramCredential => ({
  accessToken: "secret",
  accountID: null,
  accountUsername: null,
  apiVersion: null,
  ...overrides,
});

export const xCredential = (
  overrides: Partial<XCredential> = {},
): XCredential => ({
  clientID: "client",
  clientSecret: null,
  clientType: "public",
  redirectURI: "http://localhost/callback",
  accessToken: "token",
  refreshToken: null,
  expiresAt: Date.now() + 60_000,
  accountUserID: "111",
  accountUsername: "owner",
  grantedScopes: ["users.read", "dm.read"],
  realmTokenIssuerURL: null,
  ...overrides,
});

export const pageOptions = <T extends object = Record<never, never>>(
  overrides?: T,
) => ({
  cursor: null,
  limit: 10,
  ...overrides,
}) as PageOptions & T;

export const listOptions = <T extends object = Record<never, never>>(
  overrides?: T,
) => ({ ...pageOptions(), unread: false, ...overrides }) as ListOptions & T;

export const runCLI = (args: string[]) =>
  run(process.execPath, ["dist/src/cli.js", ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });

export const readCLIEnvelope = async <T>(args: string[]) => {
  try {
    const { stdout } = await runCLI(args);
    return JSON.parse(stdout) as Envelope<T>;
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (stdout) return JSON.parse(stdout) as Envelope<T>;
    throw error;
  }
};
