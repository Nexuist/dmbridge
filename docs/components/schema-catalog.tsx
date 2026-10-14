import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type JSONSchema = {
  $ref?: string;
  anyOf?: JSONSchema[];
  description?: string;
  enum?: unknown[];
  format?: string;
  items?: JSONSchema;
  oneOf?: JSONSchema[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  type?: string | string[];
};

type SchemaSnapshot = {
  schemaVersion: number;
  schemas: Record<string, JSONSchema>;
};

const snapshot = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../test/snapshots/schemas.json"),
    "utf8",
  ),
) as SchemaSnapshot;

const schemaAnchor = (name: string) =>
  `schema-${name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;

const referenceName = (reference: string) =>
  reference.slice(reference.lastIndexOf("/") + 1).replace(/\.json$/, "");

const describeType = (schema: JSONSchema): string => {
  if (schema.$ref) return referenceName(schema.$ref);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(describeType).join(" | ");
  if (schema.oneOf) return schema.oneOf.map(describeType).join(" | ");
  if (schema.type === "array") {
    return `array<${schema.items ? describeType(schema.items) : "unknown"}>`;
  }
  const type = Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  return schema.format ? `${type ?? "string"} (${schema.format})` : (type ?? "unknown");
};

export function SchemaCatalog({ names }: { names?: string[] }) {
  const selected = names ?? Object.keys(snapshot.schemas);

  return (
    <div className="not-prose space-y-7">
      <div className="rounded-xl border bg-fd-card p-4 text-sm text-fd-muted-foreground">
        Contract schema version <strong className="text-fd-foreground">{snapshot.schemaVersion}</strong>.
        This page is rendered directly from <code>test/snapshots/schemas.json</code>.
      </div>

      {selected.map((name) => {
        const schema = snapshot.schemas[name];
        if (!schema) {
          throw new Error(`Unknown documented schema: ${name}`);
        }
        const required = new Set(schema.required ?? []);
        const properties = Object.entries(schema.properties ?? {});

        return (
          <section
            key={name}
            id={schemaAnchor(name)}
            className="scroll-m-24 overflow-hidden rounded-2xl border bg-fd-card"
          >
            <div className="border-b px-5 py-4">
              <h2 className="font-mono text-lg font-bold">{name}</h2>
              {schema.description ? (
                <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">
                  {schema.description}
                </p>
              ) : null}
            </div>

            {properties.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-fd-muted/45 text-xs tracking-wide text-fd-muted-foreground uppercase">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Property</th>
                      <th className="px-5 py-3 font-semibold">Type</th>
                      <th className="px-5 py-3 font-semibold">Required</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {properties.map(([property, definition]) => (
                      <tr key={property}>
                        <td className="px-5 py-3 align-top font-mono font-medium">{property}</td>
                        <td className="px-5 py-3 align-top font-mono text-xs text-fd-muted-foreground">
                          {describeType(definition)}
                        </td>
                        <td className="px-5 py-3 align-top">
                          {required.has(property) ? "yes" : "no"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-4 font-mono text-sm text-fd-muted-foreground">
                {describeType(schema)}
              </p>
            )}

            <details className="border-t">
              <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
                JSON Schema
              </summary>
              <pre className="max-h-[36rem] overflow-auto border-t bg-fd-secondary/45 p-5 text-xs leading-5">
                {JSON.stringify(schema, null, 2)}
              </pre>
            </details>
          </section>
        );
      })}
    </div>
  );
}
