import { Command, CommanderError, Option } from "commander";
import { readFileSync } from "node:fs";

import { AuthStore, resolveHome } from "./auth.js";
import {
  createProvider,
  parseProvider,
  providerDefinition,
} from "./providers/registry.js";
import type { ListOptions, PageOptions, ProviderAdapter } from "./providers/types.js";
import { setXPasscode } from "./providers/x/index.js";
import {
  getSchema,
  invalidRequest,
  readRequestJSON,
  schemas,
  SCHEMA_VERSION,
  SendRequestSchema,
  unsupportedOperation,
  type DoctorResult,
  type OutputFormat,
  type ProviderID,
} from "./protocol.js";
import {
  confirmDestructive,
  configureRuntime,
  parseDurationMs,
  type Verbosity,
} from "./runtime.js";

type Values = Record<string, boolean | string | number | undefined>;
type OptionSpec = string | readonly [flags: string, required: true];
type Scope = "static" | "store" | "adapter";

type Context = {
  operands: string[];
  options: Values;
  provider: ProviderID | null;
  account: string | null;
  store: AuthStore | null;
  adapter: ProviderAdapter | null;
};

type Definition = {
  path: string;
  scope: Scope;
  options?: readonly OptionSpec[];
  noRefresh?: boolean;
  handler: (context: Context) => unknown | Promise<unknown>;
};

export type ParsedCommand = {
  definition: Definition;
  command: string[];
  operands: string[];
  options: Values;
  provider: ProviderID | null;
};

const packageVersion = () => {
  const packageJSON = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJSON.version !== "string") {
    throw new Error("package.json does not contain a version string.");
  }
  return packageJSON.version;
};

const optionKey = (name: string) =>
  name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

export const option = (command: ParsedCommand | Context, name: string) => {
  const value = command.options[optionKey(name)];
  return typeof value === "string" ? value : null;
};

export const hasOption = (command: ParsedCommand | Context, name: string) =>
  command.options[optionKey(name)] === true;

const optionValue = (command: ParsedCommand | Context, name: string) =>
  command.options[optionKey(name)];

export const configureCommandRuntime = (command: ParsedCommand) => {
  const output = option(command, "output");
  const json = hasOption(command, "json");
  const ndjson = hasOption(command, "ndjson");
  if (json && ndjson) throw invalidRequest("--json and --ndjson cannot be combined.");
  if (output !== null && output !== "json" && output !== "ndjson") {
    throw invalidRequest("--output must be json or ndjson.");
  }
  if ((json && output === "ndjson") || (ndjson && output === "json")) {
    throw invalidRequest("Output format flags select conflicting formats.");
  }
  const format: OutputFormat = ndjson ? "ndjson" : json ? "json" : output ?? "json";
  if (format === "ndjson" && hasOption(command, "pretty")) {
    throw invalidRequest("--pretty cannot be combined with NDJSON output.");
  }
  const quiet = hasOption(command, "quiet");
  const verbose = hasOption(command, "verbose");
  const requestedVerbosity = option(command, "verbosity");
  if (quiet && (verbose || requestedVerbosity !== null)) {
    throw invalidRequest("--quiet cannot be combined with verbosity controls.");
  }
  const allowedVerbosity = new Set<Verbosity>([
    "quiet",
    "normal",
    "verbose",
    "debug",
  ]);
  const verbosity = quiet
    ? "quiet"
    : requestedVerbosity ?? (verbose ? "verbose" : "normal");
  if (!allowedVerbosity.has(verbosity as Verbosity)) {
    throw invalidRequest("--verbosity must be quiet, normal, verbose, or debug.");
  }
  const timeout = option(command, "timeout");
  configureRuntime({
    timeoutMs: timeout === null ? null : parseDurationMs(timeout),
    verbosity: verbosity as Verbosity,
    color: optionValue(command, "color") !== false,
    nonInteractive:
      optionValue(command, "input") === false ||
      hasOption(command, "non-interactive"),
  });
  return { format, pretty: hasOption(command, "pretty") };
};

const requiredOption = (context: Context, name: string) => {
  const value = option(context, name);
  if (!value) throw invalidRequest(`--${name} is required.`);
  return value;
};

const operand = (context: Context, index = 0) => {
  const value = context.operands[index];
  if (!value) throw invalidRequest("Command argument is required.");
  return value;
};

const required = <T>(value: T | null, label: string): T => {
  if (value === null) throw new Error(`${label} was not prepared for the command.`);
  return value;
};

