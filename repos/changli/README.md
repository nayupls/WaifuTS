# Changli

Changli is a fast, extensible TypeScript computer-use framework. It gives agents and tools a small Effect-powered interface for seeing the screen and driving mouse/keyboard input while keeping dependencies intentionally low.

## Goals

- **Programmatically see and use a computer** with screenshot, observe, click, type, key, move, and drag primitives.
- **Effect-first runtime** so integrations can compose capabilities, retries, timeouts, layers, and resource lifecycles cleanly.
- **Pluggable drivers** for local desktops, remote browsers, VMs, sandboxes, or agent runtimes.
- **Low dependency count**: runtime depends only on `effect`; the Node driver shells out to existing OS tools instead of shipping native bindings.
- **Agent-friendly integrations** including a small tool factory for opencode-style tool registries.

## Install

```bash
npm install changli effect
```

## Quick start

```ts
import { Effect } from "effect";
import { click, observe, type } from "changli";
import { NodeComputerLive } from "changli/node";

const program = Effect.gen(function* () {
  const screen = yield* observe;
  console.log(screen.screenshot.mimeType, screen.screenshot.bytes.length);

  yield* click({ x: 120, y: 240 });
  yield* type("Hello from Changli");
});

await Effect.runPromise(program.pipe(Effect.provide(NodeComputerLive())));
```

The built-in Node driver uses:

- macOS: `screencapture` for screenshots and `cliclick` for input.
- Linux: `gnome-screenshot` or ImageMagick `import` for screenshots and `xdotool` for input.

## Write a custom driver

```ts
import { makeComputer } from "changli";

export const computer = makeComputer({
  screenshot: myScreenshotEffect,
  observe: myObserveEffect,
  act: (action) => myInputEffect(action)
});
```

This is the main extension point for browser, VM, remote desktop, or provider-specific backends.

## opencode-style tools

```ts
import { Effect } from "effect";
import { createComputerTools } from "changli/opencode";
import { makeNodeComputer } from "changli/node";

const computer = await Effect.runPromise(makeNodeComputer());
export const tools = createComputerTools(computer);
```

`createComputerTools` returns `observe_computer` and `act_computer` tools with JSON-friendly payloads that can be adapted to opencode or similar agent tool registries.
