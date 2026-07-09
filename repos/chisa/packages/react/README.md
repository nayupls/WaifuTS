# @chisa/react

React bindings for the [chisa sync engine](../../README.md).

- `<ChisaProvider client={client}>` — put a `ChisaClient` in context.
- `useQuery(queryBuilder)` — live, typed query results (`undefined` while loading).
- `useMutation()` — stable `insert` / `patch` / `replace` / `remove` helpers.
- `useChisaClient()` — the raw client.

See the [repo README](../../README.md) for a full walkthrough.
