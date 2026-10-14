import assert from "node:assert/strict";
import test from "node:test";

import type { Envelope } from "../../src/protocol.js";
import { readCLIEnvelope } from "../helpers.js";

const enabled = process.env.DMBRIDGE_READONLY_LIVE === "1";

const requireSuccess = <T>(envelope: Envelope<T>, operation: string): T => {
  if (!envelope.ok) {
    assert.fail(`${operation} failed: ${envelope.error.code}`);
  }
  return envelope.result;
};

const exerciseReadOnlySurface = async (provider: "x" | "instagram") => {
  const doctor = requireSuccess<{ readReady: boolean; healthy: boolean }>(
    await readCLIEnvelope([provider, "doctor", "--live"]),
    `${provider} doctor`,
  );
  assert.equal(doctor.healthy, true);
  assert.equal(doctor.readReady, true);
  const conversations = requireSuccess<{
    items: Array<{
      conversationID: string;
      participants: unknown[];
      type: string;
    }>;
    nextCursor: string | null;
  }>(
    await readCLIEnvelope([provider, "conversations", "list", "--limit", "2"]),
    `${provider} conversation list`,
  );
  if (conversations.nextCursor) {
    requireSuccess(
      await readCLIEnvelope([
        provider,
        "conversations",
        "list",
        "--limit",
        "1",
        "--cursor",
        conversations.nextCursor,
      ]),
      `${provider} second conversation page`,
    );
  }
  const first = conversations.items[0];
  if (!first) return;
  assert.ok(["direct", "group", "unknown"].includes(first.type));
  assert.ok(Array.isArray(first.participants));
  requireSuccess(
    await readCLIEnvelope([provider, "conversations", "get", first.conversationID]),
    `${provider} conversation get`,
  );
  requireSuccess(
    await readCLIEnvelope([
      provider,
      "conversations",
      "participants",
      first.conversationID,
    ]),
    `${provider} participant list`,
  );
  const messages = requireSuccess<{
    items: Array<{
      messageID: string;
      attachments: unknown[];
      reactions: unknown[];
      type: string;
    }>;
    nextCursor: string | null;
  }>(
    await readCLIEnvelope([
      provider,
      "messages",
      "list",
      first.conversationID,
      "--limit",
      "2",
    ]),
    `${provider} message list`,
  );
  for (const message of messages.items) {
    assert.ok(message.messageID);
    assert.ok(message.type);
    assert.ok(Array.isArray(message.attachments));
    assert.ok(Array.isArray(message.reactions));
  }
  if (messages.nextCursor) {
    requireSuccess(
      await readCLIEnvelope([
        provider,
        "messages",
        "list",
        first.conversationID,
        "--limit",
        "1",
        "--cursor",
        messages.nextCursor,
      ]),
      `${provider} second message page`,
    );
  }
};

test(
  "default Instagram account passes read-only auth, conversation, and message checks",
  { skip: !enabled },
  async () => {
    const doctor = requireSuccess<{ healthy: boolean; readReady: boolean }>(
      await readCLIEnvelope(["instagram", "doctor", "--live"]),
      "Instagram doctor",
    );
    assert.equal(doctor.healthy, true);
    assert.equal(doctor.readReady, true);
    await exerciseReadOnlySurface("instagram");
  },
);

test(
  "default X account passes read-only XChat auth, conversation, and message checks",
  { skip: !enabled },
  async () => {
    const doctor = requireSuccess<{
      healthy: boolean;
      readReady: boolean;
    }>(
      await readCLIEnvelope(["x", "doctor", "--live"]),
      "X doctor",
    );
    assert.equal(doctor.healthy, true);
    assert.equal(doctor.readReady, true);
    await exerciseReadOnlySurface("x");
  },
);
