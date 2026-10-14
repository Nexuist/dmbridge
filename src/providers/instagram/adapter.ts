import { Buffer } from "node:buffer";

import { downloadToFileURL } from "../../download.js";
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
import {
  normalizeInstagramCredential,
  type InstagramCredential,
} from "./credentials.js";
import { ProviderClient } from "../http.js";
import {
  array,
  compactMap,
  httpsURL,
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
  type PageOptions,
  type ProviderAdapter,
  type ProviderDefinition,
  type SendRequest,
} from "../types.js";

interface InstagramProfile {
  id?: unknown;
  user_id?: unknown;
  username?: unknown;
}

interface InstagramPage {
  data?: unknown;
  paging?: {
    cursors?: { after?: unknown };
    next?: unknown;
  };
}

const INSTAGRAM_UNSUPPORTED_READ_TYPES = new Set<MessageType>([
  "location",
  "contact",
  "reply",
  "quote",
  "system",
  "deleted",
]);
const INSTAGRAM_READ_TYPES = MessageTypeSchema.options.filter(
  (type) => !INSTAGRAM_UNSUPPORTED_READ_TYPES.has(type),
);

const attachmentID = (url: string) =>
  `instagram-url-${Buffer.from(url, "utf8").toString("base64url")}`;

const attachmentURL = (value: string) => {
  if (!value.startsWith("instagram-url-")) {
    throw invalidRequest("Instagram attachment ID is invalid.");
  }
  try {
    const parsed = new URL(
      Buffer.from(value.slice("instagram-url-".length), "base64url").toString(
        "utf8",
      ),
    );
    if (parsed.protocol !== "https:") throw new Error("not HTTPS");
    return parsed;
  } catch (error) {
    throw invalidRequest(
      `Instagram attachment ID is invalid: ${error instanceof Error ? error.message : "decode failed"}`,
    );
  }
};

export class InstagramAdapter extends ProviderAdapterBase implements ProviderAdapter {
  readonly id = "instagram" as const;
  private readonly client: ProviderClient;

  constructor(
    private readonly credential: InstagramCredential,
    private readonly account: string,
  ) {
    super();
    const baseURL = credential.apiVersion
      ? `https://graph.instagram.com/${credential.apiVersion.replace(/^v/, "v")}`
      : "https://graph.instagram.com";
    this.client = new ProviderClient("instagram", baseURL, () => ({
      Authorization: `Bearer ${this.credential.accessToken}`,
    }));
  }

  private async profile() {
    const data = await this.client.get<InstagramProfile>("/me", {
      fields: "user_id,username",
    });
    const accountID = id(data.user_id ?? data.id);
    if (!accountID) {
      throw new DmbridgeError(
        "auth.invalidCredential",
        "Instagram identity lookup returned no account ID.",
        { exitCode: 3 },
      );
    }
    return { accountID, username: string(data.username) };
  }

  async authStatus(live: boolean) {
    if (!live) {
      return {
        account: this.account,
        configured: true,
        connected: null,
        accountID: this.credential.accountID,
        accountUsername: this.credential.accountUsername,
      };
    }
    const profile = await this.profile();
    return {
      account: this.account,
      configured: true,
      connected: true,
      accountID: profile.accountID,
      accountUsername: profile.username,
    };
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return providerCapabilities("instagram", this.account, {
      folders: ["requests"],
      messageTypes: {
        read: INSTAGRAM_READ_TYPES,
        send: ["text", "image", "video", "audio", "file"],
      },
      mutations: {
        send: true,
        reply: true,
        markRead: true,
        react: true,
        unreact: true,
      },
      messageReadMode: "conversation",
      attachments: { list: true, download: true, send: true },
      messageRequests: {
        list: true,
        get: true,
        messages: true,
        accept: true,
        categories: ["requests"],
        acceptRequiresReply: true,
      },
      limitations: [
        "Official Instagram messaging access is limited to eligible professional accounts and conversations visible to the configured token.",
        "The official API does not expose group conversation management through this adapter.",
        "Mark-read applies to the recipient conversation rather than one isolated server-side message record.",
        "Instagram request-folder conversations inactive for more than 30 days may not be returned by the official API.",
        "Instagram accepts a message request when the professional account replies; it does not expose separate accept-without-reply or decline operations.",
      ],
    });
  }

  private participants(value: unknown): Participant[] {
    const data = record(value)?.data;
    return compactMap(array(data), (candidate) => {
      const participant = record(candidate);
      const userID = id(participant?.id);
      return userID
        ? {
            userID,
            username: string(participant?.username),
            displayName: string(participant?.name),
          }
        : null;
    });
  }

