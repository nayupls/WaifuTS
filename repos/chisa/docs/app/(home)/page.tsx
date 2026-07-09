import Link from 'next/link';
import {
  ArrowRight,
  Atom,
  Database,
  Feather,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';

const snippet = `import { ChisaClient } from "@chisa/client";
import schema from "./schema.js";

const client = new ChisaClient<typeof schema>({
  url: "ws://127.0.0.1:4700",
});

// Live query: re-fires on every relevant change,
// from this client or any other.
client.subscribe(
  client.query("todos").filter((f) => f.eq("done", false)),
  (docs) => render(docs), // fully typed
);

await client.insert("todos", { text: "buy milk", done: false });`;

const features = [
  {
    icon: RefreshCw,
    title: 'Real-time sync',
    body: 'Subscribe to a query and get fresh results pushed on every change. No polling, no cache invalidation, no stale UI.',
  },
  {
    icon: Database,
    title: 'Schema in code',
    body: 'One defineSchema call gives you full static types on the client and runtime enforcement on the server.',
  },
  {
    icon: ShieldCheck,
    title: 'Injection-proof queries',
    body: 'Queries are structured JSON trees, never strings. User input can only ever be a value — there is no parser to escape.',
  },
  {
    icon: Zap,
    title: 'Zig server',
    body: 'A single static binary built from the standard library alone. WebSocket, query engine and durable JSONL log in ~1000 lines.',
  },
  {
    icon: Atom,
    title: 'React bindings',
    body: 'ChisaProvider, useQuery and useMutation. Components re-render automatically when the data they read changes.',
  },
  {
    icon: Feather,
    title: 'Lean by design',
    body: 'Zero runtime dependencies in the client. The React package depends only on the client. Nothing else comes along.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-6 pb-16 pt-20 text-center">
        <span className="rounded-full border border-fd-border bg-fd-muted px-3 py-1 text-xs font-medium text-fd-muted-foreground">
          Zig server · TypeScript client · React bindings
        </span>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Your database, live on every client
        </h1>
        <p className="max-w-2xl text-balance text-lg text-fd-muted-foreground">
          Chisa is a small sync engine with a Convex-style data layer: define
          your database in code, query it with typed, injection-proof builders,
          and let the server push every change to every subscriber.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/quickstart"
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-muted"
          >
            Read the docs
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6">
        <pre className="overflow-x-auto rounded-xl border border-fd-border bg-fd-card p-5 text-left text-sm leading-relaxed shadow-sm">
          <code>{snippet}</code>
        </pre>
      </section>

      <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-6 py-16 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-fd-border bg-fd-card p-5 text-left"
          >
            <f.icon className="mb-3 size-5 text-fd-primary" />
            <h2 className="mb-1 font-semibold">{f.title}</h2>
            <p className="text-sm text-fd-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-24 text-center">
        <p className="text-sm text-fd-muted-foreground">
          Curious how it stays in sync?{' '}
          <Link href="/docs" className="font-medium text-fd-primary underline">
            Start with the introduction
          </Link>{' '}
          or jump straight to the{' '}
          <Link
            href="/docs/protocol"
            className="font-medium text-fd-primary underline"
          >
            wire protocol
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
