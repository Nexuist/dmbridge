import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const workspace = process.cwd();
const mode = process.argv[2];
const packageJSON = JSON.parse(
  await readFile(join(workspace, "package.json"), "utf8"),
);

async function checksum(path) {
  const absolutePath = resolve(path);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) {
    hash.update(chunk);
  }
  const line = `${hash.digest("hex")}  ${basename(absolutePath)}\n`;
  await writeFile(`${absolutePath}.sha256`, line);
  process.stdout.write(line);
}

function runNpm(arguments_, options = {}) {
  return run(npm, arguments_, {
    ...options,
    shell: process.platform === "win32",
  });
}

async function packageNpm() {
  const result = await runNpm(["pack", "--json"], {
    cwd: workspace,
    maxBuffer: 20 * 1024 * 1024,
  });
  const packed = JSON.parse(result.stdout);
  assert.equal(packed.length, 1, "npm pack must produce exactly one archive");
  const archive = resolve(workspace, packed[0].filename);
  await checksum(archive);
  process.stdout.write(`Packaged npm archive: ${archive}\n`);
}

async function packageExecutable() {
  const platform = process.platform === "darwin"
    ? "macos"
    : process.platform === "win32"
      ? "windows"
      : process.platform;
  const architecture = process.arch === "arm64" ? "arm64" : process.arch;
  const executableName =
    `dmbridge-${packageJSON.version}-${platform}-${architecture}` +
    (process.platform === "win32" ? ".exe" : "");
  const artifactsDirectory = join(workspace, "artifacts");
  const destination = resolve(artifactsDirectory, executableName);
  const archive = `${destination}.tar.gz`;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dmbridge-binary-"));
  const temporaryExecutable = join(temporaryDirectory, executableName);

  try {
    await runNpm(["run", "build"], { cwd: workspace });
    await run(
      "deno",
      [
        "compile",
        "--app-name",
        "dmbridge",
        "--node-modules-dir=manual",
        "--self-extracting",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-sys",
        "--include",
        "package.json",
        "--include",
        "node_modules/@xdevplatform/chat-xdk/pkg",
        "--include",
        "node_modules/juicebox-sdk",
        "--exclude",
        "node_modules/@types",
        "--exclude",
        "node_modules/typescript",
        "--exclude",
        "node_modules/undici-types",
        "--exclude",
        "node_modules/.bin",
        "--exclude",
        "node_modules/.package-lock.json",
        "--exclude",
        "node_modules/**/._*",
        "--output",
        temporaryExecutable,
        "dist/src/cli.js",
      ],
      { cwd: workspace, maxBuffer: 20 * 1024 * 1024 },
    );

    const home = join(temporaryDirectory, "home");
    const environment = { ...process.env, DMBRIDGE_HOME: home };
    const version = JSON.parse(
      (await run(temporaryExecutable, ["version", "--no-input"], {
        env: environment,
      })).stdout,
    );
    assert.equal(version.ok, true);
    assert.equal(version.result.version, packageJSON.version);

    const accounts = JSON.parse(
      (await run(
        temporaryExecutable,
        ["accounts", "list", "--no-input"],
        { env: environment },
      )).stdout,
    );
    assert.equal(accounts.ok, true);
    assert.deepEqual(accounts.result.providers, { instagram: [], x: [] });

    const extractedFiles = await readdir(temporaryDirectory, { recursive: true });
    const normalizedExtractedFiles = extractedFiles.map((path) =>
      path.replaceAll("\\", "/"),
    );
    for (const wasm of [
      "node_modules/@xdevplatform/chat-xdk/pkg/chat_xdk_wasm_bg.wasm",
      "node_modules/juicebox-sdk/juicebox-sdk_bg.wasm",
    ]) {
      assert.ok(
        normalizedExtractedFiles.some((path) => path.endsWith(wasm)),
        `standalone executable is missing ${wasm}`,
      );
    }

    await mkdir(artifactsDirectory, { recursive: true });
    await copyFile(temporaryExecutable, destination);
    await chmod(destination, 0o755);
    await run(
      "tar",
      ["-czf", archive, "-C", artifactsDirectory, executableName],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    await checksum(archive);
    process.stdout.write(`Packaged standalone executable: ${archive}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (mode === "npm") {
  await packageNpm();
} else if (mode === "executable") {
  await packageExecutable();
} else {
  process.stderr.write("Usage: node scripts/package.mjs <npm|executable>\n");
  process.exitCode = 2;
}
