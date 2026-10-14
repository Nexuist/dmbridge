import assert from "node:assert/strict";
import test from "node:test";

import { InstagramAdapter } from "../src/providers/instagram/adapter.js";
import {
  instagramCredential,
  mockRoutes,
} from "./helpers.js";

test("Instagram mark-read and reaction mutations use official message actions", async (t) => {
  const requests = mockRoutes(t, {
    "GET /me?": { user_id: "self", username: "owner" },
    "GET /message-1?": {
        id: "message-1",
        from: { id: "other", username: "sender" },
        conversation: { id: "conversation-1" },
        message: "hello",
      },
    "GET /conversation-1?": {
        id: "conversation-1",
        participants: {
          data: [
            { id: "self", username: "owner" },
            { id: "other", username: "sender" },
          ],
        },
      },
  }, { recipient_id: "other", message_id: "result" });

  const adapter = new InstagramAdapter(instagramCredential(), "personal");
  assert.equal((await adapter.markMessageRead("message-1")).effect, "conversation");
  assert.equal((await adapter.reactToMessage("message-1", "👍")).effect, "exact");
  assert.equal(
    (await adapter.sendMessage("conversation-1", { type: "text", text: "hello" }))
      .effect,
    "sent",
  );
  assert.equal(
    (
      await adapter.sendMessage("conversation-1", {
        type: "image",
        attachments: [{ sourceURL: "https://cdn.example/image.jpg" }],
      })
    ).effect,
    "sent",
  );
  assert.equal(
    (await adapter.replyToMessage("message-1", { type: "text", text: "reply" }))
      .effect,
    "replied",
  );
  assert.equal((await adapter.unreactToMessage("message-1", "👍")).effect, "exact");
  assert.equal(
    (
      await adapter.acceptMessageRequest("conversation-1", {
        type: "text",
        text: "accepted",
      })
    ).effect,
    "accepted_by_reply",
  );
  await assert.rejects(
    adapter.acceptMessageRequest("conversation-1"),
    /--request is required/,
  );
  await assert.rejects(
    adapter.declineMessageRequest("conversation-1"),
    /does not expose a message-request decline/,
  );
  await assert.rejects(adapter.editMessage(), /does not expose message editing/);
  await assert.rejects(adapter.deleteMessage(), /does not expose message deletion/);
  await assert.rejects(adapter.markMessageUnread(), /does not expose mark-unread/);
  await assert.rejects(adapter.reactToMessage("message-1", "  "), /cannot be empty/);

  const posts = requests.filter((request) => request.init?.method === "POST");
  assert.equal(posts.length, 7);
  assert.deepEqual(JSON.parse(String(posts[0]?.init?.body)), {
    recipient: { id: "other" },
    sender_action: "mark_seen",
  });
  assert.deepEqual(JSON.parse(String(posts[1]?.init?.body)), {
    recipient: { id: "other" },
    sender_action: "react",
    payload: { message_id: "message-1", reaction: "👍" },
  });
  assert.deepEqual(JSON.parse(String(posts[2]?.init?.body)), {
    recipient: { id: "other" },
    message: { text: "hello" },
  });
  assert.deepEqual(JSON.parse(String(posts[3]?.init?.body)), {
    recipient: { id: "other" },
    message: {
      attachment: {
        type: "image",
        payload: { url: "https://cdn.example/image.jpg" },
      },
    },
  });
  assert.deepEqual(JSON.parse(String(posts[4]?.init?.body)), {
    recipient: { id: "other" },
    message: { text: "reply" },
    reply_to: { mid: "message-1" },
  });
  assert.deepEqual(JSON.parse(String(posts[5]?.init?.body)), {
    recipient: { id: "other" },
    sender_action: "unreact",
    payload: { message_id: "message-1", reaction: "👍" },
  });
  assert.deepEqual(JSON.parse(String(posts[6]?.init?.body)), {
    recipient: { id: "other" },
    message: { text: "accepted" },
  });
});
