import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";

const commands = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../test/snapshots/command-catalog.json"),
    "utf8",
  ),
) as string[];

const groups = [
  {
    title: "Help and version",
    match: (command: string) => /dmbridge (help|version)$/.test(command),
  },
  {
    title: "Accounts",
    match: (command: string) => command.startsWith("dmbridge accounts "),
  },
  {
    title: "Doctor and schemas",
    match: (command: string) => command.includes(" doctor "),
  },
  {
    title: "Conversations",
    match: (command: string) =>
      command.includes(" conversations ") && !command.includes(" requests "),
  },
  {
    title: "Conversation requests",
    match: (command: string) => command.includes(" conversations requests "),
  },
  {
    title: "Messages",
    match: (command: string) =>
      command.includes(" messages ") && !command.includes(" requests "),
  },
  {
    title: "Reactions",
    match: (command: string) => command.includes(" reactions "),
  },
  {
    title: "Attachments",
    match: (command: string) => command.includes(" attachments "),
  },
] as const;

export function CommandCatalog() {
  return (
    <div className="not-prose space-y-4">
      <div className="rounded-xl border bg-fd-card px-5 py-4 text-sm text-fd-muted-foreground">
        Generated from the reviewed command catalog. Run any command with <code>--help</code> for its full options.
      </div>
      <Accordions multiple>
        {groups.map((group) => {
          const groupedCommands = commands.filter(group.match);
          return (
            <Accordion
              key={group.title}
              title={`${group.title} (${groupedCommands.length})`}
              value={group.title}
            >
              <div className="divide-y border-t">
                {groupedCommands.map((command) => (
                  <div key={command} className="overflow-x-auto py-3">
                    <code className="whitespace-nowrap text-sm">{command}</code>
                  </div>
                ))}
              </div>
            </Accordion>
          );
        })}
      </Accordions>
    </div>
  );
}
