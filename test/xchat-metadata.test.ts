import assert from "node:assert/strict";
import test from "node:test";

import {
  realmTokensFromJuiceboxConfig,
  XAdapter,
} from "../src/providers/x/index.js";
import {
  listOptions,
  pageOptions,
  mockRoutes,
  temporaryStore,
  xCredential,
} from "./helpers.js";

test("XChat realm tokens are extracted from the X public-key response", () => {
  const tokens = realmTokensFromJuiceboxConfig({
    key_store_token_map_json: JSON.stringify({ realms: [{ id: "AA11" }] }),
    token_map: [
      { key: "AA11", value: { token: "first-secret" } },
      { key: "bb22", value: { token: "second-secret" } },
      { key: "ignored", value: {} },
    ],
  });
  assert.equal(tokens.get("AA11"), "first-secret");
  assert.equal(tokens.get("aa11"), "first-secret");
  assert.equal(tokens.get("bb22"), "second-secret");
  assert.equal(tokens.has("ignored"), false);
});

test("XChat conversation metadata is readable without unlocking", async (t) => {
  const calls = mockRoutes(t, {
    "POST /read": { data: { success: true } },
  }, {
      data: [
        {
          id: "111-222",
          participant_ids: ["111", "222"],
          unread: true,
          newest_event_id: "900",
          last_read_event_id: "899",
          updated_at: "2026-10-13T00:00:00Z",
        },
      ],
      includes: {
        users: [
          { id: "111", username: "owner", name: "Owner" },
          { id: "222", username: "friend", name: "Friend" },
        ],
      },
      meta: { result_count: 1 },
  });

  const { store } = await temporaryStore("dmbridge-x-");
  const adapter = new XAdapter(
    xCredential(),
    "personal",
    store,
  );
  const result = await adapter.listConversations(
    listOptions({ limit: 50 }),
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.protocol, "xchat");
  assert.equal(result.items[0]?.title, "@friend");
  assert.equal(result.items[0]?.unread, true);
  assert.equal(result.items[0]?.unreadCount, null);
  assert.match(result.items[0]?.latestMessageID ?? "", /^xmsg_/);
  const readResult = await adapter.markMessageRead(
    result.items[0]?.latestMessageID ?? "",
  );
  assert.equal(readResult.effect, "conversation");
  assert.equal(calls.at(-1)?.method, "POST");
  assert.match(calls.at(-1)?.url ?? "", /\/2\/chat\/conversations\/111-222\/read$/);
});

test("XChat metadata fixtures cover groups, pagination, requests, and empty pages", async (t) => {
  const calls = mockRoutes(t, {
    "GET /message_requests": {
        data: [{ conversation_id: "111-333", sender_id: "333" }],
        meta: { next_token: "request-page-2" },
      },
    "GET pagination_token=page-2": { data: [], meta: {} },
  }, {
      data: [
        {
          id: "g123",
          member_ids: ["111", "222", "333"],
          unread: false,
          updated_at: "2026-10-13T00:00:00Z",
        },
      ],
      includes: {
        users: [
          { id: "111", username: "owner" },
          { id: "222", username: "two" },
          { id: "333", username: "three" },
        ],
      },
      meta: { next_token: "page-2" },
  });
  const { store } = await temporaryStore("dmbridge-x-pages-");
  const adapter = new XAdapter(
    xCredential(),
    "personal",
    store,
  );
  const first = await adapter.listConversations(
    listOptions({ limit: 1 }),
  );
  assert.equal(first.items[0]?.type, "group");
  assert.equal(first.items[0]?.participants.length, 3);
  assert.equal(first.items[0]?.unreadCount, 0);
  assert.equal(first.nextCursor, "page-2");
  const second = await adapter.listConversations(
    listOptions({ cursor: first.nextCursor, limit: 1 }),
  );
  assert.deepEqual(second, { items: [], nextCursor: null });
  const hidden = await adapter.listMessageRequests(
    pageOptions({ limit: 1, category: "hidden" }),
  );
  assert.equal(hidden.items[0]?.requestID, "111-333");
  assert.equal(hidden.items[0]?.category, "hidden");
  assert.equal(hidden.items[0]?.detailReadMarksDelivered, true);
  assert.equal(new URL(calls.at(-1)?.url ?? "").searchParams.get("inbox_type"), "low_quality");
  await assert.rejects(
    adapter.getMessageRequest("111-333", false),
    /--acknowledge-delivery/,
  );
});
