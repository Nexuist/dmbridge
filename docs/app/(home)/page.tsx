import { ArrowRight, Bot, Braces, Download, MessageCircle } from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: MessageCircle,
    title: "One inbox interface",
    body: "Read and act on X and Instagram DMs through one predictable command surface.",
  },
  {
    icon: Braces,
    title: "Stable JSON",
    body: "Versioned envelopes and published object schemas make automation less fragile.",
  },
  {
    icon: Bot,
    title: "Built for agents",
    body: "Dry runs, explicit confirmation, retry safety, and clean stdout keep agents honest.",
  },
];

export default function HomePage() {
  return (
    <main className="dmbridge-grid flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-20 lg:px-8 lg:py-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.12fr_0.88fr]">
          <div className="max-w-3xl">
            <p className="tc-kicker mb-6">X + Instagram · more to come</p>
            <h1 className="tc-hero-title text-5xl font-extrabold sm:text-7xl">
              Your agents, finally good at <span>DMs.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-fd-muted-foreground sm:text-xl">
              dmbridge is a provider-neutral CLI for reading conversations,
              replying, reacting, and downloading attachments through stable JSON.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/docs"
                className="tc-primary-button inline-flex items-center gap-2 rounded-full bg-fd-primary px-5 py-3 font-semibold text-fd-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                Read the docs <ArrowRight className="size-4" />
              </Link>
              <a
                href="https://github.com/Nexuist/dmbridge/releases/latest"
                className="tc-secondary-button tc-download-button inline-flex items-center gap-2 rounded-full border px-5 py-3 font-semibold transition-colors"
              >
                <Download className="size-4" /> Download
              </a>
            </div>
          </div>

          <div className="tc-terminal font-mono text-sm">
            <div className="tc-terminal-bar">
              <span className="tc-terminal-dot" />
              <span className="tc-terminal-dot" />
              <span className="tc-terminal-dot" />
              <span className="ml-2 text-xs text-fd-muted-foreground">dmbridge</span>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <p>
                <span className="text-fd-primary">$</span>{" "}
                dmbridge x messages reply x-message-456 "sick meme"
              </p>
              <pre className="overflow-x-auto text-xs leading-6 text-fd-muted-foreground">
{`{
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "result": {
    "confirmed": true,
    "effect": "exact"
  }
}`}
              </pre>
              <div className="flex items-center gap-2 border-t pt-4 text-xs text-fd-muted-foreground">
                <span className="size-2 rounded-full bg-fd-primary shadow-[0_0_12px_var(--tc-green)]" />
                stable JSON · agent ready
              </div>
            </div>
          </div>
        </div>

        <div className="mt-20 grid gap-4 md:grid-cols-3 lg:mt-24">
          {features.map(({ icon: Icon, title, body }) => (
            <article key={title} className="tc-feature-card rounded-3xl border p-6 backdrop-blur">
              <Icon className="mb-5 size-6 text-fd-primary" />
              <h2 className="font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
