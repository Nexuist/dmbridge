#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import {
  configureCommandRuntime,
  executeCommand,
  option,
  parseCommand,
} from "./commands.js";
import {
  asDmbridgeError,
  errorEnvelope,
  successEnvelope,
  writeEnvelope,
  type CommandContext,
  type OutputFormat,
} from "./protocol.js";
import { writeDiagnostic } from "./runtime.js";

let outputOptions: { format: OutputFormat; pretty: boolean } = {
  format: "json",
  pretty: false,
};
let context: CommandContext = {
  provider: null,
  account: null,
  requestID: randomUUID(),
  command: process.argv.slice(2).filter((value) => !value.startsWith("--")).join(" "),
};

try {
  const command = parseCommand(process.argv.slice(2));
  context = {
    provider: command.provider,
    account: option(command, "account"),
    requestID: option(command, "request-id") ?? context.requestID,
    command: command.command.join(" "),
  };
  outputOptions = configureCommandRuntime(command);
  writeDiagnostic("verbose", `executing ${context.command}`);
  const executed = await executeCommand(command);
  context = { ...context, account: executed.account };
  writeEnvelope(successEnvelope(context, executed.result), outputOptions);
  writeDiagnostic("verbose", `completed ${context.command}`);
} catch (error) {
  const normalized = asDmbridgeError(error);
  writeEnvelope(errorEnvelope(context, normalized), outputOptions);
  if (!process.argv.includes("--quiet")) {
    writeDiagnostic("error", `${normalized.code}: ${normalized.message}`);
  }
  process.exitCode = normalized.exitCode;
}
