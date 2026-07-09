/**
 * End-to-end demo against a running chisa server:
 *
 *   cd server && zig build run -- --schema ../examples/todo/chisa.schema.json
 *   npm run demo -w chisa-example-todo
 *
 * Subscribes to open todos, then inserts / patches / deletes and prints
 * every live update the server pushes.
 */
import { ChisaClient } from "@chisa/client";
import type { Schema } from "./schema.js";

const url = process.env.CHISA_URL ?? "ws://127.0.0.1:4700";
const client = new ChisaClient<Schema>({
  url,
  onStatusChange: (s) => console.log(`[status] ${s}`),
  onError: (m) => console.error(`[server error] ${m}`),
});

const openTodos = client
  .query("todos")
  .filter((f) => f.eq("done", false))
  .order("_creationTime", "desc")
  .take(10);

let updates = 0;
const unsubscribe = client.subscribe(openTodos, (docs) => {
  updates += 1;
  console.log(`[update ${updates}] ${docs.length} open todo(s):`);
  for (const d of docs) console.log(`  - ${d._id} ${JSON.stringify(d.text)} done=${d.done}`);
});

const id = await client.insert("todos", { text: "buy milk", done: false, priority: 2 });
console.log(`inserted ${id}`);

await client.insert("todos", { text: "write chisa demo", done: false });
await client.patch("todos", id, { done: true });
console.log(`patched ${id} -> done`);

// Bad mutation: field not in schema -> server rejects, promise rejects.
try {
  await client.insert("todos", { text: "oops", done: false, hacker: "payload" } as never);
} catch (err) {
  console.log(`schema enforcement works: ${(err as Error).message}`);
}

await client.delete("todos", id);
console.log(`deleted ${id}`);

// Give the last update a moment to arrive, then shut down.
await new Promise((r) => setTimeout(r, 300));
unsubscribe();
client.close();
console.log(`done; received ${updates} live update(s)`);
if (updates < 3) {
  console.error("expected at least 3 live updates");
  process.exit(1);
}
