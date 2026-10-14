import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const commands = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../test/snapshots/command-catalog.json"),
    "utf8",
  ),
) as string[];

export function CommandCatalog() {
  return (
    <div className="not-prose overflow-hidden rounded-2xl border bg-fd-card">
      <div className="border-b px-5 py-4 text-sm text-fd-muted-foreground">
        Generated from the reviewed command catalog. Run any command with <code>--help</code> for its full options.
      </div>
      <div className="divide-y">
        {commands.map((command) => (
          <div key={command} className="overflow-x-auto px-5 py-3">
            <code className="whitespace-nowrap text-sm">{command}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
