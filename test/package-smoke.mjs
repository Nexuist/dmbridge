import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const workspace = process.cwd();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "dmbridge-package-"));

try {
  await run(npm, ["run", "build"], { cwd: workspace });
  const packed = await run(
    npm,
    [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporaryDirectory,
    ],
    { cwd: workspace, maxBuffer: 10 * 1024 * 1024 },
  );
  const reports = JSON.parse(packed.stdout);
  assert.equal(reports.length, 1);
  const report = reports[0];
  const paths = report.files.map(({ path }) => path);
  for (const required of [
    "LICENSE",
    "README.md",
    "docs/agent-usage.md",
    "dist/src/cli.js",
    "package.json",
  ]) {
    assert.ok(paths.includes(required), `packed artifact is missing ${required}`);
  }
  assert.ok(!paths.some((path) => path.startsWith("test/")));
  assert.ok(
    !paths.some(
      (path) => path.endsWith(".ts") && !path.endsWith(".d.ts"),
    ),
  );

  const tarball = join(temporaryDirectory, report.filename);
  const installRoot = join(temporaryDirectory, "install");
  await run(
    npm,
    [
      "install",
      "--prefix",
      installRoot,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--prefer-offline",
      tarball,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );

  const executable = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "dmbridge.cmd" : "dmbridge",
  );
  const home = join(temporaryDirectory, "home");
  const environment = { ...process.env, DMBRIDGE_HOME: home };
  const version = JSON.parse(
    (await run(executable, ["version", "--json", "--no-input"], {
      env: environment,
    })).stdout,
  );
  assert.equal(version.ok, true);
  assert.equal(version.result.version, report.version);

  const help = await run(executable, ["help", "--json", "--no-input"], {
    env: environment,
  });
  const envelope = JSON.parse(help.stdout);
  assert.equal(envelope.ok, true);
  assert.ok(envelope.result.commands.length > 1);

  process.stdout.write(
    `Packed and exercised ${report.filename} through its dmbridge executable.\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
