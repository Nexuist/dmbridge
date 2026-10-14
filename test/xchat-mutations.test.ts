import assert from "node:assert/strict";
import test from "node:test";

import type { ChatWithJuicebox, SendPayload } from "@xdevplatform/chat-xdk";

import { storeXPasscode, XAdapter } from "../src/providers/x/index.js";
import {
  listOptions,
  pageOptions,
  mockRoutes,
  temporaryStore,
  xCredential,
} from "./helpers.js";

const payload = (kind: string): SendPayload => ({
  messageId: `${kind}-id`,
  encryptedContent: `${kind}-encrypted`,
  signature: `${kind}-raw-signature`,
  encodedEventSignature: `${kind}-signature`,
  signatureInfo: { publicKeyVersion: "1", signatureVersion: "1" },
  conversationKeyVersion: "1",
  shouldNotify: true,
});

test("XChat mutation methods build the expected production requests with a mocked SDK", async (t) => {
  const requests = mockRoutes(t, {
    "POST ": { data: { success: true } },
    "DELETE ": { data: { deleted: true } },
    "GET /message_requests/111-333": {
        data: {
          conversation_id: "111-333",
          participant_id: "333",
          message_request_state: "received",
          has_more_events: true,
          conversation_key_events: [],
          message_events: ["request-event"],
        },
      },
    "GET /public_keys": {
        data: [
          {
            public_key_version: "1",
            public_key: "identity-key",
            signing_public_key: "signing-key",
            identity_public_key_signature: "identity-signature",
            juicebox_config: {
              key_store_token_map_json: JSON.stringify({
                realms: [{ id: "AA11", address: "https://realm.example" }],
              }),
              token_map: [{ key: "AA11", value: { token: "realm-secret" } }],
            },
          },
        ],
      },
    "GET /events": {
        data: [{ id: "900", sender_id: "222", encoded_event: "encoded-target" }],
        meta: { conversation_key_events: [], next_token: null },
      },
    "GET /2/chat/conversations?": {
        data: [
          {
            id: "111-222",
            participant_ids: ["111", "222"],
            unread: true,
            newest_event_id: "900",
          },
        ],
        includes: {
          users: [
            { id: "111", username: "owner", name: "Owner" },
            { id: "222", username: "friend", name: "Friend" },
          ],
        },
      },
  }, {
      data: {
        id: "111-222",
        participant_ids: ["111", "222"],
        unread: true,
        newest_event_id: "900",
      },
      includes: {
        users: [
          { id: "111", username: "owner", name: "Owner" },
          { id: "222", username: "friend", name: "Friend" },
        ],
      },
  });

  const fakeChat = {
    unlock: async () => undefined,
    free: () => undefined,
    setIdentity: () => undefined,
    setCacheKeys: () => undefined,
    setSigningKeys: () => undefined,
    decryptEvents: (events: string[]) => ({
      messages: [
        {
          event: {
            id: "900",
            sequenceId: "900",
            conversationId: events.includes("request-event") ? "111-333" : "111-222",
            senderId: events.includes("request-event") ? "333" : "222",
            createdAtMsec: "1760313600000",
            type: "message",
            keyVersion: "1",
            content: { contentType: "text", text: "existing" },
          },
          originalB64: "encoded-target",
        },
      ],
      errors: {},
      conversationKeys: { keys: { "1": new Uint8Array([1]) } },
    }),
    encryptMessage: () => payload("send"),
    encryptReply: () => payload("reply"),
    encryptEdit: () => payload("edit"),
    encryptAddReaction: () => payload("react"),
    encryptRemoveReaction: () => payload("unreact"),
    prepareMessageDelete: () => ({
      messageId: "delete-id",
      encodedMessageEventDetail: "delete-detail",
      signature: "delete-signature",
      signatureVersion: "1",
      publicKeyVersion: "1",
      signaturePayload: "delete-payload",
    }),
  } as unknown as ChatWithJuicebox;

  const { store } = await temporaryStore("dmbridge-x-mutations-");
  await store.storeCredential("x", "personal", { configured: true });
  await storeXPasscode(store, "personal", new TextEncoder().encode("2580"));
  const adapter = new XAdapter(
    xCredential({
      grantedScopes: ["users.read", "tweet.read", "dm.read", "dm.write"],
    }),
    "personal",
    store,
    {
      createChat: async (options) => {
        assert.equal(await options.getAuthToken("aa11"), "realm-secret");
        return fakeChat;
      },
    },
  );

  const conversations = await adapter.listConversations(
    listOptions({ limit: 1 }),
  );
  const messageID = conversations.items[0]?.latestMessageID ?? "";
  const malformedMessageID = `xmsg_${Buffer.from(
    JSON.stringify({ version: 1, conversationID: "111-222" }),
  ).toString("base64url")}`;
  await assert.rejects(
    adapter.deleteMessage(malformedMessageID),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "bridge.invalidRequest");
      return true;
    },
  );
  await adapter.sendMessage("111-222", { type: "text", text: "new" });
  await adapter.replyToMessage(messageID, { type: "text", text: "reply" });
  await adapter.editMessage(messageID, { type: "text", text: "edited" });
  await adapter.reactToMessage(messageID, "👍");
  await adapter.unreactToMessage(messageID, "👍");
  await adapter.deleteMessage(messageID);
  await adapter.markMessageRead(messageID);
  await adapter.markMessageUnread(messageID);
  const request = await adapter.getMessageRequest("111-333", true);
  assert.equal(request.state, "received");
  const requestMessages = await adapter.listMessageRequestMessages(
    pageOptions({ conversationID: "111-333" }),
    true,
  );
  assert.equal(requestMessages.items[0]?.conversationID, "111-333");
  assert.equal(requestMessages.hasMoreMessages, true);
  await adapter.acceptMessageRequest("111-333");
  await adapter.declineMessageRequest("111-333");

  const posts = requests
    .filter(({ method }) => method === "POST")
    .map(({ url, init }) => ({
      url,
      body: init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : null,
    }));
  const deletes = requests
    .filter(({ method }) => method === "DELETE")
    .map(({ url, init }) => ({
      url,
      body: init?.body ? String(init.body) : null,
    }));

  assert.equal(posts.length, 9);
  assert.deepEqual(
    posts.slice(0, 5).map((entry) => entry.body),
    ["send", "reply", "edit", "react", "unreact"].map((kind) => ({
      message_id: `${kind}-id`,
      encoded_message_create_event: `${kind}-encrypted`,
      encoded_message_event_signature: `${kind}-signature`,
    })),
  );
  assert.match(posts[5]?.url ?? "", /\/messages\/delete$/);
  assert.deepEqual(posts[5]?.body?.sequence_ids, ["900"]);
  assert.match(posts[6]?.url ?? "", /\/read$/);
  assert.equal(posts[6]?.body, null);
  assert.match(posts[7]?.url ?? "", /\/unread$/);
  assert.equal(posts[7]?.body, null);
  assert.match(posts[8]?.url ?? "", /\/message_requests\/111-333\/accept$/);
  assert.equal(posts[8]?.body, null);
  assert.equal(deletes.length, 1);
  assert.match(deletes[0]?.url ?? "", /\/chat\/conversations\/111-333$/);
  assert.equal(deletes[0]?.body, "{}");
});
