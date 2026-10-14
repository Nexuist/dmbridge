import { readFile } from "node:fs/promises";
import { z } from "zod";

import { InstagramCredentialSchema } from "./providers/instagram/credentials.js";
import {
  XAccountAddRequestSchema,
  XChatCapabilitiesSchema,
} from "./providers/x/credentials.js";

export const PROTOCOL_VERSION = 1 as const;
export const SCHEMA_VERSION = 4 as const;

export const ProviderIDSchema = z.enum(["x", "instagram"]);
export const RetrySafetySchema = z.enum(["safe", "unsafe", "never"]);

export const MessageTypeSchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "voice",
  "file",
  "gif",
  "sticker",
  "link",
  "location",
  "contact",
  "sharedPost",
  "sharedStory",
  "sharedReel",
  "reply",
  "quote",
  "system",
  "deleted",
  "unsupported",
  "unknown",
]);

const AttachmentTypeSchema = z.enum([
  "image",
  "video",
  "audio",
  "voice",
  "file",
  "gif",
  "sticker",
  "link",
  "location",
  "contact",
  "sharedPost",
  "sharedStory",
  "sharedReel",
  "reply",
  "quote",
  "system",
  "deleted",
  "unsupported",
  "unknown",
]);

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const NullableStringSchema = z.string().nullable();
const NullableDateTimeSchema = z
  .string()
  .meta({ format: "date-time" })
  .nullable();

export const ParticipantSchema = z.object({
  userID: z.string().min(1),
  username: NullableStringSchema,
  displayName: NullableStringSchema,
});

export const AttachmentSchema = z.object({
  attachmentID: z.string().min(1),
  type: AttachmentTypeSchema,
  mediaType: NullableStringSchema,
  filename: NullableStringSchema,
  sourceURL: z.url().nullable(),
  providerData: UnknownRecordSchema.optional(),
});

export const ReactionSchema = z.object({
  reaction: z.string().min(1),
  userIDs: z.array(z.string()),
  reactedByAuthenticatedUser: z.boolean().nullable(),
});

export const MessageSchema = z.object({
  messageID: z.string().min(1),
  conversationID: z.string().min(1),
  senderID: NullableStringSchema,
  senderUsername: NullableStringSchema,
  sentAt: NullableDateTimeSchema,
  type: MessageTypeSchema,
  text: NullableStringSchema,
  direction: z.enum(["inbound", "outbound", "unknown"]),
  replyToMessageID: NullableStringSchema,
  read: z.boolean().nullable(),
  attachments: z.array(AttachmentSchema),
  reactions: z.array(ReactionSchema),
  providerType: NullableStringSchema,
  providerData: UnknownRecordSchema.optional(),
});

export const ConversationSchema = z.object({
  conversationID: z.string().min(1),
  type: z.enum(["direct", "group", "unknown"]),
  protocol: z.enum(["standard", "xchat", "instagram"]),
  title: NullableStringSchema,
  participants: z.array(ParticipantSchema),
  unreadCount: z.number().int().min(0).nullable(),
  unread: z.boolean().nullable(),
  latestMessageAt: NullableDateTimeSchema,
  latestMessageID: NullableStringSchema,
  lastReadMessageID: NullableStringSchema,
  muted: z.boolean().nullable(),
  archived: z.boolean().nullable(),
  providerData: UnknownRecordSchema.optional(),
});

export const MessageRequestSchema = z.object({
  requestID: z.string().min(1),
  conversation: ConversationSchema,
  state: z.enum(["received", "sent", "none", "unknown"]),
  category: z.enum(["priority", "hidden", "requests"]).nullable(),
  senderRecentlyModifiedProfile: z.boolean().nullable(),
  socialProofUserIDs: z.array(z.string()),
  hasMoreMessages: z.boolean().nullable(),
  detailReadMarksDelivered: z.boolean(),
  providerData: UnknownRecordSchema.optional(),
});

const MutationCapabilitiesSchema = z.object({
  send: z.boolean(),
  reply: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  markRead: z.boolean(),
  markUnread: z.boolean(),
  react: z.boolean(),
  unreact: z.boolean(),
});

