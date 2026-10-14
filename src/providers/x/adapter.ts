import { Buffer } from "node:buffer";
import { z } from "zod";

import {
  createChat,
  guessesRemaining,
  type ChatWithJuicebox,
  type ConversationKeyMap,
  type DecryptEventsResult,
  type Event as XEvent,
  type SendPayload,
  type SigningKeyEntry,
} from "@xdevplatform/chat-xdk";

import type { AuthStore } from "../../auth.js";
import { writeBytesToFileURL } from "../../download.js";
import {
  DmbridgeError,
  invalidRequest,
  MessageTypeSchema,
  unsupportedOperation,
  type Attachment,
  type Conversation,
  type Message,
  type MessageRequest,
  type MessageType,
  type Participant,
  type ProviderCapabilities,
  type Reaction,
} from "../../protocol.js";
import type { XCredential } from "./credentials.js";
import { ProviderClient } from "../http.js";
import { timeoutSignal } from "../../runtime.js";
import {
  array,
  boolean,
  compactMap,
  id,
  isoTime,
  record,
  string,
  type JsonRecord,
} from "../normalize.js";
import {
  ProviderAdapterBase,
  providerCapabilities,
  type ListOptions,
  type MessageRequestListOptions,
  type MessageListOptions,
  type MutationResult,
  type ProviderAdapter,
  type SendRequest,
} from "../types.js";
import {
  forgetXPasscode,
  readXPasscode,
  xPasscodeStatus,
} from "./state.js";

interface XPage {
  data?: unknown;
  includes?: unknown;
  meta?: unknown;
}

const MessageLocatorSchema = z.object({
  version: z.literal(1),
  conversationID: z.string().trim().min(1),
  eventID: z.string().trim().min(1),
});

const AttachmentLocatorSchema = z.object({
  version: z.literal(1),
  conversationID: z.string().trim().min(1),
  keyVersion: z.string().trim().min(1),
  mediaHashKey: z.string().trim().min(1),
  mediaType: z.string().nullable(),
  filename: z.string().nullable(),
});

interface LoadedSession {
  chat: ChatWithJuicebox;
  decrypted: DecryptEventsResult;
  keys: ConversationKeyMap;
}

export interface XAdapterDependencies {
  createChat?: typeof createChat;
}

const API_BASE = "https://api.x.com";
const X_READ_SCOPES = ["users.read", "tweet.read", "dm.read"] as const;
const X_WRITE_SCOPES = ["users.read", "tweet.read", "dm.write"] as const;
const CONVERSATION_FIELDS = [
  "id",
  "type",
  "created_at",
  "updated_at",
  "group_name",
  "group_description",
  "group_avatar_url",
  "unread",
  "last_read_event_id",
  "newest_event_id",
  "is_muted",
  "is_archived",
].join(",");
const EVENT_FIELDS = [
  "id",
  "conversation_id",
  "conversation_key_version",
  "conversation_token",
  "created_at",
  "encoded_event",
  "is_trusted",
  "message_event_signature",
  "previous_id",
  "sender_id",
].join(",");
const PUBLIC_KEY_FIELDS = [
  "identity_public_key_signature",
  "juicebox_config",
  "public_key",
  "public_key_version",
  "signing_public_key",
].join(",");

const encodeOpaque = (value: object) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const decodeOpaque = <T extends z.ZodType>(
  value: string,
  prefix: string,
  schema: T,
  invalidMessage: string,
): z.infer<T> => {
  if (!value.startsWith(prefix)) {
    throw invalidRequest(`Expected an opaque ${prefix.slice(0, -1)} ID.`);
  }
  try {
    return schema.parse(
      JSON.parse(
        Buffer.from(value.slice(prefix.length), "base64url").toString("utf8"),
      ),
    );
  } catch {
    throw invalidRequest(invalidMessage);
  }
};

const messageID = (conversationID: string, eventID: string) =>
  `xmsg_${encodeOpaque({ version: 1, conversationID, eventID })}`;
const decodeMessageID = (value: string) =>
  decodeOpaque(
    value,
    "xmsg_",
    MessageLocatorSchema,
    "Invalid XChat message ID.",
  );
const decodeAttachmentID = (value: string) =>
  decodeOpaque(
    value,
    "xatt_",
    AttachmentLocatorSchema,
    "Invalid XChat attachment ID.",
  );

const newestKey = (values: JsonRecord[]) =>
  [...values].sort((left, right) => {
    const a = string(left.public_key_version) ?? "";
    const b = string(right.public_key_version) ?? "";
    return b.length - a.length || b.localeCompare(a);
  })[0] ?? null;

