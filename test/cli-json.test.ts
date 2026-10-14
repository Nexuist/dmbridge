import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthStore } from "../src/auth.js";
import {
  instagramCredential,
  runCLI,
  xCredential,
} from "./helpers.js";

test("CLI writes a single JSON envelope for success and errors", async () => {
  const home = await mkdtemp(join(tmpdir(), "dmbridge-cli-"));
  const success = await runCLI(["help", "--home", home]);
  const parsed = JSON.parse(success.stdout) as { ok: boolean; result: unknown };
  assert.equal(parsed.ok, true);
  assert.ok(parsed.result);
  assert.equal(success.stdout.trim().split("\n").length, 1);
  const commands = (parsed.result as { commands: string[] }).commands;
  assert.ok(commands.includes("dmbridge accounts list [provider]"));
  assert.ok(commands.some((command) => command.startsWith("dmbridge accounts add <provider>")));
  assert.ok(!commands.some((command) => command.includes(" auth ")));
  assert.ok(!commands.some((command) => command.includes(" conversations participants ")));
  assert.ok(!commands.some((command) => command.includes(" attachments list ")));
  const nestedHelp = await runCLI(["x", "--help", "--home", home]);
  assert.equal(JSON.parse(nestedHelp.stdout).ok, true);

  await assert.rejects(
    runCLI(["nope", "--home", home]),
    (error: unknown) => {
      const stdout = (error as { stdout?: string }).stdout ?? "";
      const envelope = JSON.parse(stdout) as {
        ok: boolean;
        error: { code: string };
      };
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, "bridge.invalidRequest");
      return true;
    },
  );

  await assert.rejects(
    runCLI(["accounts", "add", "x", "--account"]),
    (error: unknown) => {
      const stdout = (error as { stdout?: string }).stdout ?? "";
      const envelope = JSON.parse(stdout) as {
        ok: boolean;
        error: { code: string };
      };
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, "bridge.invalidRequest");
      return true;
    },
  );

  await assert.rejects(
    runCLI(["help", "--not-a-real-option"]),
    (error: unknown) => {
      const stdout = (error as { stdout?: string }).stdout ?? "";
      const envelope = JSON.parse(stdout) as {
        ok: boolean;
        error: { code: string; message: string };
      };
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, "bridge.invalidRequest");
      assert.match(envelope.error.message, /unknown option/);
      assert.equal(stdout.trim().split("\n").length, 1);
      return true;
    },
  );
});

test("CLI global controls provide scoped help, version, JSON, NDJSON, and diagnostics", async () => {
  const home = await mkdtemp(join(tmpdir(), "dmbridge-controls-"));

  for (const args of [["--version"], ["x", "--version"]]) {
    const envelope = JSON.parse((await runCLI(args)).stdout) as {
      result: { version: string; protocolVersion: number; schemaVersion: number };
    };
    assert.equal(envelope.result.version, "1.0.0");
    assert.equal(envelope.result.protocolVersion, 1);
    assert.equal(envelope.result.schemaVersion, 4);
  }

  const scoped = JSON.parse(
    (await runCLI(["x", "messages", "-h", "--home", home])).stdout,
  ) as { result: { scope: string[]; commands: string[] } };
  assert.deepEqual(scoped.result.scope, ["x", "messages"]);
  assert.ok(scoped.result.commands.length > 1);
  assert.ok(
    scoped.result.commands.every((command) =>
      command.startsWith("dmbridge x messages ")),
  );

  for (const args of [["help", "--json"], ["help", "--output", "json"]]) {
    const result = await runCLI(args);
    assert.equal(JSON.parse(result.stdout).ok, true);
  }

  const ndjson = await runCLI(["help", "--ndjson"]);
  const records = ndjson.stdout.trim().split("\n").map((line) =>
    JSON.parse(line) as {
      protocolVersion: number;
      recordType: string;
      collection: string;
      count?: number;
      result: unknown;
    });
  assert.ok(records.length > 2);
  assert.ok(records.slice(0, -1).every((record) => record.recordType === "item"));
  assert.ok(records.every((record) => record.protocolVersion === 1));
  assert.equal(records.at(-1)?.recordType, "summary");
  assert.equal(records.at(-1)?.collection, "commands");
  assert.equal(records.at(-1)?.count, records.length - 1);

  const verbose = await runCLI(["help", "--verbose", "--no-color"]);
  assert.match(verbose.stderr, /executing help/);
  assert.match(verbose.stderr, /completed help/);
  const quiet = await runCLI(["help", "--quiet", "--no-input"]);
  assert.equal(quiet.stderr, "");

  await assert.rejects(
    runCLI(["help", "--timeout", "30"]),
    (error: unknown) => {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      assert.equal(failure.code, 2);
      const envelope = JSON.parse(failure.stdout ?? "{}") as {
        error?: { code?: string; message?: string };
      };
      assert.equal(envelope.error?.code, "bridge.invalidRequest");
      assert.match(envelope.error?.message ?? "", /explicit unit/);
      assert.match(failure.stderr ?? "", /bridge\.invalidRequest/);
      return true;
    },
  );
});

