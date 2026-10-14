import { createInterface } from "node:readline/promises";

import { DmbridgeError, invalidRequest } from "./protocol.js";

export type Verbosity = "quiet" | "normal" | "verbose" | "debug";

type RuntimeOptions = {
  timeoutMs: number | null;
  verbosity: Verbosity;
  nonInteractive: boolean;
};

const runtime: RuntimeOptions = {
  timeoutMs: null,
  verbosity: "normal",
  nonInteractive: false,
};

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m)$/;

export const parseDurationMs = (value: string) => {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw invalidRequest(
      "--timeout must include an explicit unit: ms, s, or m (for example, 30s).",
    );
  }
  const amount = Number(match[1]);
  const multiplier = match[2] === "m" ? 60_000 : match[2] === "s" ? 1_000 : 1;
  const milliseconds = amount * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 600_000) {
    throw invalidRequest("--timeout must be from 1ms through 10m.");
  }
  return milliseconds;
};

export const configureRuntime = (options: Partial<RuntimeOptions>) => {
  Object.assign(runtime, options);
};

export const timeoutSignal = (fallbackMs: number) =>
  AbortSignal.timeout(runtime.timeoutMs ?? fallbackMs);

export const isTimeoutError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

export const timeoutError = (
  operation = "Operation",
  mutation = false,
) =>
  new DmbridgeError("bridge.timeout", `${operation} exceeded the configured timeout.`, {
    retrySafety: mutation ? "unsafe" : "safe",
    details: {
      timeoutMs: runtime.timeoutMs,
      outcomeUnknown: mutation,
    },
    exitCode: 6,
  });

const levels: Record<Exclude<Verbosity, "quiet"> | "warning" | "error", number> = {
  normal: 0,
  warning: 0,
  error: 0,
  verbose: 1,
  debug: 2,
};

export const writeDiagnostic = (
  level: "warning" | "error" | "verbose" | "debug",
  message: string,
) => {
  if (runtime.verbosity === "quiet") return;
  const configured = levels[runtime.verbosity];
  if (levels[level] > configured) return;
  process.stderr.write(`${level}: ${message}\n`);
};

export const confirmationRequired = (message: string) =>
  new DmbridgeError("bridge.confirmationRequired", message, {
    details: { authorizationFlag: "--yes" },
    exitCode: 8,
  });

export const confirmDestructive = async (
  authorized: boolean,
  prompt: string,
) => {
  if (authorized) return;
  if (runtime.nonInteractive || !process.stdin.isTTY || !process.stderr.isTTY) {
    throw confirmationRequired(
      `${prompt} Re-run with --yes to authorize this destructive operation.`,
    );
  }
  const terminal = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  try {
    const answer = await terminal.question(`${prompt} Type yes to continue: `);
    if (answer.trim().toLowerCase() !== "yes") {
      throw confirmationRequired("Operation was not confirmed.");
    }
  } finally {
    terminal.close();
  }
};