export const realmTokensFromJuiceboxConfig = (value: unknown) => {
  let config = record(value);
  if (typeof value === "string") {
    try {
      config = record(JSON.parse(value));
    } catch {
      config = null;
    }
  }
  const tokens = new Map<string, string>();
  for (const candidate of array(config?.token_map)) {
    const entry = record(candidate);
    const realmID = string(entry?.key);
    const token = string(record(entry?.value)?.token);
    if (realmID && token) {
      tokens.set(realmID, token);
      tokens.set(realmID.toLowerCase(), token);
    }
  }
  return tokens;
};

const messageTypeForAttachment = (value: JsonRecord): MessageType => {
  const explicit = string(value.attachmentType)?.toLowerCase();
  const mediaType = string(value.mediaType)?.toLowerCase();
  if (mediaType?.startsWith("image/")) return mediaType === "image/gif" ? "gif" : "image";
  if (mediaType?.startsWith("video/")) return "video";
  if (mediaType?.startsWith("audio/")) return "audio";
  if (explicit === "url") return "link";
  if (explicit === "post") return "sharedPost";
  if (explicit === "media") return "file";
  return "unknown";
};

export class XAdapter extends ProviderAdapterBase implements ProviderAdapter {
  readonly id = "x" as const;
  private readonly client: ProviderClient;

  constructor(
    private readonly credential: XCredential,
    private readonly account: string,
    private readonly store: AuthStore,
    private readonly dependencies: XAdapterDependencies = {},
  ) {
    super();
    this.client = new ProviderClient("x", API_BASE, () => this.headers());
  }

  private headers() {
    return { Authorization: `Bearer ${this.credential.accessToken}` };
  }

  private hasScopes(...scopes: string[]) {
    const granted = new Set(this.credential.grantedScopes);
    return scopes.every((scope) => granted.has(scope));
  }

  async authStatus(live: boolean) {
    const passcode = await xPasscodeStatus(this.store, this.account);
    const expiresAt = new Date(this.credential.expiresAt).toISOString();
    const base = {
      account: this.account,
      configured: true,
      connected: null,
      accountUserID: this.credential.accountUserID,
      accountUsername: this.credential.accountUsername,
      expiresAt,
      expired: this.credential.expiresAt <= Date.now(),
      reauthorizationRequired:
        this.credential.expiresAt <= Date.now() && !this.credential.refreshToken,
      grantedScopes: this.credential.grantedScopes,
      requiredReadScopesPresent: this.hasScopes(
        ...X_READ_SCOPES,
      ),
      requiredWriteScopesPresent: this.hasScopes(
        ...X_WRITE_SCOPES,
      ),
      xchatPasscode: passcode,
      realmAuthMode: "x-api-token-map",
      externalRealmTokenIssuerConfigured: Boolean(
        this.credential.realmTokenIssuerURL,
      ),
    };
    if (!live) return base;
    const data = await this.client.get<XPage>("/2/users/me", {
      "user.fields": "id,username,name",
    });
    return { ...base, connected: true, identity: data.data ?? null };
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const passcode = await xPasscodeStatus(this.store, this.account);
    const canRead = this.hasScopes(...X_READ_SCOPES);
    const canDecrypt = passcode.enabled && canRead;
    const canEncrypt =
      passcode.enabled &&
      this.hasScopes(...X_WRITE_SCOPES);
    return providerCapabilities("x", this.account, {
      groupConversations: true,
      folders: ["inbox", "requests"],
      messageTypes: {
        read: [...MessageTypeSchema.options],
        send: ["text"],
      },
      mutations: {
        send: canEncrypt,
        reply: canEncrypt,
        edit: canEncrypt,
        delete: canEncrypt,
        markRead: this.hasScopes("dm.write"),
        markUnread: this.hasScopes("dm.write"),
        react: canEncrypt,
        unreact: canEncrypt,
      },
      messageReadMode: "conversation",
      attachments: { list: canDecrypt, download: canDecrypt },
      messageRequests: {
        list: canRead,
        get: canRead,
        messages: canDecrypt,
        accept: this.hasScopes("dm.write"),
        decline: this.hasScopes("dm.write"),
        categories: ["priority", "hidden"],
        detailReadMarksDelivered: true,
        acceptRequiresReply: false,
      },
      xchat: {
        supported: true,
        passcodeStored: passcode.enabled,
        realmAuthMode: "x-api-token-map",
        externalIssuerFallbackConfigured: Boolean(
          this.credential.realmTokenIssuerURL,
        ),
      },
      limitations: [
        "Only XChat is supported; legacy X Direct Messages are intentionally excluded.",
        "Conversation metadata is available before XChat unlock, but encrypted names and events require the stored passcode. Realm tokens are read from the fresh X public-key response.",
        "X exposes conversation-level read and unread mutations, so a message ID is resolved to its conversation before applying the mutation.",
        "X exposes unread state but not a direct unread-message count; unreadCount is 0 when read and null when unread.",
        "Sending encrypted media is not yet implemented; all received attachment variants remain represented in JSON.",
        "Reading one XChat message request's detail or messages marks the returned messages delivered; dmbridge requires --acknowledge-delivery before that request.",
      ],
    });
  }

