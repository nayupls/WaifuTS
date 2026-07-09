import { Effect } from "effect";
import { observe } from "changli";
import { NodeComputerLive } from "changli/node";

const program = Effect.gen(function* () {
  const view = yield* observe;
  console.log(`Captured ${view.screenshot.bytes.byteLength} bytes`);
});

Effect.runPromise(program.pipe(Effect.provide(NodeComputerLive())));
