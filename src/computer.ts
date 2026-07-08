import { Context, Effect, Layer } from "effect";
import type { InputAction, Observation, Point, Screenshot } from "./schema.js";
import type { ChangliError } from "./errors.js";

export interface Computer {
  readonly observe: Effect.Effect<Observation, ChangliError>;
  readonly screenshot: Effect.Effect<Screenshot, ChangliError>;
  readonly act: (action: InputAction) => Effect.Effect<void, ChangliError>;
  readonly move: (to: Point, durationMs?: number) => Effect.Effect<void, ChangliError>;
  readonly click: (at?: Point) => Effect.Effect<void, ChangliError>;
  readonly type: (text: string) => Effect.Effect<void, ChangliError>;
  readonly key: (key: string, modifiers?: readonly string[]) => Effect.Effect<void, ChangliError>;
}

export class ComputerService extends Context.Tag("changli/Computer")<ComputerService, Computer>() {}

export const makeComputer = (driver: Pick<Computer, "observe" | "screenshot" | "act">): Computer => ({
  ...driver,
  move: (to, durationMs) => driver.act(durationMs === undefined ? { _tag: "Move", to } : { _tag: "Move", to, durationMs }),
  click: (at) => driver.act(at === undefined ? { _tag: "Click" } : { _tag: "Click", at }),
  type: (text) => driver.act({ _tag: "Type", text }),
  key: (key, modifiers) => driver.act(modifiers === undefined ? { _tag: "Key", key } : { _tag: "Key", key, modifiers })
});

export const layer = (computer: Computer): Layer.Layer<ComputerService> =>
  Layer.succeed(ComputerService, computer);

export const observe = Effect.flatMap(ComputerService, (computer) => computer.observe);
export const screenshot = Effect.flatMap(ComputerService, (computer) => computer.screenshot);
export const act = (action: InputAction) => Effect.flatMap(ComputerService, (computer) => computer.act(action));
export const move = (to: Point, durationMs?: number) => act(durationMs === undefined ? { _tag: "Move", to } : { _tag: "Move", to, durationMs });
export const click = (at?: Point) => act(at === undefined ? { _tag: "Click" } : { _tag: "Click", at });
export const type = (text: string) => act({ _tag: "Type", text });
export const key = (keyName: string, modifiers?: readonly string[]) => act(modifiers === undefined ? { _tag: "Key", key: keyName } : { _tag: "Key", key: keyName, modifiers });