  async diagnose(account: string, live: boolean) {
    const { diagnostics, local } = await this.diagnosticBase(account, live);
    const expired = local.expired === true;
    const readScopes = local.requiredReadScopesPresent === true;
    const writeScopes = local.requiredWriteScopesPresent === true;
    const passcode = record(local.xchatPasscode) ?? {};
    const passcodeEnabled = passcode.enabled === true;
    diagnostics.checks.push(
      {
        id: "x.token",
        status: expired ? "fail" : "pass",
        message: expired
          ? "The X OAuth token is expired."
          : "The X OAuth token is current.",
        details: { expiresAt: local.expiresAt ?? null },
      },
      {
        id: "x.readScopes",
        status: readScopes ? "pass" : "fail",
        message: readScopes
          ? "Required XChat read scopes are granted."
          : "XChat read scopes are missing; run accounts add x again.",
        details: {},
      },
      {
        id: "x.writeScopes",
        status: writeScopes ? "pass" : "warn",
        message: writeScopes
          ? "Required XChat mutation scopes are granted."
          : "One or more XChat mutation scopes are missing.",
        details: {},
      },
      {
        id: "x.passcode",
        status: passcodeEnabled ? "pass" : "fail",
        message: passcodeEnabled
          ? "The XChat passcode is stored and enabled."
          : "Run accounts set-passcode x before reading encrypted messages.",
        details: {},
      },
    );
    diagnostics.readReady &&= !expired && readScopes && passcodeEnabled;
    diagnostics.mutationReady &&= !expired && writeScopes && passcodeEnabled;
    diagnostics.healthy = diagnostics.checks.every(
      (check) => check.status !== "fail",
    );
    return diagnostics;
  }

  private usersFromIncludes(value: unknown) {
    const users = new Map<string, Participant>();
    for (const candidate of array(record(value)?.users)) {
      const user = record(candidate);
      const userID = id(user?.id);
      if (!userID) continue;
      users.set(userID, {
        userID,
        username: string(user?.username),
        displayName: string(user?.name),
      });
    }
    return users;
  }

  private normalizeConversation(
    candidate: unknown,
    users: Map<string, Participant>,
  ): Conversation | null {
    const value = record(candidate);
    const conversationID = id(value?.id);
    if (!value || !conversationID) return null;
    const participantIDs = compactMap([
      ...array(value.participant_ids),
      ...array(value.member_ids),
    ], id)
      .filter((entry, index, all) => all.indexOf(entry) === index);
    const participants = participantIDs.map(
      (participantID): Participant =>
        users.get(participantID) ?? {
          userID: participantID,
          username: null,
          displayName: null,
        },
    );
    const others = participants.filter(
      (participant) => participant.userID !== this.credential.accountUserID,
    );
    const isGroup = conversationID.startsWith("g") || others.length > 1;
    const title = isGroup
      ? null
      : others[0]?.username
        ? `@${others[0].username}`
        : (others[0]?.displayName ?? null);
    const unread = boolean(value.unread);
    return {
      conversationID,
      type: isGroup ? "group" : "direct",
      protocol: "xchat",
      title,
      participants,
      unreadCount: unread === false ? 0 : null,
      unread,
      latestMessageAt: isoTime(value.updated_at),
      latestMessageID: id(value.newest_event_id)
        ? messageID(conversationID, String(value.newest_event_id))
        : null,
      lastReadMessageID: id(value.last_read_event_id)
        ? messageID(conversationID, String(value.last_read_event_id))
        : null,
      muted: boolean(value.is_muted),
      archived: boolean(value.is_archived),
      providerData: value,
    };
  }

  async listConversations(options: ListOptions) {
    const data = await this.client.get<XPage>("/2/chat/conversations", {
      max_results: Math.min(options.limit, 1000),
      "chat_conversation.fields": CONVERSATION_FIELDS,
      expansions: "participant_ids,member_ids,admin_ids",
      "user.fields": "id,name,username",
      pagination_token: options.cursor,
      unread_only: options.unread || null,
    });
    const users = this.usersFromIncludes(data.includes);
    const items = compactMap(array(data.data), (conversation) =>
      this.normalizeConversation(conversation, users),
    );
    return {
      items,
      nextCursor: string(record(data.meta)?.next_token),
    };
  }