  private normalizeAttachment(candidate: unknown): Attachment | null {
    const value = record(candidate);
    if (!value) return null;
    const nested = (name: string) => record(value[name]);
    const rawURL =
      value.url ??
      value.file_url ??
      nested("image_data")?.url ??
      nested("video_data")?.url ??
      nested("audio_data")?.url;
    const sourceURL = httpsURL(rawURL);
    const type: MessageType = value.image_data
      ? "image"
      : value.video_data
        ? "video"
        : value.audio_data
          ? "audio"
          : value.file_url
            ? "file"
            : "unknown";
    return {
      attachmentID: sourceURL
        ? attachmentID(sourceURL)
        : `instagram-opaque-${id(value.id) ?? "unknown"}`,
      type,
      mediaType: string(value.mime_type ?? value.mimeType),
      filename: string(value.name ?? value.filename ?? value.title),
      sourceURL,
      providerData: value,
    };
  }

  private normalizeMessage(
    candidate: unknown,
    conversationID: string,
    accountID: string,
  ): Message | null {
    const value = record(candidate);
    const messageID = id(value?.id);
    if (!value || !messageID) return null;
    const sender = record(value.from);
    const senderID = id(sender?.id);
    const text = string(value.message);
    const attachments = compactMap(
      array(record(value.attachments)?.data),
      (attachment) => this.normalizeAttachment(attachment),
    );
    const sharesValue = record(value.shares);
    const shares = array(sharesValue?.data ?? (sharesValue ? [sharesValue] : []));
    for (const share of shares) {
      const normalized = record(share);
      const sourceURL = httpsURL(normalized?.link);
      attachments.push({
        attachmentID: sourceURL
          ? attachmentID(sourceURL)
          : `instagram-share-${id(normalized?.id) ?? "unknown"}`,
        type: "sharedPost",
        mediaType: null,
        filename: null,
        sourceURL,
        ...(normalized ? { providerData: normalized } : {}),
      });
    }
    const story = record(value.story);
    if (story) {
      const sourceURL = httpsURL(story.link);
      attachments.push({
        attachmentID: sourceURL
          ? attachmentID(sourceURL)
          : `instagram-story-${id(story.id) ?? "unknown"}`,
        type: "sharedStory",
        mediaType: null,
        filename: null,
        sourceURL,
        providerData: story,
      });
    }
    const reactionRows = array(record(value.reactions)?.data ?? value.reactions);
    const reactions: Reaction[] = compactMap(reactionRows, (reaction) => {
      const normalized = record(reaction);
      const emoji = string(normalized?.reaction ?? normalized?.emoji);
      if (!emoji) return null;
      const users = compactMap(array(normalized?.users), (user) =>
        id(record(user)?.id),
      );
      return {
        reaction: emoji,
        userIDs: users,
        reactedByAuthenticatedUser: users.includes(accountID),
      };
    });
    let type: MessageType = "unknown";
    if (text) type = "text";
    else if (attachments[0]) type = attachments[0].type;
    else if (value.is_unsupported === true) type = "unsupported";
    return {
      messageID,
      conversationID,
      senderID,
      senderUsername: string(sender?.username),
      sentAt: isoTime(value.created_time),
      type,
      text,
      direction:
        senderID === accountID ? "outbound" : senderID ? "inbound" : "unknown",
      replyToMessageID: id(record(value.reply_to)?.mid),
      read: null,
      attachments,
      reactions,
      providerType: string(value.type),
      providerData: value,
    };
  }

  private normalizeConversation(
    candidate: unknown,
    accountID: string,
  ): Conversation | null {
    const value = record(candidate);
    const conversationID = id(value?.id);
    if (!value || !conversationID) return null;
    const participants = this.participants(value.participants);
    const others = participants.filter((participant) => participant.userID !== accountID);
    const title =
      string(value.name) ??
      (others.length === 1
        ? others[0]?.username
          ? `@${others[0].username}`
          : others[0]?.displayName
        : others
            .map((participant) => participant.username ?? participant.displayName)
            .filter(Boolean)
            .join(", ")) ??
      null;
    const latestCandidate = array(record(value.messages)?.data)
      .map((message) => this.normalizeMessage(message, conversationID, accountID))
      .filter((message): message is Message => message !== null)
      .sort((left, right) => (right.sentAt ?? "").localeCompare(left.sentAt ?? ""))[0];
    return {
      conversationID,
      type: participants.length > 2 ? "group" : "direct",
      protocol: "instagram",
      title,
      participants,
      unreadCount: null,
      unread: null,
      latestMessageAt: latestCandidate?.sentAt ?? isoTime(value.updated_time),
      latestMessageID: latestCandidate?.messageID ?? null,
      lastReadMessageID: null,
      muted: null,
      archived: null,
      providerData: value,
    };
  }

