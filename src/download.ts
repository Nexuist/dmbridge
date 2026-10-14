import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, lstat, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { DmbridgeError, invalidRequest } from "./protocol.js";
import { timeoutSignal } from "./runtime.js";

const writeToFileURL = async <T>(
  destinationURL: URL,
  overwrite: boolean,
  write: (temporaryPath: string) => Promise<T>,
) => {
  if (destinationURL.protocol !== "file:") {
    throw invalidRequest("--destination-url must be an absolute file:// URL.");
  }
  const destinationPath = fileURLToPath(destinationURL);
  const parent = await lstat(dirname(destinationPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw invalidRequest("Attachment destination parent must be a real directory.");
  }
  if (!overwrite) {
    try {
      await access(destinationPath);
      throw new DmbridgeError(
        "resource.outputExists",
        `Destination already exists: ${destinationURL.toString()}`,
        { exitCode: 7 },
      );
    } catch (error) {
      if (
        error instanceof DmbridgeError ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }
  const temporaryPath = `${destinationPath}.${randomBytes(10).toString("hex")}.tmp`;
  try {
    const result = await write(temporaryPath);
    await rename(temporaryPath, destinationPath);
    return result;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const downloadToFileURL = async (
  sourceURL: URL,
  destinationURL: URL,
  overwrite: boolean,
) => {
  if (sourceURL.protocol !== "https:") {
    throw invalidRequest("Attachment source must use HTTPS.");
  }
  return writeToFileURL(destinationURL, overwrite, async (temporaryPath) => {
    const response = await fetch(sourceURL, {
      signal: timeoutSignal(120_000),
      redirect: "follow",
    });
    if (!response.ok || !response.body) {
      throw new DmbridgeError(
        "attachment.downloadFailed",
        `Attachment download failed with HTTP ${response.status}.`,
        { retrySafety: "safe", details: { httpStatus: response.status } },
      );
    }
    const digest = createHash("sha256");
    let bytes = 0;
    const observer = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength;
        digest.update(new Uint8Array(chunk));
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as never),
      observer,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
    );
    return {
      destinationURL: destinationURL.toString(),
      mediaType: response.headers.get("content-type"),
      bytes,
      sha256: digest.digest("hex"),
    };
  });
};

export const writeBytesToFileURL = async (
  bytes: Uint8Array,
  destinationURL: URL,
  overwrite: boolean,
  mediaType: string | null,
) =>
  writeToFileURL(destinationURL, overwrite, async (temporaryPath) => {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return {
      destinationURL: destinationURL.toString(),
      mediaType,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