test("destructive local operations require confirmation and remain idempotent", async () => {
  const home = await mkdtemp(join(tmpdir(), "dmbridge-confirmation-"));
  const store = new AuthStore(home);
  await store.initialize();
  await store.storeCredential("x", "personal", xCredential());

  await assert.rejects(
    runCLI([
      "accounts",
      "remove",
      "x",
      "--account",
      "personal",
      "--home",
      home,
      "--no-input",
    ]),
    (error: unknown) => {
      const failure = error as { code?: number; stdout?: string };
      assert.equal(failure.code, 8);
      const envelope = JSON.parse(failure.stdout ?? "{}") as {
        error?: { code?: string };
      };
      assert.equal(envelope.error?.code, "bridge.confirmationRequired");
      return true;
    },
  );

  const preview = JSON.parse(
    (await runCLI([
      "accounts",
      "remove",
      "x",
      "--account",
      "personal",
      "--home",
      home,
      "--dry-run",
      "--no-input",
    ])).stdout,
  ) as { result: { dryRun: boolean; operation: string } };
  assert.equal(preview.result.dryRun, true);
  assert.equal(preview.result.operation, "account.remove");
  assert.deepEqual(await store.listAccounts("x"), ["personal"]);

  const removed = JSON.parse(
    (await runCLI([
      "accounts",
      "remove",
      "x",
      "--account",
      "personal",
      "--home",
      home,
      "--yes",
      "--no-input",
    ])).stdout,
  ) as { result: { removed: boolean } };
  assert.equal(removed.result.removed, true);

  const repeated = JSON.parse(
    (await runCLI([
      "accounts",
      "remove",
      "x",
      "--account",
      "personal",
      "--home",
      home,
      "--yes",
      "--no-input",
    ])).stdout,
  ) as { result: { removed: boolean } };
  assert.equal(repeated.result.removed, false);
});

