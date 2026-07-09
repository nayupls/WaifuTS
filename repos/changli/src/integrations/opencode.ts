import { Effect } from "effect";
import type { Computer } from "../computer.js";
import type { InputAction } from "../schema.js";

export type ComputerToolResult = Readonly<{ content: readonly [{ type: "text"; text: string }] }>;
export type ComputerTool = Readonly<{
  description: string;
  parameters: unknown;
  execute: (input: unknown) => Promise<ComputerToolResult>;
}>;

const ok = (text: string): ComputerToolResult => ({ content: [{ type: "text", text }] });

export const createComputerTools = (computer: Computer) => ({
  observe_computer: {
    description: "Capture the current computer screen as base64 PNG data.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const observation = await Effect.runPromise(computer.observe);
      return ok(JSON.stringify({
        mimeType: observation.screenshot.mimeType,
        capturedAt: observation.screenshot.capturedAt.toISOString(),
        imageBase64: Buffer.from(observation.screenshot.bytes).toString("base64")
      }));
    }
  },
  act_computer: {
    description: "Perform a computer input action such as move, click, type, key, or drag.",
    parameters: {
      type: "object",
      required: ["_tag"],
      additionalProperties: true,
      properties: { _tag: { enum: ["Move", "Click", "Drag", "Type", "Key"] } }
    },
    execute: async (input: unknown) => {
      await Effect.runPromise(computer.act(input as InputAction));
      return ok("done");
    }
  }
} satisfies Record<string, ComputerTool>);