export const ProviderCapabilitiesSchema = z.object({
  provider: ProviderIDSchema,
  account: NullableStringSchema,
  authenticated: z.boolean(),
  groupConversations: z.boolean(),
  folders: z.array(z.string()),
  messageTypes: z.object({
    read: z.array(MessageTypeSchema),
    send: z.array(MessageTypeSchema),
  }),
  mutations: MutationCapabilitiesSchema,
  messageReadMode: z.enum([
    "exact",
    "through",
    "conversation",
    "unsupported",
  ]),
  attachments: z.object({
    list: z.boolean(),
    download: z.boolean(),
    send: z.boolean(),
  }),
  messageRequests: z.object({
    list: z.boolean(),
    get: z.boolean(),
    messages: z.boolean(),
    accept: z.boolean(),
    decline: z.boolean(),
    categories: z.array(z.string()),
    detailReadMarksDelivered: z.boolean(),
    acceptRequiresReply: z.boolean(),
  }),
  xchat: XChatCapabilitiesSchema.optional(),
  limitations: z.array(z.string()),
});

export const DoctorCheckSchema = z.object({
  id: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  message: z.string(),
  details: UnknownRecordSchema,
});

export const DoctorSchema = z.object({
  provider: ProviderIDSchema,
  account: z.string(),
  live: z.boolean(),
  healthy: z.boolean(),
  readReady: z.boolean(),
  mutationReady: z.boolean(),
  checks: z.array(DoctorCheckSchema),
  capabilities: ProviderCapabilitiesSchema,
  contracts: z.object({
    schemaVersion: z.number().int().min(1),
    names: z.array(z.string()),
    selected: z.object({ name: z.string(), schema: z.unknown() }).nullable(),
  }),
});

export const CommandContextSchema = z.object({
  provider: ProviderIDSchema.nullable(),
  account: NullableStringSchema,
  requestID: z.string().min(1),
  command: z.string(),
});

const SuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  ...CommandContextSchema.shape,
  result: z.unknown(),
});

export const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  ...CommandContextSchema.shape,
  error: z.object({
    code: z.string(),
    message: z.string(),
    retrySafety: RetrySafetySchema,
    details: UnknownRecordSchema,
  }),
});

