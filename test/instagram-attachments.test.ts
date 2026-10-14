import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { InstagramAdapter } from "../src/providers/instagram/adapter.js";
import {
  instagramCredential,
  listOptions,
  pageOptions,
  mockRoutes,
} from "./helpers.js";

test("Instagram attachment fixtures preserve media, shares, stories, unknown types, and pagination", async (t) => {
  mockRoutes(
    t,
    {
      "GET https://cdn.example/image.jpg": new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
      "GET /me?": { user_id: "self", username: "owner" },
      "GET /conversation-1/messages?": {
        data: [
          {
            id: "media-message",
            from: { id: "other", username: "friend" },
            attachments: {
              data: [
                { image_data: { url: "https://cdn.example/image.jpg" }, mime_type: "image/jpeg" },
                { video_data: { url: "https://cdn.example/video.mp4" }, mime_type: "video/mp4" },
                { audio_data: { url: "https://cdn.example/audio.m4a" }, mime_type: "audio/mp4" },
                { file_url: "https://cdn.example/file.pdf", filename: "file.pdf" },
              ],
            },
            shares: { data: [{ id: "post-1", link: "https://instagram.com/p/example" }] },
            story: { id: "story-1", link: "https://instagram.com/stories/example" },
          },
          {
            id: "unsupported-message",
            from: { id: "other" },
            is_unsupported: true,
            type: "future_payload",
          },
        ],
        paging: {
          cursors: { after: "next-page" },
          next: "https://graph.instagram.com/next",
        },
      },
    },
    {
      id: "conversation-1",
      participants: {
        data: [
          { id: "self", username: "owner" },
          { id: "other", username: "friend" },
        ],
      },
    },
  );
  const adapter = new InstagramAdapter(instagramCredential(), "personal");
  const result = await adapter.listMessages(
    pageOptions({ conversationID: "conversation-1" }),
  );
  assert.equal(result.nextCursor, "next-page");
  assert.deepEqual(
    result.items[0]?.attachments.map((attachment) => attachment.type),
    ["image", "video", "audio", "file", "sharedPost", "sharedStory"],
  );
  assert.equal(result.items[1]?.type, "unsupported");
  assert.equal(result.items[1]?.providerType, "future_payload");

  const image = result.items[0]?.attachments[0];
  assert.ok(image);
  const directory = await mkdtemp(join(tmpdir(), "dmbridge-instagram-download-"));
  const destination = pathToFileURL(join(directory, "image.jpg"));
  const downloaded = await adapter.downloadAttachment(
    image.attachmentID,
    destination,
    false,
  );
  assert.equal(downloaded.bytes, 4);
  assert.deepEqual(await readFile(destination), Buffer.from([1, 2, 3, 4]));
});

test("Instagram conversation fixtures cover groups, pagination, and an empty page", async (t) => {
  let page = 0;
  mockRoutes(t, { "GET /me?": { user_id: "self" } }, () => {
    page += 1;
    if (page === 1) {
      return {
        data: [
          {
            id: "group-1",
            name: "Project group",
            participants: {
              data: [{ id: "self" }, { id: "two" }, { id: "three" }],
            },
          },
        ],
        paging: { cursors: { after: "page-2" }, next: "https://graph.instagram.com/next" },
      };
    }
    return { data: [], paging: {} };
  });
  const adapter = new InstagramAdapter(
    instagramCredential(),
    "personal",
  );
  const first = await adapter.listConversations(listOptions({ limit: 1 }));
  assert.equal(first.items[0]?.type, "group");
  assert.equal(first.items[0]?.title, "Project group");
  assert.equal(first.nextCursor, "page-2");
  const second = await adapter.listConversations(
    listOptions({ cursor: first.nextCursor, limit: 1 }),
  );
  assert.deepEqual(second, { items: [], nextCursor: null });
});
