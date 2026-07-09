# @chisa/client

Type-safe client for the [chisa sync engine](../../README.md). Zero runtime
dependencies.

- `defineSchema` / `defineTable` / `v` — define your database in code; export
  the JSON for the server with `schema.toJSON()`.
- `client.query(table)` — typed query builder that compiles to a structured
  AST (no query strings, no injection surface).
- `client.subscribe(query, cb)` — live results pushed on every relevant change.
- `insert` / `patch` / `replace` / `delete` — schema-validated mutations.
- Automatic reconnect with re-subscription.

See the [repo README](../../README.md) for a full walkthrough.
