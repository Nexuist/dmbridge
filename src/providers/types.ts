import {
  asDmbridgeError,
  unsupportedOperation,
  type DoctorCheck,
  type DoctorResult,
  type Conversation,
  type Message,
  type MessageRequest,
  type MessageRequestMessagesPage,
  type MutationResult,
  type Page,
  type ProviderCapabilities,
  type ProviderID,
  type Reaction,
  type SendRequest,
} from "../protocol.js";
import type { AuthStore } from "../auth.js";
import { record } from "./normalize.js";

export type { MutationResult, SendRequest } from "../protocol.js";
export type ProviderDiagnostics = Omit<DoctorResult, "contracts">;

type NestedCapabilities = "mutations" | "attachments" | "messageRequests";
type CapabilityOverrides = Partial<
  Omit<ProviderCapabilities, "provider" | "account" | "authenticated" | NestedCapabilities>
> & { [K in NestedCapabilities]?: Partial<ProviderCapabilities[K]> };

const falseFlags = <K extends string>(keys: K[]) =>
  Object.fromEntries(keys.map((key) => [key, false])) as Record<K, boolean>;
const mutationDefaults = falseFlags([
  "send", "reply", "edit", "delete", "markRead", "markUnread", "react", "unreact",
]);
const attachmentDefaults = falseFlags(["list", "download", "send"]);
const requestDefaults = {
  ...falseFlags(["list", "get", "messages", "accept", "decline", "detailReadMarksDelivered", "acceptRequiresReply"]),
  categories: [],
};

export const providerCapabilities = (
  provider: ProviderID,
  account: string,
  overrides: CapabilityOverrides,
): ProviderCapabilities => ({
  provider,
  account,
  authenticated: true,
  groupConversations: false,
  folders: [],
  messageTypes: { read: [], send: [] },
  messageReadMode: "unsupported",
  limitations: [],
  ...overrides,
  mutations: { ...mutationDefaults, ...overrides.mutations },
  attachments: { ...attachmentDefaults, ...overrides.attachments },
  messageRequests: { ...requestDefaults, ...overrides.messageRequests },
});

export interface PageOptions {
  cursor: string | null;
  limit: number;
}

export interface ListOptions extends PageOptions {
  unread: boolean;
}

export type MessageListOptions = PageOptions & {
  conversationID: string;
};

export type MessageRequestListOptions = PageOptions & {
  category: string | null;
};

export interface ProviderAdapter {
  readonly id: ProviderID;
  authStatus(live: boolean): Promise<Record<string, unknown>>;
  capabilities(): Promise<ProviderCapabilities>;
  diagnose(account: string, live: boolean): Promise<ProviderDiagnostics>;
  listConversations(options: ListOptions): Promise<Page<Conversation>>;
  listMessageRequests(
    options: MessageRequestListOptions,
  ): Promise<Page<MessageRequest>>;
  getMessageRequest(
    conversationID: string,
    acknowledgeDelivery: boolean,
  ): Promise<MessageRequest>;
  listMessageRequestMessages(
    options: MessageListOptions,
    acknowledgeDelivery: boolean,
  ): Promise<MessageRequestMessagesPage>;
  acceptMessageRequest(
    conversationID: string,
    request?: SendRequest,
  ): Promise<MutationResult>;
  declineMessageRequest(conversationID: string): Promise<MutationResult>;
  getConversation(conversationID: string): Promise<Conversation>;
  listMessages(options: MessageListOptions): Promise<Page<Message>>;
  getMessage(messageID: string): Promise<Message>;
  downloadAttachment(
    attachmentID: string,
    destinationURL: URL,
    overwrite: boolean,
  ): Promise<Record<string, unknown>>;
  sendMessage(
    conversationID: string,
    request: SendRequest,
  ): Promise<MutationResult>;
  replyToMessage(
    messageID: string,
    request: SendRequest,
  ): Promise<MutationResult>;
  editMessage(
    messageID: string,
    request: SendRequest,
  ): Promise<MutationResult>;
  deleteMessage(messageID: string): Promise<MutationResult>;
  markMessageRead(messageID: string): Promise<MutationResult>;
  markMessageUnread(messageID: string): Promise<MutationResult>;
  listReactions(messageID: string): Promise<Reaction[]>;
  reactToMessage(
    messageID: string,
    reaction: string,
  ): Promise<MutationResult>;
  unreactToMessage(
    messageID: string,
    reaction: string,
  ): Promise<MutationResult>;
}

export interface ProviderDefinition {
  readonly id: ProviderID;
  addAccount(
    store: AuthStore,
    account: string,
    request: unknown,
    dryRun: boolean,
  ): Promise<unknown>;
  createAdapter(
    store: AuthStore,
    account: string,
    options: { autoRefresh?: boolean },
  ): Promise<ProviderAdapter>;
}

export abstract class ProviderAdapterBase {
  abstract readonly id: ProviderID;
  abstract authStatus(live: boolean): Promise<Record<string, unknown>>;
  abstract capabilities(): Promise<ProviderCapabilities>;
  abstract getConversation(conversationID: string): Promise<Conversation>;
  abstract getMessage(messageID: string): Promise<Message>;

  protected async diagnosticBase(account: string, live: boolean) {
    const local = record(await this.authStatus(false)) ?? {};
    const capabilities = await this.capabilities();
    const checks: DoctorCheck[] = [{
      id: "auth.configured",
      status: local.configured === true ? "pass" : "fail",
      message: local.configured === true
        ? "Credentials are configured."
        : "Credentials are not configured.",
      details: {},
    }];
    let connected: boolean | null = null;
    if (live) {
      try {
        connected = record(await this.authStatus(true))?.connected === true;
        checks.push({
          id: "auth.live",
          status: connected ? "pass" : "fail",
          message: connected
            ? "Provider authentication succeeded."
            : "Provider authentication did not report a connected account.",
          details: {},
        });
      } catch (error) {
        const normalized = asDmbridgeError(error);
        connected = false;
        checks.push({
          id: "auth.live",
          status: "fail",
          message: normalized.message,
          details: { code: normalized.code },
        });
      }
    } else {
      checks.push({
        id: "auth.live",
        status: "warn",
        message: "Live provider authentication was not requested; pass --live to check it.",
        details: {},
      });
    }
    const readReady = local.configured === true && connected !== false;
    const diagnostics: ProviderDiagnostics = {
      provider: this.id,
      account,
      live,
      healthy: checks.every((check) => check.status !== "fail"),
      readReady,
      mutationReady:
        readReady && Object.values(capabilities.mutations).some(Boolean),
      checks,
      capabilities,
    };
    return { diagnostics, local };
  }

  async diagnose(account: string, live: boolean) {
    return (await this.diagnosticBase(account, live)).diagnostics;
  }

  async listReactions(id: string) { return (await this.getMessage(id)).reactions; }

  async declineMessageRequest(_conversationID?: string): Promise<MutationResult> {
    throw unsupportedOperation(`${this.id} does not expose a message-request decline operation.`);
  }

  async editMessage(_messageID?: string, _request?: SendRequest): Promise<MutationResult> {
    throw unsupportedOperation(`${this.id} does not expose message editing.`);
  }

  async deleteMessage(_messageID?: string): Promise<MutationResult> {
    throw unsupportedOperation(`${this.id} does not expose message deletion.`);
  }

  async markMessageUnread(_messageID?: string): Promise<MutationResult> {
    throw unsupportedOperation(`${this.id} does not expose mark-unread.`);
  }
}
