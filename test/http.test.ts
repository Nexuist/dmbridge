import assert from "node:assert/strict";
import test from "node:test";

import { requestJSON } from "../src/providers/http.js";
import { mockFetch } from "./helpers.js";

test("mutation network failures report an unknown outcome and unsafe retry", async (t) => {
  mockFetch(t, async () => {
    throw new Error("connection reset");
  });
  await assert.rejects(
    requestJSON("x", "https://api.x.com/2/chat/example", {
      method: "POST",
      mutation: true,
    }),
    (error: unknown) => {
      const value = error as {
        code?: string;
        retrySafety?: string;
        details?: Record<string, unknown>;
      };
      assert.equal(value.code, "provider.networkFailure");
      assert.equal(value.retrySafety, "unsafe");
      assert.equal(value.details?.outcomeUnknown, true);
      return true;
    },
  );
});

test("mutation timeouts use the timeout exit class and preserve unknown outcome", async (t) => {
  mockFetch(t, async () => {
    throw new DOMException("timed out", "TimeoutError");
  });
  await assert.rejects(
    requestJSON("x", "https://api.x.com/2/chat/example", {
      method: "POST",
      mutation: true,
    }),
    (error: unknown) => {
      const value = error as {
        code?: string;
        exitCode?: number;
        retrySafety?: string;
        details?: Record<string, unknown>;
      };
      assert.equal(value.code, "bridge.timeout");
      assert.equal(value.exitCode, 6);
      assert.equal(value.retrySafety, "unsafe");
      assert.equal(value.details?.outcomeUnknown, true);
      return true;
    },
  );
});
