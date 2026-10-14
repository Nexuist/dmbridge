import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getCLIHelp } from "../dist/src/commands.js";
import { schemas, SCHEMA_VERSION } from "../dist/src/protocol.js";

const snapshotDirectory = join(process.cwd(), "test", "snapshots");
await mkdir(snapshotDirectory, { recursive: true });

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
await Promise.all([
  writeFile(
    join(snapshotDirectory, "command-catalog.json"),
    serialize(getCLIHelp().commands),
  ),
  writeFile(
    join(snapshotDirectory, "schemas.json"),
    serialize({ schemaVersion: SCHEMA_VERSION, schemas }),
  ),
]);

process.stdout.write("Updated command and schema contract snapshots.\n");