  private async listConversationPage(
    options: PageOptions,
    folder: "requests" | null,
  ) {
    const profile = await this.profile();
    const data = await this.client.get<InstagramPage>(
      `/${encodeURIComponent(profile.accountID)}/conversations`,
      {
        platform: "instagram",
        folder,
        fields:
          "id,updated_time,participants,messages.limit(1){id,created_time,from,to,message,attachments,shares,reactions,story,is_unsupported,tags}",
        limit: Math.min(options.limit, 100),
        after: options.cursor,
      },
    );
    const items = compactMap(array(data.data), (conversation) =>
      this.normalizeConversation(conversation, profile.accountID),
    );
    const cursor = string(data.paging?.cursors?.after);
    return {
      items,
      nextCursor: string(data.paging?.next) && cursor ? cursor : null,
    };
  }

  async listConversations(options: ListOptions) {
    if (options.unread) {
      throw unsupportedOperation(
        "Instagram does not expose unread conversation filtering through this adapter.",
      );
    }
    return this.listConversationPage(options, null);
  }

  private messageRequestFromConversation(
    conversation: Conversation,
  ): MessageRequest {
    return {
      requestID: conversation.conversationID,
      conversation,
      state: "unknown",
      category: "requests",
      senderRecentlyModifiedProfile: null,
      socialProofUserIDs: [],
      hasMoreMessages: null,
      detailReadMarksDelivered: false,
      ...(conversation.providerData
        ? { providerData: conversation.providerData }
        : {}),
    };
  }

  async listMessageRequests(options: MessageRequestListOptions) {
    if (options.category && options.category !== "requests") {
      throw invalidRequest("Instagram request category must be requests.");
    }
    const conversations = await this.listConversationPage(options, "requests");
    return {
      items: conversations.items.map((conversation) =>
        this.messageRequestFromConversation(conversation),
      ),
      nextCursor: conversations.nextCursor,
    };
  }

  async getMessageRequest(
    conversationID: string,
    _acknowledgeDelivery: boolean,
  ) {
    return this.messageRequestFromConversation(
      await this.getConversation(conversationID),
    );
  }

  async listMessageRequestMessages(
    options: MessageListOptions,
    _acknowledgeDelivery: boolean,
  ) {
    const page = await this.listMessages(options);
    return {
      ...page,
      hasMoreMessages: page.nextCursor !== null,
    };
  }

  async acceptMessageRequest(
    conversationID: string,
    request?: SendRequest,
  ): Promise<MutationResult> {
    if (!request) {
      throw invalidRequest(
        "Instagram accepts a message request by replying; --request is required.",
      );
    }
    const result = await this.sendMessage(conversationID, request);
    return { ...result, effect: "accepted_by_reply" };
  }

  async getConversation(conversationID: string) {
    const profile = await this.profile();
    const data = await this.client.get<JsonRecord>(
      `/${encodeURIComponent(conversationID)}`,
      { fields: "id,updated_time,participants" },
    );
    const normalized = this.normalizeConversation(data, profile.accountID);
    if (!normalized || normalized.conversationID !== conversationID) {
      throw new DmbridgeError(
        "resource.notFound",
        "Instagram did not return the requested conversation.",
      );
    }
    return normalized;
  }

  async listMessages(options: MessageListOptions) {
    const profile = await this.profile();
    await this.getConversation(options.conversationID);
    const data = await this.client.get<InstagramPage>(
      `/${encodeURIComponent(options.conversationID)}/messages`,
      {
        fields:
          "id,created_time,from,to,message,attachments,shares,reactions,story,is_unsupported,reply_to",
        limit: Math.min(options.limit, 100),
        after: options.cursor,
      },
    );
    const items = compactMap(array(data.data), (message) =>
      this.normalizeMessage(
        message,
        options.conversationID,
        profile.accountID,
      ),
    );
    const cursor = string(data.paging?.cursors?.after);
    return {
      items,
      nextCursor: string(data.paging?.next) && cursor ? cursor : null,
    };
  }

  async getMessage(messageID: string) {
    const profile = await this.profile();
    const data = await this.client.get<JsonRecord>(
      `/${encodeURIComponent(messageID)}`,
      {
        fields:
          "id,created_time,from,to,message,attachments,shares,reactions,story,is_unsupported,reply_to,conversation",
      },
    );
    const conversationID =
      id(record(data.conversation)?.id) ?? "instagram-conversation-unknown";
    const normalized = this.normalizeMessage(
      data,
      conversationID,
      profile.accountID,
    );
    if (!normalized || normalized.messageID !== messageID) {
      throw new DmbridgeError(
        "resource.notFound",
        "Instagram did not return the requested message.",
      );
    }
    return normalized;
  }

