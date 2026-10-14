import assert from "node:assert/strict";
import test from "node:test";

import { InstagramAdapter } from "../src/providers/instagram/adapter.js";
import {
  instagramCredential,
  listOptions,
  pageOptions,
  mockRoutes,
} from "./helpers.js";

test("authenticated Instagram account lists and reads conversations without mutations", async (t) => {
  const calls = mockRoutes(
    t,
    {
      "GET /me?": { user_id: "self", username: "owner" },
      "GET /conversation-1/messages?": {
        data: [
          {
            id: "message-1",
            created_time: "2026-10-13T00:00:00Z",
            from: { id: "other", username: "friend" },
            message: "hello",
          },
        ],
      },
      "GET /conversation-1?": {
        id: "conversation-1",
        participants: {
          data: [
            { id: "self", username: "owner" },
            { id: "other", username: "friend" },
          ],
        },
      },
    },
    {
      data: [
        {
          id: "conversation-1",
          updated_time: "2026-10-13T00:00:00Z",
          participants: {
            data: [
              { id: "self", username: "owner" },
              { id: "other", username: "friend" },
            ],
          },
        },
      ],
    },
  );

  const adapter = new InstagramAdapter(instagramCredential(), "personal");
  const conversations = await adapter.listConversations(listOptions());
  assert.equal(conversations.items[0]?.conversationID, "conversation-1");
  const messages = await adapter.listMessages(
    pageOptions({ conversationID: "conversation-1" }),
  );
  assert.equal(messages.items[0]?.messageID, "message-1");
  const messageRequests = await adapter.listMessageRequests(
    pageOptions({ category: "requests" }),
  );
  assert.equal(messageRequests.items[0]?.requestID, "conversation-1");
  assert.equal(messageRequests.items[0]?.category, "requests");
  assert.equal(messageRequests.items[0]?.detailReadMarksDelivered, false);
  assert.equal(new URL(calls.at(-1)?.url ?? "").searchParams.get("folder"), "requests");
  assert.ok(calls.every(({ method }) => method === "GET"));
});