const adapter = (context: Context) => required(context.adapter, "adapter");
const store = (context: Context) => required(context.store, "store");
const provider = (context: Context) => required(context.provider, "provider");

const integerOption = (
  context: Context,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const value = option(context, name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw invalidRequest(
      `--${name} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return parsed;
};

const pageOptions = (context: Context): PageOptions => ({
  cursor: option(context, "cursor"),
  limit: integerOption(context, "limit", 50, 1, 1000),
});

const listOptions = (context: Context): ListOptions => ({
  ...pageOptions(context),
  unread: hasOption(context, "unread"),
});

const providerOperand = (context: Context, index = 0) =>
  parseProvider(operand(context, index));

const parseSendRequest = (value: unknown) => {
  const result = SendRequestSchema.safeParse(value);
  if (!result.success) {
    throw invalidRequest("Request body does not match the message.send schema.", {
      issues: result.error.issues,
    });
  }
  return result.data;
};

const sendRequest = async (context: Context) =>
  parseSendRequest(await readRequestJSON(requiredOption(context, "request")));

const dryRunResult = (
  context: Context,
  operation: string,
  target: string,
  request?: unknown,
) => ({
  dryRun: true,
  provider: context.provider,
  account: context.account,
  operation,
  target,
  ...(request === undefined ? {} : { request }),
});

const mutation = async (
  context: Context,
  operation: string,
  target: string,
  perform: () => Promise<unknown>,
  request?: unknown,
  destructivePrompt?: string,
) => {
  if (hasOption(context, "dry-run")) {
    return dryRunResult(context, operation, target, request);
  }
  if (destructivePrompt) {
    await confirmDestructive(hasOption(context, "yes"), destructivePrompt);
  }
  return perform();
};

const doctor = async (context: Context): Promise<DoctorResult> => {
  const account = required(context.account, "account");
  const adapter = required(context.adapter, "adapter");
  const live = hasOption(context, "live");
  const diagnostics = await adapter.diagnose(account, live);
  const selectedName = option(context, "schema");
  const selectedSchema = selectedName === null ? null : getSchema(selectedName);
  if (selectedName !== null && selectedSchema === null) {
    throw invalidRequest(`Unknown schema: ${selectedName}`);
  }
  return {
    ...diagnostics,
    contracts: {
      schemaVersion: SCHEMA_VERSION,
      names: Object.keys(schemas).sort(),
      selected: selectedName === null
        ? null
        : { name: selectedName, schema: selectedSchema },
    },
  };
};

const listFlags = [
  "--limit <number>",
  "--cursor <cursor>",
  "--unread",
] as const;
const messageListFlags = ["--limit <number>", "--cursor <cursor>"] as const;
const requestFlags = [["--request <file-or-dash>", true]] as const;
const reactionFlags = [["--reaction <emoji>", true]] as const;
const dryRun = ["--dry-run"] as const;
const destructiveDryRun = ["--dry-run", "--yes"] as const;
const sendActions = [
  ["send", "conversationID", "sendMessage"],
  ["reply", "messageID", "replyToMessage"],
  ["edit", "messageID", "editMessage"],
] as const;
const messageActions = [
  ["delete", "deleteMessage"],
  ["read", "markMessageRead"],
  ["unread", "markMessageUnread"],
] as const;
const reactionActions = [
  ["add", "reactToMessage"],
  ["remove", "unreactToMessage"],
] as const;

const adapterCommand = (
  path: string,
  handler: (adapter: ProviderAdapter, context: Context) => unknown | Promise<unknown>,
  options?: readonly OptionSpec[],
  noRefresh = false,
): Definition => ({
  path,
  scope: "adapter",
  ...(options ? { options } : {}),
  ...(noRefresh ? { noRefresh } : {}),
  handler: (context) => handler(adapter(context), context),
});

const adapterResourceCommand = (
  path: string,
  handler: (adapter: ProviderAdapter, id: string, context: Context) => unknown | Promise<unknown>,
  options?: readonly OptionSpec[],
) => adapterCommand(path, (value, context) =>
  handler(value, operand(context), context), options);

const definitions: readonly Definition[] = [
  {
    path: "help",
    scope: "static",
    handler: (context) => getCLIHelp(context.operands),
  },
  {
    path: "version",
    scope: "static",
    handler: () => ({ version: packageVersion(), protocolVersion: 1, schemaVersion: SCHEMA_VERSION }),
  },
  {
    path: "accounts list [provider]",
    scope: "store",
    handler: async (context) => {
      const requested = context.operands[0];
      const authStore = required(context.store, "store");
      if (requested) {
        const provider = parseProvider(requested);
        return { provider, accounts: await authStore.listAccounts(provider) };
      }
      return {
        providers: {
          instagram: await authStore.listAccounts("instagram"),
          x: await authStore.listAccounts("x"),
        },
      };
    },
  },
  {
    path: "accounts add <provider>",
    scope: "store",
    options: [["--account <name>", true], ...requestFlags, ...dryRun, "--yes"],
    handler: async (context) => {
      const provider = providerOperand(context);
      const account = requiredOption(context, "account");
      const authStore = required(context.store, "store");
      const request = await readRequestJSON(requiredOption(context, "request"));
      const exists = (await authStore.listAccounts(provider)).includes(account);
      if (exists && !hasOption(context, "dry-run")) {
        await confirmDestructive(
          hasOption(context, "yes"),
          `Replace the saved ${provider} authorization for account ${account}?`,
        );
      }
      return providerDefinition(provider).addAccount(
        authStore,
        account,
        request,
        hasOption(context, "dry-run"),
      );
    },
  },
  {
    path: "accounts default <provider>",
    scope: "store",
    options: [["--account <name>", true], ...dryRun],
    handler: async (context) => {
      const provider = providerOperand(context);
      const account = requiredOption(context, "account");
      const authStore = required(context.store, "store");
      await authStore.resolveAccount(provider, account);
      if (hasOption(context, "dry-run")) {
        return dryRunResult(context, "account.default", account);
      }
      await authStore.setDefaultAccount(provider, account);
      return { provider, account, default: true };
    },
  },
  {
    path: "accounts remove <provider>",
    scope: "store",
    options: [["--account <name>", true], ...destructiveDryRun],
    handler: async (context) => {
      const provider = providerOperand(context);
      const account = requiredOption(context, "account");
      if (hasOption(context, "dry-run")) {
        return dryRunResult(context, "account.remove", account);
      }
      await confirmDestructive(
        hasOption(context, "yes"),
        `Remove ${provider} account ${account} and its local credentials?`,
      );
      const removed = await required(context.store, "store").removeAccount(
        provider,
        account,
      );
      return { provider, account, removed };
    },
  },
  {
    path: "accounts set-passcode x",
    scope: "store",
    options: [["--account <name>", true], ["--secret <file-or-dash>", true], ...dryRun, "--yes"],
    handler: (context) => setXPasscode(
      required(context.store, "store"),
      requiredOption(context, "account"),
      requiredOption(context, "secret"),
      hasOption(context, "dry-run"),
      hasOption(context, "yes"),
    ),
  },
  {
    path: "<provider> doctor",
    scope: "adapter",
    noRefresh: true,
    options: ["--live", "--schema <name>"],
    handler: doctor,
  },
  adapterCommand(
    "<provider> conversations list",
    (value, context) => value.listConversations(listOptions(context)),
    listFlags,
  ),
  adapterResourceCommand(
    "<provider> conversations get <conversationID>",
    (value, conversationID) => value.getConversation(conversationID),
  ),
  {
    path: "<provider> conversations requests list",
    scope: "adapter",
    options: ["--limit <number>", "--cursor <cursor>", "--category <category>"],
    handler: (context) => required(context.adapter, "adapter").listMessageRequests({
      ...pageOptions(context),
      category: option(context, "category"),
    }),
  },
  adapterResourceCommand(
    "<provider> conversations requests get <conversationID>",
    async (value, conversationID, context) => {
      const acknowledge = hasOption(context, "acknowledge-delivery");
      if (
        !acknowledge &&
        (await value.capabilities()).messageRequests.detailReadMarksDelivered
      ) {
        throw invalidRequest(
          "Request detail marks returned messages delivered; pass --acknowledge-delivery.",
        );
      }
      return hasOption(context, "dry-run")
        ? dryRunResult(context, "request.get-and-acknowledge", conversationID)
        : value.getMessageRequest(conversationID, acknowledge);
    },
    ["--acknowledge-delivery", ...dryRun],
  ),
  adapterResourceCommand(
    "<provider> conversations requests messages <conversationID>",
    async (value, conversationID, context) => {
      const acknowledge = hasOption(context, "acknowledge-delivery");
      const options = { ...pageOptions(context), conversationID };
      if (
        !acknowledge &&
        (await value.capabilities()).messageRequests.detailReadMarksDelivered
      ) {
        throw invalidRequest(
          "Request messages mark returned messages delivered; pass --acknowledge-delivery.",
        );
      }
      return hasOption(context, "dry-run")
        ? dryRunResult(context, "request.messages-and-acknowledge", conversationID)
        : value.listMessageRequestMessages(
            options,
            acknowledge,
          );
    },
    [...messageListFlags, "--acknowledge-delivery", ...dryRun],
  ),
  {
    path: "<provider> conversations requests accept <conversationID>",
    scope: "adapter",
    options: ["--request <file-or-dash>", ...dryRun],
    handler: async (context) => {
      const provider = required(context.provider, "provider");
      const target = operand(context);
      const requestPath = option(context, "request");
      const capabilities = await adapter(context).capabilities();
      if (capabilities.messageRequests.acceptRequiresReply && !requestPath) {
        throw invalidRequest(
          `${provider} accepts a message request by replying; --request is required.`,
        );
      }
      if (!capabilities.messageRequests.acceptRequiresReply && requestPath) {
        throw invalidRequest(
          `${provider} request acceptance does not accept --request.`,
        );
      }
      const request = requestPath
        ? parseSendRequest(await readRequestJSON(requestPath))
        : undefined;
      return mutation(
        context,
        "request.accept",
        target,
        () => required(context.adapter, "adapter").acceptMessageRequest(target, request),
        request,
      );
    },
  },
  {
    path: "<provider> conversations requests decline <conversationID>",
    scope: "adapter",
    options: destructiveDryRun,
    handler: async (context) => {
      const provider = required(context.provider, "provider");
      if (!(await adapter(context).capabilities()).messageRequests.decline) {
        throw unsupportedOperation(
          `${provider} does not expose a message-request decline operation.`,
        );
      }
      const target = operand(context);
      return mutation(
        context,
        "request.decline",
        target,
        () => required(context.adapter, "adapter").declineMessageRequest(target),
        undefined,
        `Decline message request ${target}?`,
      );
    },
  },
  adapterResourceCommand(
    "<provider> messages list <conversationID>",
    (value, conversationID, context) => value.listMessages({
      ...pageOptions(context),
      conversationID,
    }),
    messageListFlags,
  ),
  adapterResourceCommand(
    "<provider> messages get <messageID>",
    (value, messageID) => value.getMessage(messageID),
  ),
  ...sendActions.map(([action, targetName, method]): Definition => ({
    path: `<provider> messages ${action} <${targetName}>`,
    scope: "adapter",
    options: [...requestFlags, ...dryRun],
    handler: async (context) => {
      const target = operand(context);
      const request = await sendRequest(context);
      return mutation(
        context,
        action,
        target,
        () => adapter(context)[method](target, request),
        request,
      );
    },
  })),
  ...messageActions.map(([action, method]): Definition => ({
    path: `<provider> messages ${action} <messageID>`,
    scope: "adapter",
    options: action === "delete" ? destructiveDryRun : dryRun,
    handler: (context) => {
      const target = operand(context);
      return mutation(
        context,
        action,
        target,
        () => adapter(context)[method](target),
        undefined,
        action === "delete" ? `Delete message ${target}?` : undefined,
      );
    },
  })),
  adapterResourceCommand(
    "<provider> reactions list <messageID>",
    async (value, messageID) => ({
      items: (await value.listReactions(messageID)).toSorted((left, right) =>
        left.reaction.localeCompare(right.reaction)),
    }),
  ),
  ...reactionActions.map(([action, method]): Definition => ({
    path: `<provider> reactions ${action} <messageID>`,
    scope: "adapter",
    options: [...reactionFlags, ...dryRun],
    handler: (context) => {
      const target = operand(context);
      const reaction = requiredOption(context, "reaction");
      return mutation(
        context,
        action,
        target,
        () => adapter(context)[method](target, reaction),
        { reaction },
      );
    },
  })),
  {
    path: "<provider> attachments download <attachmentID>",
    scope: "adapter",
    options: [["--destination-url <file-url>", true], "--overwrite", ...dryRun],
    handler: (context) => {
      let destinationURL: URL;
      try {
        destinationURL = new URL(requiredOption(context, "destination-url"));
      } catch {
        throw invalidRequest("--destination-url must be a valid absolute URL.");
      }
      if (destinationURL.protocol !== "file:") {
        throw invalidRequest("--destination-url must use the file: scheme.");
      }
      const target = operand(context);
      if (hasOption(context, "dry-run")) {
        return dryRunResult(context, "attachment.download", target, {
          destinationURL: destinationURL.toString(),
          overwrite: hasOption(context, "overwrite"),
        });
      }
      return required(context.adapter, "adapter").downloadAttachment(
        target,
        destinationURL,
        hasOption(context, "overwrite"),
      );
    },
  },
];

const optionsFor = (definition: Definition) => {
  const options = [...(definition.options ?? [])];
  if (
    definition.scope === "adapter" &&
    !options.some((value) =>
      (typeof value === "string" ? value : value[0]).startsWith("--account "),
    )
  ) options.unshift("--account <name>");
  return options;
};

export const getCLIHelp = (prefix: string[] = []) => {
  const normalizedPrefix = prefix.map((token) =>
    token === "x" || token === "instagram"
      ? "<provider>"
      : token,
  );
  const visible = definitions.filter((definition) => {
    if (normalizedPrefix.length === 0) return true;
    const tokens = definition.path.split(" ");
    return normalizedPrefix.every((token, index) => {
      const definitionToken = tokens[index];
      return definitionToken?.startsWith("<") || definitionToken?.startsWith("[")
        ? true
        : definitionToken === token;
    });
  });
  const displayPath = (path: string) => path
    .split(" ")
    .map((token, index) =>
      token.startsWith("<") && prefix[index] ? prefix[index] : token,
    )
    .join(" ");
  const exactUsage = visible.length === 1
    ? displayPath(visible[0]!.path)
    : null;
  return {
  usage: exactUsage
    ? `dmbridge ${exactUsage} [flags]`
    : prefix.length === 0
      ? "dmbridge [x|instagram] <resource> <action> [flags]"
      : `dmbridge ${prefix.join(" ")} <action> [flags]`,
  scope: prefix,
  rules: [
    "stdout contains only the selected JSON or NDJSON result contract",
    "progress, warnings, and diagnostics are written only to stderr",
    "select a provider explicitly; there is no unified inbox",
    "secrets and mutation bodies are read from files or stdin, never flags",
    "attachment downloads require --destination-url=file:///absolute/path",
  ],
  globalOptions: [
    "-h, --help",
    "-V, --version",
    "--home <absolute-path>",
    "--request-id <id>",
    "--output <json|ndjson>",
    "--json",
    "--ndjson",
    "--pretty",
    "--timeout <duration-with-unit>",
    "--no-input, --non-interactive",
    "--no-color",
    "--quiet",
    "-v, --verbose",
    "--verbosity <quiet|normal|verbose|debug>",
  ],
  commands: visible.map((definition) => [
    `dmbridge ${displayPath(definition.path)}`,
    ...optionsFor(definition).map((value) =>
      typeof value === "string" ? `[${value}]` : value[0]),
  ].join(" ")),
};
};

const commandWords = new Set([
  "x",
  "instagram",
  ...definitions.flatMap((definition) =>
    definition.path
      .split(" ")
      .filter((token) => !token.startsWith("<") && !token.startsWith("[")),
  ),
]);

const earlyOptions = (argv: string[]): Values => {
  const values: Values = {};
  const valueFlags = new Map([
    ["--output", "output"],
    ["--timeout", "timeout"],
    ["--verbosity", "verbosity"],
    ["--request-id", "requestId"],
    ["--home", "home"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    const key = valueFlags.get(flag);
    if (key && argv[index + 1]) {
      values[key] = argv[index + 1];
      index += 1;
    } else if (flag.startsWith("--") && flag.includes("=")) {
      const separator = flag.indexOf("=");
      const name = flag.slice(0, separator);
      const inlineKey = valueFlags.get(name);
      if (inlineKey) values[inlineKey] = flag.slice(separator + 1);
    } else if (flag === "--json") values.json = true;
    else if (flag === "--ndjson") values.ndjson = true;
    else if (flag === "--pretty") values.pretty = true;
    else if (flag === "--quiet") values.quiet = true;
    else if (flag === "-v" || flag === "--verbose") values.verbose = true;
    else if (flag === "--no-input") values.input = false;
    else if (flag === "--non-interactive") values.nonInteractive = true;
    else if (flag === "--no-color") values.color = false;
  }
  return values;
};

const controlCommand = (
  definitionIndex: 0 | 1,
  argv: string[],
): ParsedCommand => {
  const operands = definitionIndex === 0
    ? argv.slice(0, Math.max(argv.findIndex((value) => value === "-h" || value === "--help"), 0))
        .filter((value) => commandWords.has(value))
    : [];
  return {
    definition: definitions[definitionIndex]!,
    command: [definitionIndex === 0 ? "help" : "version"],
    operands,
    options: earlyOptions(argv),
    provider: null,
  };
};

export const parseCommand = (argv: string[]): ParsedCommand => {
  let invocation: ParsedCommand | null = null;
  const program = new Command()
    .name("dmbridge")
    .helpOption(false)
    .addHelpCommand(false)
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .exitOverride()
    .option("--home <path>")
    .option("--pretty")
    .option("--request-id <id>")
    .option("--output <format>")
    .option("--json")
    .option("--ndjson")
    .option("--timeout <duration>")
    .option("--quiet")
    .option("-v, --verbose")
    .option("--verbosity <level>")
    .option("--no-color")
    .option("--no-input")
    .option("--non-interactive")
    .option("-h, --help")
    .option("-V, --version");
  if (argv.includes("-h") || argv.includes("--help")) {
    return controlCommand(0, argv);
  }
  if (argv.includes("-V") || argv.includes("--version")) {
    return controlCommand(1, argv);
  }
  const parents = new Map<string, Command>([["", program]]);
  for (const definition of definitions) {
    const paths = definition.path.startsWith("<provider>")
      ? (["x", "instagram"] as const).map((provider) =>
          definition.path.replace("<provider>", provider))
      : [definition.path];
    for (const path of paths) {
      const tokens = path.split(" ");
      const argumentIndex = tokens.findIndex((token) => /^[<[].*[>\]]$/.test(token));
      const commandTokens = tokens.slice(0, argumentIndex === -1 ? undefined : argumentIndex);
      const arguments_ = argumentIndex === -1 ? [] : tokens.slice(argumentIndex);
      let parent = program;
      for (let index = 0; index < commandTokens.length - 1; index += 1) {
        const key = commandTokens.slice(0, index + 1).join(" ");
        const existing = parents.get(key);
        if (existing) parent = existing;
        else {
          parent = parent.command(commandTokens[index]!);
          parents.set(key, parent);
        }
      }
      const leaf = parent.command([commandTokens.at(-1), ...arguments_].join(" "));
      for (const spec of optionsFor(definition)) {
        const [flags, mandatory] = typeof spec === "string" ? [spec, false] : spec;
        const commandOption = new Option(flags);
        leaf.addOption(mandatory ? commandOption.makeOptionMandatory() : commandOption);
      }
      leaf.action((...values: unknown[]) => {
        const command = values.at(-1) as Command;
        const operands = command.processedArgs
          .filter((value) => value !== undefined)
          .map(String);
        const provider = commandTokens[0] === "x" || commandTokens[0] === "instagram"
          ? commandTokens[0]
          : commandTokens[0] === "accounts" &&
              (operands[0] === "x" || operands[0] === "instagram")
            ? operands[0]
            : commandTokens[0] === "accounts" &&
                (commandTokens[2] === "x" || commandTokens[2] === "instagram")
              ? commandTokens[2]
            : null;
        invocation = {
          definition,
          command: [...commandTokens, ...operands],
          operands,
          options: command.optsWithGlobals<Values>(),
          provider,
        };
      });
    }
  }
  try {
    program.parse(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      throw invalidRequest(error.message.replace(/^error:\s*/, ""));
    }
    throw error;
  }
  if (!invocation) throw invalidRequest("Unknown dmbridge command. Run dmbridge help.");
  return invocation;
};

export const executeCommand = async (command: ParsedCommand) => {
  const provider = command.provider;
  let account = option(command, "account");
  let store: AuthStore | null = null;
  let adapter: ProviderAdapter | null = null;
  if (command.definition.scope !== "static") {
    store = new AuthStore(resolveHome(option(command, "home")));
    await store.initialize();
  }
  if (provider && command.definition.scope === "adapter") {
    account = await required(store, "store").resolveAccount(provider, account);
  }
  if (provider && command.definition.scope === "adapter") {
    const created = await createProvider(store!, provider, account, {
      autoRefresh: !command.definition.noRefresh && !hasOption(command, "dry-run"),
    });
    account = created.account;
    adapter = created.adapter;
  }
  const result = await command.definition.handler({
    operands: command.operands,
    options: command.options,
    provider,
    account,
    store,
    adapter,
  });
  return { result, account };
};