  async downloadAttachment(
    value: string,
    destinationURL: URL,
    overwrite: boolean,
  ) {
    return downloadToFileURL(attachmentURL(value), destinationURL, overwrite);
  }

  private async recipientForMessage(messageID: string) {
    const profile = await this.profile();
    const message = await this.getMessage(messageID);
    if (!message.senderID || message.senderID === profile.accountID) {
      throw unsupportedOperation(
        "Instagram requires an inbound message sender to identify the recipient.",
      );
    }
    return { profile, message, recipientID: message.senderID };
  }

  private async recipientForConversation(conversationID: string) {
    const profile = await this.profile();
    const conversation = await this.getConversation(conversationID);
    const others = conversation.participants.filter(
      (participant) => participant.userID !== profile.accountID,
    );
    if (conversation.type === "group" || others.length !== 1 || !others[0]) {
      throw unsupportedOperation(
        "Instagram sending is supported only for direct conversations.",
      );
    }
    return { profile, recipientID: others[0].userID };
  }

  private async postMessageAction(
    accountID: string,
    body: Record<string, unknown>,
  ) {
    return this.client.mutate<JsonRecord>(
      `/${encodeURIComponent(accountID)}/messages`,
      "POST",
      body,
    );
  }

  private messagePayload(request: SendRequest) {
    const text = string(request.text ?? request.content?.text);
    if (request.type === "text" && text) return { text };
    const sourceURL = string(request.attachments?.[0]?.sourceURL);
    if (sourceURL) {
      const allowed = new Set(["image", "video", "audio", "file"]);
      if (!allowed.has(request.type)) {
        throw unsupportedOperation(
          `Instagram cannot send attachment type ${request.type}.`,
        );
      }
      return {
        attachment: {
          type: request.type,
          payload: { url: sourceURL },
        },
      };
    }
    throw invalidRequest(
      "Instagram send requests require text or one attachment sourceURL.",
    );
  }

  async sendMessage(
    conversationID: string,
    request: SendRequest,
  ): Promise<MutationResult> {
    const { profile, recipientID } = await this.recipientForConversation(
      conversationID,
    );
    const data = await this.postMessageAction(profile.accountID, {
      recipient: { id: recipientID },
      message: this.messagePayload(request),
    });
    return { confirmed: true, effect: "sent", providerResponse: data };
  }

  async replyToMessage(
    messageID: string,
    request: SendRequest,
  ): Promise<MutationResult> {
    const { profile, recipientID } = await this.recipientForMessage(messageID);
    const data = await this.postMessageAction(profile.accountID, {
      recipient: { id: recipientID },
      message: this.messagePayload(request),
      reply_to: { mid: messageID },
    });
    return { confirmed: true, effect: "replied", providerResponse: data };
  }

  async markMessageRead(messageID: string): Promise<MutationResult> {
    const { profile, recipientID } = await this.recipientForMessage(messageID);
    const data = await this.postMessageAction(profile.accountID, {
      recipient: { id: recipientID },
      sender_action: "mark_seen",
    });
    return {
      confirmed: true,
      effect: "conversation",
      providerResponse: data,
    };
  }

  async reactToMessage(
    messageID: string,
    reaction: string,
  ): Promise<MutationResult> {
    if (!reaction.trim()) throw invalidRequest("Reaction cannot be empty.");
    const { profile, recipientID } = await this.recipientForMessage(messageID);
    const data = await this.postMessageAction(profile.accountID, {
      recipient: { id: recipientID },
      sender_action: "react",
      payload: { message_id: messageID, reaction },
    });
    return { confirmed: true, effect: "exact", providerResponse: data };
  }

  async unreactToMessage(
    messageID: string,
    reaction: string,
  ): Promise<MutationResult> {
    if (!reaction.trim()) throw invalidRequest("Reaction cannot be empty.");
    const { profile, recipientID } = await this.recipientForMessage(messageID);
    const data = await this.postMessageAction(profile.accountID, {
      recipient: { id: recipientID },
      sender_action: "unreact",
      payload: { message_id: messageID, reaction },
    });
    return { confirmed: true, effect: "exact", providerResponse: data };
  }
}

export const instagramProvider: ProviderDefinition = {
  id: "instagram",
  async addAccount(store, account, request, dryRun) {
    const credential = normalizeInstagramCredential(request);
    if (dryRun) {
      return {
        dryRun: true,
        provider: "instagram",
        account,
        operation: "account.add",
        target: account,
      };
    }
    await store.storeCredential("instagram", account, credential);
    return { provider: "instagram", account, added: true };
  },
  async createAdapter(store, account) {
    const credential = normalizeInstagramCredential(
      await store.readCredential<InstagramCredential>("instagram", account),
    );
    return new InstagramAdapter(credential, account);
  },
};