  private normalizeMessageRequest(
    candidate: unknown,
    category: MessageRequest["category"],
    detailReadMarksDelivered: boolean,
  ): MessageRequest | null {
    const value = record(candidate);
    const conversationID = id(value?.conversation_id);
    if (!value || !conversationID) return null;
    const participantID = id(value.sender_id ?? value.participant_id);
    const conversation: Conversation = {
      conversationID,
      type: "direct",
      protocol: "xchat",
      title: null,
      participants: participantID
        ? [{ userID: participantID, username: null, displayName: null }]
        : [],
      unreadCount: null,
      unread: true,
      latestMessageAt: null,
      latestMessageID: null,
      lastReadMessageID: null,
      muted: null,
      archived: null,
      providerData: value,
    };
    const state = string(value.message_request_state);
    return {
      requestID: conversationID,
      conversation,
      state:
        state === "received" || state === "sent" || state === "none"
          ? state
          : "unknown",
      category,
      senderRecentlyModifiedProfile: boolean(
        value.sender_recently_modified_profile,
      ),
      socialProofUserIDs: compactMap(array(value.social_proof_user_ids), id),
      hasMoreMessages: boolean(value.has_more_events),
      detailReadMarksDelivered,
      providerData: value,
    };
  }

  async listMessageRequests(options: MessageRequestListOptions) {
    const category = options.category ?? "priority";
    if (category !== "priority" && category !== "hidden") {
      throw invalidRequest("X request category must be priority or hidden.");
    }
    const data = await this.client.get<XPage>("/2/chat/message_requests", {
      inbox_type: category === "hidden" ? "low_quality" : "you_may_know",
      max_results: Math.min(options.limit, 50),
      "chat_message_request.fields":
        "conversation_id,encoded_message_create_event,has_more_events,message_events,sender_id,sender_recently_modified_profile,social_proof_user_ids",
      pagination_token: options.cursor,
    });
    return {
      items: compactMap(array(data.data), (candidate) =>
        this.normalizeMessageRequest(
          candidate,
          category,
          true,
        ),
      ),
      nextCursor: string(record(data.meta)?.next_token),
    };
  }

  private async messageRequestDetail(
    conversationID: string,
    acknowledgeDelivery: boolean,
  ) {
    if (!acknowledgeDelivery) {
      throw invalidRequest(
        "X marks message-request detail reads as delivered; pass --acknowledge-delivery to continue.",
      );
    }
    const data = await this.client.get<XPage>(
      `/2/chat/message_requests/${encodeURIComponent(conversationID)}`,
      {
        "chat_message_request_detail.fields":
          "conversation_id,conversation_key_events,has_more_events,message_events,message_request_state,participant_id",
      },
    );
    const detail = record(data.data);
    if (!detail) {
      throw new DmbridgeError(
        "resource.notFound",
        "X did not return the requested XChat message request.",
      );
    }
    return detail;
  }

  async getMessageRequest(
    conversationID: string,
    acknowledgeDelivery: boolean,
  ) {
    const detail = await this.messageRequestDetail(
      conversationID,
      acknowledgeDelivery,
    );
    const normalized = this.normalizeMessageRequest(detail, null, true);
    if (!normalized) {
      throw new DmbridgeError(
        "resource.notFound",
        "X returned an invalid XChat message request.",
      );
    }
    return normalized;
  }

  async listMessageRequestMessages(
    options: MessageListOptions,
    acknowledgeDelivery: boolean,
  ) {
    if (options.cursor) {
      throw unsupportedOperation(
        "XChat message-request detail does not expose pagination.",
      );
    }
    const conversationID = options.conversationID;
    const detail = await this.messageRequestDetail(
      conversationID,
      acknowledgeDelivery,
    );
    const normalized = this.normalizeMessageRequest(detail, null, true);
    if (!normalized) {
      throw new DmbridgeError(
        "resource.notFound",
        "X returned an invalid XChat message request.",
      );
    }
    const page: XPage = {
      data: compactMap(array(detail.message_events), (candidate) => {
        const encodedEvent = string(candidate);
        return encodedEvent ? { encoded_event: encodedEvent } : null;
      }),
      meta: { conversation_key_events: array(detail.conversation_key_events) },
    };
    return this.withSession(this.session(normalized.conversation, page), (loaded) => ({
        items: this.normalizedMessages(loaded, conversationID),
        nextCursor: null,
        hasMoreMessages: boolean(detail.has_more_events),
      }),
    );
  }

  async acceptMessageRequest(
    conversationID: string,
    request?: SendRequest,
  ): Promise<MutationResult> {
    if (request) {
      throw invalidRequest(
        "XChat request acceptance does not accept a message request body.",
      );
    }
    const data = await this.client.mutate<JsonRecord>(
      `/2/chat/message_requests/${encodeURIComponent(conversationID)}/accept`,
      "POST",
    );
    return { confirmed: true, effect: "accepted", providerResponse: data };
  }

  async declineMessageRequest(
    conversationID: string,
  ): Promise<MutationResult> {
    const data = await this.client.mutate<JsonRecord>(
      `/2/chat/conversations/${encodeURIComponent(conversationID)}`,
      "DELETE",
      {},
    );
    return { confirmed: true, effect: "declined", providerResponse: data };
  }