test("accounts add handles Instagram setup and begins X OAuth", async () => {
  const home = await mkdtemp(join(tmpdir(), "dmbridge-account-add-"));
  const instagramPath = join(home, "instagram.json");
  await writeFile(
    instagramPath,
    JSON.stringify({ accessToken: "instagram-secret" }),
    { mode: 0o600 },
  );
  const instagram = JSON.parse(
    (await runCLI([
      "accounts",
      "add",
      "instagram",
      "--account",
      "personal",
      "--request",
      instagramPath,
      "--home",
      home,
    ])).stdout,
  ) as { provider: string; result: { added: boolean; account: string } };
  assert.equal(instagram.provider, "instagram");
  assert.deepEqual(instagram.result, {
    provider: "instagram",
    account: "personal",
    added: true,
  });

  const legacyPath = join(home, "legacy-instagram.json");
  await writeFile(legacyPath, JSON.stringify({ token: "legacy-secret" }), {
    mode: 0o600,
  });
  await assert.rejects(
    runCLI([
      "accounts",
      "add",
      "instagram",
      "--account",
      "legacy",
      "--request",
      legacyPath,
      "--home",
      home,
    ]),
    (error: unknown) => {
      const envelope = JSON.parse(
        (error as { stdout?: string }).stdout ?? "{}",
      ) as { error?: { code?: string } };
      assert.equal(envelope.error?.code, "bridge.invalidRequest");
      return true;
    },
  );

  const xClientPath = join(home, "x-client.json");
  await writeFile(
    xClientPath,
    JSON.stringify({
      clientID: "client",
      clientSecret: null,
      clientType: "public",
      redirectURI: "http://localhost/callback",
    }),
    { mode: 0o600 },
  );
  const x = JSON.parse(
    (await runCLI([
      "accounts",
      "add",
      "x",
      "--account",
      "personal",
      "--request",
      xClientPath,
      "--home",
      home,
    ])).stdout,
  ) as {
    provider: string;
    result: { authorizationURL: string; next: string };
  };
  assert.equal(x.provider, "x");
  assert.equal(new URL(x.result.authorizationURL).hostname, "x.com");
  assert.match(x.result.next, /accounts add x/);

  const accounts = JSON.parse(
    (await runCLI(["accounts", "list", "--home", home])).stdout,
  ) as { result: { providers: { instagram: string[]; x: string[] } } };
  assert.deepEqual(accounts.result.providers, {
    instagram: ["personal"],
    x: [],
  });
});

test("authenticated default X and Instagram accounts are selected without --account", async () => {
  const home = await mkdtemp(join(tmpdir(), "dmbridge-defaults-"));
  const store = new AuthStore(home);
  await store.initialize();
  await store.storeCredential("instagram", "personal", instagramCredential({
    accessToken: "instagram-secret",
    accountID: "instagram-owner",
    accountUsername: "owner",
  }));
  await store.storeCredential("x", "personal", xCredential({
    accessToken: "x-secret",
    expiresAt: Date.now() + 3_600_000,
    accountUserID: "x-owner",
    accountUsername: "owner",
    grantedScopes: ["users.read", "tweet.read", "dm.read", "dm.write"],
  }));

  for (const provider of ["x", "instagram"]) {
    const { stdout } = await runCLI([
      provider,
      "doctor",
      "--home",
      home,
    ]);
    const envelope = JSON.parse(stdout) as {
      ok: boolean;
      account: string | null;
      result: { account: string; capabilities: { provider: string } };
    };
    assert.equal(envelope.ok, true);
    assert.equal(envelope.account, "personal");
    assert.equal(envelope.result.account, "personal");
    assert.equal(envelope.result.capabilities.provider, provider);
  }

  const selected = JSON.parse(
    (
      await runCLI([
        "accounts",
        "default",
        "x",
        "--account",
        "personal",
        "--home",
        home,
      ])
    ).stdout,
  ) as { result: { provider: string; account: string; default: boolean } };
  assert.deepEqual(selected.result, {
    provider: "x",
    account: "personal",
    default: true,
  });

  const beforePasscode = JSON.parse(
    (
      await runCLI([
        "x",
        "doctor",
        "--home",
        home,
      ])
    ).stdout,
  ) as { result: { healthy: boolean; readReady: boolean } };
  assert.equal(beforePasscode.result.healthy, false);
  assert.equal(beforePasscode.result.readReady, false);
  const passcodePath = join(home, "xchat-passcode.txt");
  await writeFile(passcodePath, "2580\n", { mode: 0o600 });
  await runCLI([
    "accounts",
    "set-passcode",
    "x",
    "--account",
    "personal",
    "--secret",
    passcodePath,
    "--home",
    home,
  ]);
  const afterPasscode = JSON.parse(
    (
      await runCLI([
        "x",
        "doctor",
        "--home",
        home,
      ])
    ).stdout,
  ) as {
    result: { healthy: boolean; readReady: boolean; mutationReady: boolean };
  };
  assert.equal(afterPasscode.result.healthy, true);
  assert.equal(afterPasscode.result.readReady, true);
  assert.equal(afterPasscode.result.mutationReady, true);

  const preview = JSON.parse(
    (
      await runCLI([
        "x",
        "messages",
        "delete",
        "opaque-test-id",
        "--dry-run",
        "--home",
        home,
      ])
    ).stdout,
  ) as { result: { dryRun: boolean; operation: string; target: string } };
  assert.equal(preview.result.dryRun, true);
  assert.equal(preview.result.operation, "delete");
  assert.equal(preview.result.target, "opaque-test-id");

  const xAcceptPreview = JSON.parse(
    (
      await runCLI([
        "x",
        "conversations",
        "requests",
        "accept",
        "111-222",
        "--dry-run",
        "--home",
        home,
      ])
    ).stdout,
  ) as { result: { operation: string; target: string } };
  assert.equal(xAcceptPreview.result.operation, "request.accept");
  assert.equal(xAcceptPreview.result.target, "111-222");

  const acceptRequestPath = join(home, "instagram-request.json");
  await writeFile(
    acceptRequestPath,
    JSON.stringify({ type: "text", text: "hello" }),
    { mode: 0o600 },
  );
  const instagramAcceptPreview = JSON.parse(
    (
      await runCLI([
        "instagram",
        "conversations",
        "requests",
        "accept",
        "conversation-1",
        "--request",
        acceptRequestPath,
        "--dry-run",
        "--home",
        home,
      ])
    ).stdout,
  ) as { result: { operation: string; request: { text: string } } };
  assert.equal(instagramAcceptPreview.result.operation, "request.accept");
  assert.equal(instagramAcceptPreview.result.request.text, "hello");

  await assert.rejects(
    runCLI([
      "x",
      "conversations",
      "requests",
      "get",
      "111-222",
      "--home",
      home,
    ]),
    (error: unknown) => {
      const envelope = JSON.parse(
        (error as { stdout?: string }).stdout ?? "{}",
      ) as { error?: { code?: string; message?: string } };
      assert.equal(envelope.error?.code, "bridge.invalidRequest");
      assert.match(envelope.error?.message ?? "", /--acknowledge-delivery/);
      return true;
    },
  );
});

