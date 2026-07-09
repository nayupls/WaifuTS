---
name: chisa
description: Build with or modify the Chisa sync engine (repos/chisa) — schema-in-code database layer, typed injection-proof queries, live-synced clients, Zig server. Use when working on repos/chisa, when an app needs real-time data sync between clients, or when defining/querying a chisa database from TypeScript or React.
---

# Chisa sync engine

Chisa (in `repos/chisa/`) is a sync engine plus a Convex-style database layer:
clients subscribe to typed queries over WebSocket and the server pushes fresh
results after every committed mutation. Full docs live in
`repos/chisa/docs/content/docs/*.mdx` (also served by the Fumadocs site in
`repos/chisa/docs`); protocol details in `protocol.mdx`.

## Layout

- `server/` — Zig 0.16.0, std-lib only. `src/main.zig` (WebSocket protocol,
  subscription fan-out), `src/db.zig` (tables, schema validation, query eval,
  JSONL log), `src/ws.zig` (RFC 6455).
- `packages/client/` — `@chisa/client`, zero runtime deps. Schema DSL,
  query builder, sync client.
- `packages/react/` — `@chisa/react`: `ChisaProvider`, `useQuery`, `useMutation`.
- `examples/todo/` — schema + demo used as the e2e smoke test.

## Using chisa from TypeScript

```ts
import { ChisaClient, defineSchema, defineTable, v } from "@chisa/client";

const schema = defineSchema({
  todos: defineTable({
    text: v.string(),
    done: v.boolean(),
    priority: v.optional(v.number()),
  }),
});

const client = new ChisaClient<typeof schema>({ url: "ws://127.0.0.1:4700" });

const stop = client.subscribe(                     // live query
  client.query("todos").filter((f) => f.eq("done", false))
    .order("_creationTime", "desc").take(20),
  (docs) => {/* re-fires on every change */},
);
const id = await client.insert("todos", { text: "x", done: false });
await client.patch("todos", id, { done: true });   // also: replace, delete
```

Validators: `v.string/number/boolean/null/any`, `v.id(table)`, `v.array(el)`,
`v.object(fields)`, `v.optional(inner)`. Filter ops: `eq neq lt lte gt gte and
or not`. Server adds `_id` and `_creationTime`; clients cannot write them.
Types: `Doc<typeof schema, "todos">`, `NewDoc<...>`.

React: wrap the app in `<ChisaProvider client={client}>`; read with
`useQuery(client.query(...))` (returns `undefined` while loading), write with
`useMutation()` (`insert/patch/replace/remove`).

## Running the server

```bash
# export schema JSON first: writeFileSync("chisa.schema.json", JSON.stringify(schema.toJSON()))
cd repos/chisa/server && zig build run -- --schema ../chisa.schema.json --port 4700 --data chisa.log
```

Requires Zig **0.16.0** (new `std.Io` API — `Io.Mutex`, `Io.net`,
`std.process.Init` main; older Zig will not compile it). Without `--schema`
the server accepts any shape (dev only). Persistence is an append-only JSONL
log replayed at startup. No auth/TLS — localhost or trusted networks only.

## Verifying changes

```bash
cd repos/chisa && npm install && npm run build        # client + react
cd server && zig build test && zig build             # server
# e2e: build example, export schema, start server, run demo
npm run build -w chisa-example-todo && node examples/todo/dist/export-schema.js
./server/zig-out/bin/chisa-server --port 4711 --schema examples/todo/chisa.schema.json --data /tmp/chisa-e2e.log &
CHISA_URL=ws://127.0.0.1:4711 node examples/todo/dist/demo.js   # exits 0 on success
```

The demo asserts live updates arrive, schema violations are rejected
(`UnknownField`), and prints every push. Docs site: `cd docs && npm install &&
npm run build`.

## Invariants to preserve

- No new runtime dependencies in `packages/client`; server stays std-lib only.
- Queries must remain structured ASTs — never introduce string queries.
- Mutations must be validated against the schema and appended to the log
  **before** the client's promise resolves.
- Every committed mutation must notify all live subscriptions on its table.
- Wire protocol changes need matching updates in `server/src/main.zig`,
  `packages/client/src/client.ts`, and `docs/content/docs/protocol.mdx`.
