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
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-24 lg:px-8">
        <div className="max-w-3xl">
          <p className="mb-5 font-mono text-sm font-semibold tracking-[0.2em] text-fd-primary uppercase">
            X + Instagram, with more to come
          </p>
          <h1 className="text-5xl font-black tracking-tight sm:text-7xl">
            Give your agents access to DMs without giving them chaos.
          </h1>
          <p className="mt-7 max-w-2xl text-lg text-fd-muted-foreground sm:text-xl">
            dmbridge is a provider-neutral CLI for reading conversations,
            replying, reacting, and downloading attachments through stable JSON.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full bg-fd-primary px-5 py-3 font-semibold text-fd-primary-foreground"
            >
              Read the docs <ArrowRight className="size-4" />
            </Link>
            <a
              href="https://github.com/Nexuist/dmbridge/releases/latest"
              className="inline-flex items-center gap-2 rounded-full border bg-fd-background px-5 py-3 font-semibold"
            >
              <Download className="size-4" /> Download
            </a>
          </div>
        </div>

        <div className="mt-20 grid gap-4 md:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-2xl border bg-fd-card/85 p-6 backdrop-blur">
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