test("doctor combines capabilities with versioned schema discovery", async () => {
  const home = await mkdtemp(join(tmpdir(), "dmbridge-schemas-"));
  const store = new AuthStore(home);
  await store.initialize();
  await store.storeCredential("x", "personal", xCredential());
  const listed = JSON.parse(
    (
      await runCLI([
        "x",
        "doctor",
        "--schema",
        "message",
        "--home",
        home,
      ])
    ).stdout,
  ) as {
    result: {
      capabilities: { provider: string };
      contracts: {
        schemaVersion: number;
        names: string[];
        selected: {
          name: string;
          schema: {
            $id: string;
            $schema: string;
            properties: { attachments: { items: { $ref: string } } };
          };
        };
      };
    };
  };
  assert.equal(listed.result.capabilities.provider, "x");
  assert.equal(listed.result.contracts.schemaVersion, 4);
  for (const name of [
    "attachment",
    "attachment.download",
    "accounts.add.request",
    "accounts.result",
    "capabilities",
    "conversation",
    "doctor",
    "envelope.error",
    "envelope.success",
    "message",
    "messageRequest",
    "page.messageRequestMessages",
    "page.messageRequests",
    "mutation.result",
    "page.conversations",
    "page.messages",
    "participant",
    "reaction",
    "reactions.result",
    "stream.record",
  ]) {
    assert.ok(listed.result.contracts.names.includes(name), `missing schema ${name}`);
  }
  const fetched = listed.result.contracts.selected;
  assert.equal(fetched.name, "message");
  assert.match(fetched.schema.$id, /\/v4\/message\.json$/);
  assert.equal(
    fetched.schema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.match(
    fetched.schema.properties.attachments.items.$ref,
    /\/v4\/attachment\.json$/,
  );
});