  async getConversation(conversationID: string) {
    const data = await this.client.get<XPage>(
      `/2/chat/conversations/${encodeURIComponent(conversationID)}`,
      {
        "chat_conversation.fields": CONVERSATION_FIELDS,
        expansions: "participant_ids,member_ids,admin_ids",
        "user.fields": "id,name,username",
      },
    );
    const normalized = this.normalizeConversation(
      data.data,
      this.usersFromIncludes(data.includes),
    );
    if (!normalized) {
      throw new DmbridgeError(
        "resource.notFound",
        "X did not return the requested XChat conversation.",
      );
    }
    return normalized;
  }

  private async getEvents(
    conversationID: string,
    limit: number,
    cursor: string | null,
  ) {
    return this.client.get<XPage>(
      `/2/chat/conversations/${encodeURIComponent(conversationID)}/events`,
      {
        max_results: Math.min(limit, 100),
        "chat_message_event.fields": EVENT_FIELDS,
        pagination_token: cursor,
      },
    );
  }

  private async publicKeys(userID: string) {
    const data = await this.client.get<XPage>(
      `/2/users/${encodeURIComponent(userID)}/public_keys`,
      { "public_key.fields": PUBLIC_KEY_FIELDS },
    );
    return compactMap(array(data.data), record);
  }

