# Chisa

Chisa is a small sync engine: a layer that watches for database changes and pushes
notifications so every connected client stays in sync — plus a Convex-style database
interaction layer where the schema is defined in code and queries are structured
values instead of strings, so they can't be injected into.

```
┌────────────┐   typed queries / mutations    ┌──────────────────┐
│ @chisa/react│──┐                            │   chisa-server   │
└────────────┘  │   WebSocket (JSON proto)    │      (Zig)       │
┌────────────┐  ├───────────────────────────▶│  schema check    │
│@chisa/client│──┘        live updates        │  query engine    │
└────────────┘ ◀────────────────────────────  │  JSONL log       │
                                              └──────────────────┘
```

## Pieces

| Directory          | What it is                                                             | Runtime deps |
| ------------------ | ---------------------------------------------------------------------- | ------------ |
| `server/`          | Sync server in Zig 0.16. WebSocket, schema validation, query engine, append-only JSONL persistence. | Zig std only |
| `packages/client/` | TypeScript client: schema DSL, typed query builder, live subscriptions, mutations, auto-reconnect. | none         |
| `packages/react/`  | React binding: `ChisaProvider`, `useQuery`, `useMutation`.              | `@chisa/client` (peer: `react`) |
| `examples/todo/`   | Schema + demo scripts used by the end-to-end smoke test.                | —            |

## How syncing works

1. A client subscribes to a query (`{"type":"subscribe","id":"s1","query":{...}}`).
2. The server runs the query and pushes the result set (`{"type":"data",...}`).
3. Every committed mutation bumps a global version, is appended to the JSONL log,
   and re-runs all live queries on the affected table. Fresh results are pushed to
   every subscriber — that push is the change notification that keeps things in sync.
4. On reconnect the client automatically re-subscribes everything.

## Define your database in code

```ts
// schema.ts
import { defineSchema, defineTable, v } from "@chisa/client";

export default defineSchema({
  todos: defineTable({
    text: v.string(),
    done: v.boolean(),
    priority: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  }),
});
```

Export it for the server (one-liner, see `examples/todo/src/export-schema.ts`):

```ts
writeFileSync("chisa.schema.json", JSON.stringify(schema.toJSON(), null, 2));
```

## Run the server

```bash
cd server
zig build run -- --schema ../examples/todo/chisa.schema.json --port 4700 --data chisa.log
```

Without `--schema` the server runs schemaless (any shape accepted) — fine for
prototyping, not for production.

## Use the synced client

```ts
import { ChisaClient } from "@chisa/client";
import type schema from "./schema.js";

const client = new ChisaClient<typeof schema>({ url: "ws://127.0.0.1:4700" });

// Live query: the callback re-fires on every relevant change.
const stop = client.subscribe(
  client.query("todos").filter((f) => f.eq("done", false)).order("_creationTime", "desc").take(10),
  (docs) => render(docs), // docs is fully typed
);

const id = await client.insert("todos", { text: "buy milk", done: false });
await client.patch("todos", id, { done: true });
await client.delete("todos", id);
```

## React

```tsx
import { ChisaProvider, useQuery, useMutation, useChisaClient } from "@chisa/react";

<ChisaProvider client={client}>
  <TodoList />
</ChisaProvider>;

function TodoList() {
  const client = useChisaClient<typeof schema>();
  const todos = useQuery(client.query("todos").filter((f) => f.eq("done", false)));
  const { insert, patch, remove } = useMutation<typeof schema>();

  if (todos === undefined) return <p>loading…</p>;
  return (
    <ul>
      {todos.map((t) => (
        <li key={t._id} onClick={() => patch("todos", t._id, { done: true })}>
          {t.text}
        </li>
      ))}
    </ul>
  );
}
```

## Why you can't get pwned by a query

There is no query language. A query is a JSON tree built by the typed
`QueryBuilder` (`{"table":"todos","filter":{"op":"eq","field":"done","value":false}}`)
and evaluated structurally by the server. User input only ever appears as a
*value* inside that tree — it can never become an operator, a field name outside
the schema, or another table. On top of that the server validates every mutation
against the schema: unknown tables, unknown fields, and wrong types are rejected
before touching data (`UnknownField`, `TypeMismatch`, ...).

## Dependency posture

Deliberately lean: the server is Zig standard library only; `@chisa/client` has
zero runtime dependencies; `@chisa/react` depends only on `@chisa/client` with
`react` as a peer. Dev-time it's just `typescript` (+ `@types/*`).

## Current limitations (v0.1)

- The whole result set of a live query is re-sent on change (no diffs yet).
- The append-only log is never compacted; deleted document memory is reclaimed
  on restart, not at runtime.
- Single process, plaintext WebSocket, no auth — run it on localhost or behind
  something that terminates TLS and authenticates, and treat clients as trusted.
- `order` sorts on a single top-level field; filters reference top-level fields.

## Development

```bash
npm install            # workspace root (repos/chisa)
npm run build          # builds @chisa/client and @chisa/react
cd server && zig build test && zig build
```

End-to-end smoke test:

```bash
npm run build -w chisa-example-todo
node examples/todo/dist/export-schema.js
cd server && zig build run -- --schema ../chisa.schema.json &
npm run demo -w chisa-example-todo
```
