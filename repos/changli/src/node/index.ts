import { Effect, Layer } from "effect";
import { CapabilityUnavailable, ChangliError } from "../errors.js";
import { ComputerService, layer as computerLayer, makeComputer } from "../computer.js";
import type { InputAction, Screenshot } from "../schema.js";
import { exec, run, withTempPng } from "./commands.js";
import { readFile } from "node:fs/promises";

export type NodeDriverOptions = Readonly<{
  screenshotCommand?: "auto" | "screencapture" | "gnome-screenshot" | "import";
  inputCommand?: "auto" | "xdotool" | "cliclick";
}>;

const commandExists = (command: string) =>
  Effect.matchEffect(process.platform === "win32" ? run("where", [command]) : run("sh", ["-c", `command -v ${command}`]), {
    onFailure: () => Effect.succeed(false),
    onSuccess: () => Effect.succeed(true)
  });

const firstAvailable = (names: readonly string[]) =>
  Effect.flatMap(
    Effect.forEach(names, (name) => Effect.map(commandExists(name), (ok) => [name, ok] as const)),
    (results) => {
      const found = results.find(([, ok]) => ok)?.[0];
      return found ? Effect.succeed(found) : Effect.fail(new CapabilityUnavailable(names.join(" | ")));
    }
  );

const captureWith = (command: string): Effect.Effect<Screenshot, ChangliError> =>
  withTempPng(async (file) => {
    if (command === "screencapture") {
      await exec("screencapture", ["-x", file]);
    } else if (command === "gnome-screenshot") {
      await exec("gnome-screenshot", ["-f", file]);
    } else {
      await exec("import", ["-window", "root", file]);
    }
    return new Uint8Array(await readFile(file));
  }).pipe(
    Effect.map((bytes) => ({ bytes, mimeType: "image/png" as const, capturedAt: new Date() }))
  );

const xdotool = (action: InputAction) => {
  switch (action._tag) {
    case "Move": return run("xdotool", ["mousemove", String(action.to.x), String(action.to.y)]);
    case "Click": return action.at
      ? Effect.zipRight(run("xdotool", ["mousemove", String(action.at.x), String(action.at.y)]), run("xdotool", ["click", action.button ?? "1"]))
      : run("xdotool", ["click", action.button ?? "1"]);
    case "Drag": return Effect.zipRight(
      run("xdotool", ["mousemove", String(action.from.x), String(action.from.y), "mousedown", "1"]),
      Effect.zipRight(run("xdotool", ["mousemove", String(action.to.x), String(action.to.y)]), run("xdotool", ["mouseup", "1"]))
    );
    case "Type": return run("xdotool", ["type", "--", action.text]);
    case "Key": return run("xdotool", ["key", [...(action.modifiers ?? []), action.key].join("+")]);
  }
};

const cliclick = (action: InputAction) => {
  switch (action._tag) {
    case "Move": return run("cliclick", [`m:${action.to.x},${action.to.y}`]);
    case "Click": return run("cliclick", [action.at ? `c:${action.at.x},${action.at.y}` : "c:."]);
    case "Drag": return run("cliclick", [`dd:${action.from.x},${action.from.y}`, `du:${action.to.x},${action.to.y}`]);
    case "Type": return run("cliclick", [`t:${action.text}`]);
    case "Key": return run("cliclick", [`kp:${[...(action.modifiers ?? []), action.key].join("-")}`]);
  }
};

export const makeNodeComputer = (options: NodeDriverOptions = {}) => Effect.gen(function* () {
  const screenshotCommand = options.screenshotCommand && options.screenshotCommand !== "auto"
    ? options.screenshotCommand
    : yield* firstAvailable(process.platform === "darwin" ? ["screencapture"] : ["gnome-screenshot", "import"]);
  const inputCommand = options.inputCommand && options.inputCommand !== "auto"
    ? options.inputCommand
    : yield* firstAvailable(process.platform === "darwin" ? ["cliclick"] : ["xdotool"]);

  const screenshot = captureWith(screenshotCommand);
  const act = (action: InputAction) => inputCommand === "cliclick" ? cliclick(action) : xdotool(action);
  return makeComputer({ screenshot, observe: Effect.map(screenshot, (screenshot) => ({ screenshot })), act });
});

export const NodeComputerLive = (options?: NodeDriverOptions): Layer.Layer<ComputerService, ChangliError> =>
  Layer.effect(ComputerService, makeNodeComputer(options));

export const NodeComputerLayer = (options?: NodeDriverOptions) =>
  Effect.map(makeNodeComputer(options), computerLayer);