const StreamContextSchema = z.object({
  ok: z.boolean(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  ...CommandContextSchema.shape,
});

const StreamRecordSchema = z.union([
  StreamContextSchema.extend({
    ok: z.literal(true),
    recordType: z.literal("result"),
    result: z.unknown(),
  }),
  StreamContextSchema.extend({
    ok: z.literal(true),
    recordType: z.literal("item"),
    collection: z.string().min(1),
    index: z.number().int().min(0),
    result: z.unknown(),
  }),
  StreamContextSchema.extend({
    ok: z.literal(true),
    recordType: z.literal("summary"),
    collection: z.string().min(1),
    count: z.number().int().min(0),
    result: z.unknown(),
  }),
  StreamContextSchema.extend({
    ok: z.literal(false),
    recordType: z.literal("error"),
    error: ErrorEnvelopeSchema.shape.error,
  }),
]);

const ConversationPageSchema = z.object({
  items: z.array(ConversationSchema),
  nextCursor: NullableStringSchema,
});

const MessagePageSchema = z.object({
  items: z.array(MessageSchema),
  nextCursor: NullableStringSchema,
});

const MessageRequestPageSchema = z.object({
  items: z.array(MessageRequestSchema),
  nextCursor: NullableStringSchema,
});

export const AccountAddRequestSchema = z
  .union([
    InstagramCredentialSchema,
    ...XAccountAddRequestSchema.options,
  ])
  .describe(
    "Exact Instagram credential, X OAuth client, X callback URL, or X code/state request. Secrets are read from --request or stdin and are never accepted as flags.",
  );

export const MessageRequestMessagesPageSchema = z.object({
  items: z.array(MessageSchema),
  nextCursor: NullableStringSchema,
  hasMoreMessages: z.boolean().nullable(),
});

const zodSchemas = {
  participant: ParticipantSchema,
  attachment: AttachmentSchema,
  reaction: ReactionSchema,
  message: MessageSchema,
  conversation: ConversationSchema,
  messageRequest: MessageRequestSchema,
  capabilities: ProviderCapabilitiesSchema,
  "page.conversations": ConversationPageSchema,
  "page.messages": MessagePageSchema,
  "page.messageRequests": MessageRequestPageSchema,
  "page.messageRequestMessages": MessageRequestMessagesPageSchema,
  "mutation.result": z.object({
    confirmed: z.boolean(),
    effect: z.string(),
    providerResponse: UnknownRecordSchema.optional(),
  }),
  "envelope.success": SuccessEnvelopeSchema,
  "envelope.error": ErrorEnvelopeSchema,
  "stream.record": StreamRecordSchema,
  "accounts.result": z.object({
    provider: ProviderIDSchema,
    accounts: z.array(z.string().min(1)),
  }).or(z.object({
    providers: z.object({
      instagram: z.array(z.string().min(1)),
      x: z.array(z.string().min(1)),
    }),
  })),
  doctor: DoctorSchema,
  "reactions.result": z.object({
    items: z.array(ReactionSchema),
  }),
  "attachment.download": z.object({
    destinationURL: z.url(),
    mediaType: NullableStringSchema,
    bytes: z.number().int().min(0),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  "accounts.add.request": AccountAddRequestSchema,
  "message.send": z.strictObject({
    type: MessageTypeSchema,
    text: z.string().optional(),
    content: UnknownRecordSchema.optional(),
    attachments: z.array(UnknownRecordSchema).optional(),
    recipientID: z.string().optional(),
    requestID: z.string().optional(),
  }),
  "message.edit": z.object({
    type: z.literal("text"),
    text: z.string().min(1),
  }),
  "reaction.request": z.object({
    reaction: z.string().min(1),
  }),
} as const;

export const MutationResultSchema = zodSchemas["mutation.result"];
export const SendRequestSchema = zodSchemas["message.send"];

export type ProviderID = z.infer<typeof ProviderIDSchema>;
export type RetrySafety = z.infer<typeof RetrySafetySchema>;
export type MessageType = z.infer<typeof MessageTypeSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Reaction = z.infer<typeof ReactionSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;
export type DoctorResult = z.infer<typeof DoctorSchema>;
export type CommandContext = z.infer<typeof CommandContextSchema>;
export type MessageRequestMessagesPage = z.infer<
  typeof MessageRequestMessagesPageSchema
>;
export type MutationResult = z.infer<typeof MutationResultSchema>;
export type SendRequest = z.infer<typeof SendRequestSchema>;
export type Page<T> = { items: T[]; nextCursor: string | null };
export type SuccessEnvelope<T> = Omit<
  z.infer<typeof SuccessEnvelopeSchema>,
  "result"
> & { result: T };
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export type SchemaName = keyof typeof zodSchemas;

const schemaID = (name: SchemaName) =>
  `https://dmbridge.dev/schemas/v${SCHEMA_VERSION}/${name}.json`;

const registry = z.registry<{ id: string }>();
for (const [name, model] of Object.entries(zodSchemas) as Array<
  [SchemaName, z.ZodType]
>) {
  registry.add(model, { id: schemaID(name) });
}

const emitted = z.toJSONSchema(registry, {
  target: "draft-2020-12",
  override: ({ zodSchema, jsonSchema }) => {
    if (zodSchema === UnknownRecordSchema) {
      delete jsonSchema.propertyNames;
      jsonSchema.additionalProperties = true;
    }
    if (zodSchema === MutationCapabilitiesSchema) {
      delete jsonSchema.properties;
      delete jsonSchema.required;
      jsonSchema.additionalProperties = { type: "boolean" };
    }
    if (zodSchema === XChatCapabilitiesSchema) {
      delete jsonSchema.properties;
      delete jsonSchema.required;
      jsonSchema.additionalProperties = true;
    }
  },
}).schemas;

const accountAddRequestID = schemaID("accounts.add.request");
const accountAddRequestJSONSchema = emitted[accountAddRequestID];
if (accountAddRequestJSONSchema && "anyOf" in accountAddRequestJSONSchema) {
  accountAddRequestJSONSchema.oneOf = accountAddRequestJSONSchema.anyOf;
  delete accountAddRequestJSONSchema.anyOf;
}

export const schemas = Object.fromEntries(
  (Object.keys(zodSchemas) as SchemaName[]).map((name) => {
    const id = schemaID(name);
    const value = emitted[id];
    if (!value) throw new Error(`Zod did not emit the ${name} schema.`);
    return [name, { ...value, $id: id }];
  }),
) as unknown as Record<SchemaName, Record<string, unknown>>;

export const getSchema = (name: string | null) => {
  if (name === null) return schemas;
  if (!(name in schemas)) return null;
  return schemas[name as SchemaName];
};

const defaultExitCode = (code: string) => {
  if (/^(auth|account|config)\./.test(code)) return 3;
  if (/^(provider|xchat|attachment)\./.test(code)) return 5;
  if (code.startsWith("resource.")) return 7;
  return 1;
};

export class DmbridgeError extends Error {
  readonly code: string;
  readonly retrySafety: RetrySafety;
  readonly details: Record<string, unknown>;
  readonly exitCode: number;

  constructor(
    code: string,
    message: string,
    options: {
      retrySafety?: RetrySafety;
      details?: Record<string, unknown>;
      exitCode?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DmbridgeError";
    this.code = code;
    this.retrySafety = options.retrySafety ?? "never";
    this.details = options.details ?? {};
    this.exitCode = options.exitCode ?? defaultExitCode(code);
  }
}

export const EXIT_CODES = {
  success: 0,
  internal: 1,
  invalidInput: 2,
  authOrConfiguration: 3,
  unsupported: 4,
  provider: 5,
  timeout: 6,
  resource: 7,
  confirmationRequired: 8,
} as const;

export const invalidRequest = (
  message: string,
  details: Record<string, unknown> = {},
) =>
  new DmbridgeError("bridge.invalidRequest", message, {
    details,
    exitCode: 2,
  });

export const unsupportedOperation = (message: string) =>
  new DmbridgeError("provider.unsupportedOperation", message, {
    exitCode: 4,
  });

export const asDmbridgeError = (error: unknown) => {
  if (error instanceof DmbridgeError) return error;
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return new DmbridgeError(
      "bridge.timeout",
      "Operation exceeded the configured timeout.",
      { retrySafety: "safe", exitCode: EXIT_CODES.timeout, cause: error },
    );
  }
  return new DmbridgeError(
    "bridge.internalFailure",
    error instanceof Error ? error.message : "An unexpected failure occurred.",
    { retrySafety: "unsafe", cause: error },
  );
};

const readStdin = async () => {
  const decoder = new TextDecoder();
  let value = "";
  for await (const chunk of process.stdin) {
    value += decoder.decode(chunk as Uint8Array, { stream: true });
  }
  return value + decoder.decode();
};

export const readRequestText = async (source: string) => {
  const value = source === "-" ? await readStdin() : await readFile(source, "utf8");
  if (!value.trim()) throw invalidRequest("Request input is empty.");
  return value;
};

export const readRequestJSON = async (source: string): Promise<unknown> => {
  const value = await readRequestText(source);
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw invalidRequest(
      `Request input is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
    );
  }
};

export const readSecret = async (source: string) => {
  const value = await readRequestText(source);
  return new TextEncoder().encode(value.replace(/[\r\n]+$/, ""));
};

export type OutputFormat = "json" | "ndjson";

export const successEnvelope = <T>(
  context: CommandContext,
  result: T,
): Envelope<T> => ({
  ok: true,
  protocolVersion: PROTOCOL_VERSION,
  ...context,
  result,
});

export const errorEnvelope = (
  context: CommandContext,
  error: unknown,
): Envelope<never> => {
  const normalized = asDmbridgeError(error);
  return {
    ok: false,
    protocolVersion: PROTOCOL_VERSION,
    ...context,
    error: {
      code: normalized.code,
      message: normalized.message,
      retrySafety: normalized.retrySafety,
      details: normalized.details,
    },
  };
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
};

const stringify = (value: unknown, pretty = false) =>
  JSON.stringify(canonicalize(value), null, pretty ? 2 : 0);

const ndjsonRecords = (value: Envelope<unknown>) => {
  const { ok, protocolVersion, provider, account, requestID, command } = value;
  const context = { ok, protocolVersion, provider, account, requestID, command };
  if (!value.ok) return [{ ...context, recordType: "error", error: value.error }];
  const result = value.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const object = result as Record<string, unknown>;
    const collection = ["items", "accounts", "names", "commands"].find(
      (name) => Array.isArray(object[name]),
    );
    if (collection) {
      const values = object[collection] as unknown[];
      const summary = Object.fromEntries(
        Object.entries(object).filter(([name]) => name !== collection),
      );
      return [
        ...values.map((item, index) => ({
          ...context,
          recordType: "item",
          collection,
          index,
          result: item,
        })),
        {
          ...context,
          recordType: "summary",
          collection,
          count: values.length,
          result: summary,
        },
      ];
    }
  }
  return [{ ...context, recordType: "result", result }];
};

export const writeEnvelope = (
  value: Envelope<unknown>,
  options: { format: OutputFormat; pretty: boolean },
) => {
  if (options.format === "ndjson") {
    for (const record of ndjsonRecords(value)) {
      process.stdout.write(`${stringify(record)}\n`);
    }
    return;
  }
  process.stdout.write(`${stringify(value, options.pretty)}\n`);
};
