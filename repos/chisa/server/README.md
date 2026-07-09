# chisa-server

The sync server. Zig **0.16.0**, standard library only.

```bash
zig build            # -> zig-out/bin/chisa-server
zig build test       # unit tests (query eval, schema matching)
zig build run -- --schema ../examples/todo/chisa.schema.json
```

Flags: `--host` (default `127.0.0.1`), `--port` (default `4700`),
`--data` (JSONL log, default `chisa.log`), `--schema` (schema JSON exported by
`@chisa/client`; omit to run schemaless).

Source layout:

- `src/main.zig` — WebSocket protocol, connection threads, subscription fan-out.
- `src/db.zig` — tables, schema validation, structured query evaluation, JSONL log.
- `src/ws.zig` — minimal RFC 6455 implementation.