  private async realmTokenFromIssuer(realmID: string) {
    if (!this.credential.realmTokenIssuerURL) {
      throw new DmbridgeError(
        "xchat.realmAuthNotConfigured",
        "XChat decryption requires a realm token issuer URL in the X credential.",
        { exitCode: 3 },
      );
    }
    const url = new URL(this.credential.realmTokenIssuerURL);
    url.searchParams.set("realm_id", realmID);
    const response = await fetch(url, {
      headers: this.headers(),
      signal: timeoutSignal(30_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new DmbridgeError(
        "xchat.realmAuthFailed",
        `XChat realm token issuer failed with HTTP ${response.status}.`,
        { details: { httpStatus: response.status } },
      );
    }
    try {
      const value = JSON.parse(body) as JsonRecord;
      const token = string(value.token ?? value.authToken ?? value.auth_token);
      if (token) return token;
    } catch {
      // A plain-text token is also accepted.
    }
    if (body.trim()) return body.trim();
    throw new DmbridgeError(
      "xchat.realmAuthFailed",
      "XChat realm token issuer returned no token.",
    );
  }

  private async session(
    conversation: Conversation,
    page: XPage,
  ): Promise<LoadedSession> {
    const ownKeys = await this.publicKeys(this.credential.accountUserID);
    const ownKey = newestKey(ownKeys);
    const juiceboxConfig = ownKey?.juicebox_config;
    const ownVersion = string(ownKey?.public_key_version);
    if (!juiceboxConfig || !ownVersion) {
      throw new DmbridgeError(
        "xchat.keysUnavailable",
        "The X account did not return registered XChat key material.",
        { exitCode: 3 },
      );
    }
    const realmTokens = realmTokensFromJuiceboxConfig(juiceboxConfig);
    if (realmTokens.size === 0 && !this.credential.realmTokenIssuerURL) {
      throw new DmbridgeError(
        "xchat.realmAuthUnavailable",
        "The fresh X public-key response did not include Juicebox realm tokens.",
        { exitCode: 3 },
      );
    }
    const chat = await (this.dependencies.createChat ?? createChat)({
      juiceboxConfig:
        typeof juiceboxConfig === "string"
          ? juiceboxConfig
          : JSON.stringify(juiceboxConfig),
      getAuthToken: async (realmID) => {
        const token =
          realmTokens.get(realmID) ?? realmTokens.get(realmID.toLowerCase());
        if (token) return token;
        if (this.credential.realmTokenIssuerURL) {
          return this.realmTokenFromIssuer(realmID);
        }
        throw new DmbridgeError(
          "xchat.realmAuthUnavailable",
          "The fresh X public-key response did not include a token for the requested Juicebox realm.",
          { exitCode: 3 },
        );
      },
    });
    const passcode = await readXPasscode(this.store, this.account);
    try {
      await chat.unlock(new TextDecoder().decode(passcode));
    } catch (error) {
      const remaining = guessesRemaining(error);
      if (remaining !== null) {
        await forgetXPasscode(this.store, this.account);
      }
      chat.free();
      throw new DmbridgeError(
        remaining === null ? "xchat.unlockFailed" : "xchat.passcodeRejected",
        remaining === null
          ? "XChat could not be unlocked."
          : "The stored XChat passcode was rejected and has been forgotten.",
        {
          exitCode: 3,
          details: { guessesRemaining: remaining },
          cause: error,
        },
      );
    } finally {
      passcode.fill(0);
    }
    chat.setIdentity(this.credential.accountUserID, ownVersion);
    chat.setCacheKeys(true);
    const participantIDs = conversation.participants.map(
      (participant) => participant.userID,
    );
    if (!participantIDs.includes(this.credential.accountUserID)) {
      participantIDs.push(this.credential.accountUserID);
    }
    const signingKeys: SigningKeyEntry[] = [];
    for (const participantID of participantIDs) {
      const keys =
        participantID === this.credential.accountUserID
          ? ownKeys
          : await this.publicKeys(participantID);
      for (const key of keys) {
        const publicKeyVersion = string(key.public_key_version);
        const publicKey = string(key.signing_public_key);
        const identityPublicKey = string(key.public_key);
        const identityPublicKeySignature = string(
          key.identity_public_key_signature,
        );
        if (
          publicKeyVersion &&
          publicKey &&
          identityPublicKey &&
          identityPublicKeySignature
        ) {
          signingKeys.push({
            userId: participantID,
            publicKeyVersion,
            publicKey,
            identityPublicKey,
            identityPublicKeySignature,
          });
        }
      }
    }
    chat.setSigningKeys(signingKeys);
    const keyEvents = compactMap(
      array(record(page.meta)?.conversation_key_events),
      string,
    );
    const encodedEvents = compactMap(array(page.data), (candidate) =>
      string(record(candidate)?.encoded_event),
    );
    const decrypted = chat.decryptEvents([...keyEvents, ...encodedEvents]);
    return { chat, decrypted, keys: decrypted.conversationKeys.keys };
  }

  private async withSession<T>(
    pending: Promise<LoadedSession>,
    operation: (loaded: LoadedSession) => T | Promise<T>,
  ) {
    const loaded = await pending;
    try {
      return await operation(loaded);
    } finally {
      loaded.chat.free();
    }
  }

  private normalizeAttachment(
    candidate: unknown,
    conversationID: string,
    keyVersion: string | null,
  ): Attachment | null {
    const value = record(candidate);
    if (!value) return null;
    const mediaHashKey = string(value.mediaHashKey);
    const mediaType = string(value.mediaType);
    const filename = string(value.filename);
    const type = messageTypeForAttachment(value);
    const locator =
      mediaHashKey && keyVersion
        ? `xatt_${encodeOpaque({
            version: 1,
            conversationID,
            keyVersion,
            mediaHashKey,
            mediaType,
            filename,
          })}`
        : `xatt_${encodeOpaque({
            version: 1,
            conversationID,
            keyVersion: keyVersion ?? "unavailable",
            mediaHashKey: mediaHashKey ?? "unavailable",
            mediaType,
            filename,
          })}`;
    return {
      attachmentID: locator,
      type: type === "text" ? "unknown" : type,
      mediaType,
      filename,
      sourceURL: string(
        value.url ?? value.legacyMediaUrlHttps ?? value.legacyMediaPreviewUrl,
      ),
      providerData: value,
    };
  }

  private normalizeEvent(
    event: XEvent,
    originalB64: string | undefined,
    fallbackConversationID: string,
  ): Message | null {
    const eventID = id(event.id ?? event.sequenceId);
    const conversationID = id(event.conversationId) ?? fallbackConversationID;
    if (!eventID) return null;
    const content = record(event.content);
    const contentType = string(content?.contentType);
    const text = string(content?.text ?? content?.newText);
    const attachments = compactMap(
      array(event.attachments ?? content?.attachments),
      (candidate) => this.normalizeAttachment(
        candidate,
        conversationID,
        string(event.keyVersion),
      ),
    );
    let type: MessageType = event.type === "message" ? "unknown" : "system";
    if (contentType === "text") type = attachments[0]?.type ?? "text";
    else if (contentType === "edit") type = "text";
    else if (event.type === "messageDeleted") type = "deleted";
    else if (contentType && ["reaction", "reactionRemoved"].includes(contentType)) {
      type = "system";
    }
    const reaction: Reaction[] = [];
    const emoji = string(content?.emoji);
    if (emoji && contentType === "reaction") {
      reaction.push({
        reaction: emoji,
        userIDs: event.senderId ? [event.senderId] : [],
        reactedByAuthenticatedUser:
          event.senderId === this.credential.accountUserID,
      });
    }
    const replyPreview = record(content?.replyingToPreview);
    return {
      messageID: messageID(conversationID, eventID),
      conversationID,
      senderID: id(event.senderId),
      senderUsername: null,
      sentAt: isoTime(event.createdAtMsec),
      type,
      text,
      direction:
        event.senderId === this.credential.accountUserID
          ? "outbound"
          : event.senderId
            ? "inbound"
            : "unknown",
      replyToMessageID: id(
        replyPreview?.messageId ?? replyPreview?.sequenceId,
      )
        ? messageID(
            conversationID,
            String(replyPreview?.messageId ?? replyPreview?.sequenceId),
          )
        : null,
      read: null,
      attachments,
      reactions: reaction,
      providerType: contentType ?? event.type,
      providerData: {
        eventID,
        eventType: event.type,
        verified: event.verified ?? null,
        targetMessageID: id(content?.targetMessageId),
        ...(originalB64 ? { encodedEvent: originalB64 } : {}),
      },
    };
  }

  private normalizedMessages(
    session: LoadedSession,
    conversationID: string,
  ) {
    return compactMap(session.decrypted.messages, ({ event, originalB64 }) =>
      this.normalizeEvent(
        event,
        originalB64,
        conversationID,
      ),
    );
  }

  async listMessages(options: MessageListOptions) {
    const conversation = await this.getConversation(options.conversationID);
    const page = await this.getEvents(
      options.conversationID,
      options.limit,
      options.cursor,
    );
    return this.withSession(this.session(conversation, page), (loaded) => ({
        items: this.normalizedMessages(loaded, options.conversationID),
        nextCursor: string(record(page.meta)?.next_token),
      }),
    );
  }

  private async locateMessage(value: string) {
    const locator = decodeMessageID(value);
    const conversation = await this.getConversation(locator.conversationID);
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await this.getEvents(locator.conversationID, 100, cursor);
      const found = await this.withSession(this.session(conversation, page), (loaded) => {
        const messages = this.normalizedMessages(loaded, locator.conversationID);
        const message = messages.find(
          (candidate) =>
            decodeMessageID(candidate.messageID).eventID === locator.eventID,
        );
        if (message) {
          const encodedEvent = string(message.providerData?.encodedEvent);
          return { locator, conversation, message, page, encodedEvent };
        }
        return null;
      });
      if (found) return found;
      cursor = string(record(page.meta)?.next_token);
      if (!cursor) break;
    }
    throw new DmbridgeError(
      "resource.notFound",
      "X did not return the requested XChat message.",
    );
  }

  async getMessage(value: string) {
    return (await this.locateMessage(value)).message;
  }

  async downloadAttachment(
    value: string,
    destinationURL: URL,
    overwrite: boolean,
  ) {
    const locator = decodeAttachmentID(value);
    const conversation = await this.getConversation(locator.conversationID);
    const page = await this.getEvents(locator.conversationID, 100, null);
    return this.withSession(this.session(conversation, page), async (loaded) => {
      const key = loaded.keys[locator.keyVersion];
      if (!key) {
        throw new DmbridgeError(
          "xchat.conversationKeyUnavailable",
          "The attachment conversation key was not present in the fetched XChat key events.",
        );
      }
      const url = new URL(
        `/2/chat/media/${encodeURIComponent(locator.conversationID)}/${encodeURIComponent(locator.mediaHashKey)}`,
        API_BASE,
      );
      const response = await fetch(url, {
        headers: this.headers(),
        signal: timeoutSignal(120_000),
      });
      if (!response.ok) {
        throw new DmbridgeError(
          "attachment.downloadFailed",
          `XChat media download failed with HTTP ${response.status}.`,
          { retrySafety: "safe", details: { httpStatus: response.status } },
        );
      }
      const encrypted = new Uint8Array(await response.arrayBuffer());
      const decrypted = loaded.chat.decryptStream(encrypted, key);
      return writeBytesToFileURL(
        decrypted,
        destinationURL,
        overwrite,
        locator.mediaType,
      );
    });
  }

  private async primeSession(conversationID: string) {
    const conversation = await this.getConversation(conversationID);
    const page = await this.getEvents(conversationID, 100, null);
    return this.session(conversation, page);
  }

  private sendBody(payload: SendPayload) {
    return {
      message_id: payload.messageId,
      encoded_message_create_event: payload.encryptedContent,
      encoded_message_event_signature: payload.encodedEventSignature,
    };
  }

  private async postEncrypted(conversationID: string, payload: SendPayload) {
    return this.client.mutate<JsonRecord>(
      `/2/chat/conversations/${encodeURIComponent(conversationID)}/messages`,
      "POST",
      this.sendBody(payload),
    );
  }

  private textRequest(request: SendRequest) {
    if (request.type !== "text" || !string(request.text ?? request.content?.text)) {
      throw invalidRequest("XChat currently accepts text mutation requests only.");
    }
    return String(request.text ?? request.content?.text);
  }

  async sendMessage(conversationID: string, request: SendRequest) {
    return this.withSession(this.primeSession(conversationID), async (loaded) => {
      const payload = loaded.chat.encryptMessage({
        conversationId: conversationID,
        text: this.textRequest(request),
      });
      const data = await this.postEncrypted(conversationID, payload);
      return { confirmed: true, effect: "sent", providerResponse: data };
    });
  }

  private async targetMutation(
    value: string,
    operation: (
      chat: ChatWithJuicebox,
      conversationID: string,
      encodedEvent: string,
    ) => SendPayload,
  ): Promise<MutationResult> {
    const located = await this.locateMessage(value);
    if (!located.encodedEvent) {
      throw new DmbridgeError(
        "xchat.rawEventUnavailable",
        "The target XChat event did not include its encoded event.",
      );
    }
    const encodedEvent = located.encodedEvent;
    return this.withSession(
      this.primeSession(located.locator.conversationID),
      async (loaded) => {
      const payload = operation(
        loaded.chat,
        located.locator.conversationID,
        encodedEvent,
      );
      const data = await this.postEncrypted(
        located.locator.conversationID,
        payload,
      );
      return { confirmed: true, effect: "exact", providerResponse: data };
      },
    );
  }

  async replyToMessage(value: string, request: SendRequest) {
    const text = this.textRequest(request);
    return this.targetMutation(value, (chat, conversationID, encodedEvent) =>
      chat.encryptReply({
        conversationId: conversationID,
        text,
        replyToEvent: encodedEvent,
      }),
    );
  }

  async editMessage(value: string, request: SendRequest) {
    const text = this.textRequest(request);
    return this.targetMutation(value, (chat, conversationID, encodedEvent) =>
      chat.encryptEdit({
        conversationId: conversationID,
        updatedText: text,
        targetEvent: encodedEvent,
      }),
    );
  }

  async deleteMessage(value: string): Promise<MutationResult> {
    const locator = decodeMessageID(value);
    return this.withSession(this.primeSession(locator.conversationID), async (loaded) => {
      const signature = loaded.chat.prepareMessageDelete({
        conversationId: locator.conversationID,
        sequenceIds: [locator.eventID],
        deleteForAll: true,
      });
      const data = await this.client.mutate<JsonRecord>(
        `/2/chat/conversations/${encodeURIComponent(locator.conversationID)}/messages/delete`,
        "POST",
        {
          sequence_ids: [locator.eventID],
          delete_message_action: "delete_for_all",
          action_signatures: [
            {
              message_id: signature.messageId,
              encoded_message_event_detail: signature.encodedMessageEventDetail,
              message_event_signature: {
                signature: signature.signature,
                signature_version: signature.signatureVersion,
                public_key_version: signature.publicKeyVersion,
              },
              ...(signature.signaturePayload
                ? { signature_payload: signature.signaturePayload }
                : {}),
            },
          ],
        },
      );
      return { confirmed: true, effect: "exact", providerResponse: data };
    });
  }

  private async conversationMutation(
    value: string,
    action: "read" | "unread",
  ): Promise<MutationResult> {
    const locator = decodeMessageID(value);
    const data = await this.client.mutate<JsonRecord>(
      `/2/chat/conversations/${encodeURIComponent(locator.conversationID)}/${action}`,
      "POST",
    );
    return { confirmed: true, effect: "conversation", providerResponse: data };
  }

  async markMessageRead(value: string) {
    return this.conversationMutation(value, "read");
  }

  async markMessageUnread(value: string) {
    return this.conversationMutation(value, "unread");
  }

  async listReactions(value: string) {
    const locator = decodeMessageID(value);
    const conversation = await this.getConversation(locator.conversationID);
    let cursor: string | null = null;
    const reactions = new Map<string, Set<string>>();
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await this.getEvents(locator.conversationID, 100, cursor);
      await this.withSession(this.session(conversation, page), (loaded) => {
        for (const { event } of loaded.decrypted.messages) {
          const content = record(event.content);
          if (id(content?.targetMessageId) !== locator.eventID) continue;
          const emoji = string(content?.emoji);
          const senderID = id(event.senderId);
          if (!emoji || !senderID) continue;
          const users = reactions.get(emoji) ?? new Set<string>();
          if (content?.contentType === "reactionRemoved") users.delete(senderID);
          else if (content?.contentType === "reaction") users.add(senderID);
          reactions.set(emoji, users);
        }
      });
      cursor = string(record(page.meta)?.next_token);
      if (!cursor) break;
    }
    return [...reactions.entries()]
      .filter(([, users]) => users.size > 0)
      .map(([reaction, users]) => ({
        reaction,
        userIDs: [...users],
        reactedByAuthenticatedUser: users.has(this.credential.accountUserID),
      }));
  }

  async reactToMessage(value: string, reaction: string) {
    if (!reaction.trim()) throw invalidRequest("Reaction cannot be empty.");
    return this.targetMutation(value, (chat, conversationID, encodedEvent) =>
      chat.encryptAddReaction({
        conversationId: conversationID,
        emoji: reaction,
        targetEvent: encodedEvent,
      }),
    );
  }

  async unreactToMessage(value: string, reaction: string) {
    if (!reaction.trim()) throw invalidRequest("Reaction cannot be empty.");
    return this.targetMutation(value, (chat, conversationID, encodedEvent) =>
      chat.encryptRemoveReaction({
        conversationId: conversationID,
        emoji: reaction,
        targetEvent: encodedEvent,
      }),
    );
  }
}
