import { Effect } from "effect";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ChangliError } from "../errors.js";

export const execFileP = promisify(execFile);

export const exec = (command: string, args: readonly string[] = []) =>
  execFileP(command, [...args], { timeout: 10_000, maxBuffer: 20 * 1024 * 1024 });

export const run = (command: string, args: readonly string[] = []) =>
  Effect.tryPromise({
    try: async () => exec(command, args),
    catch: (cause) => new ChangliError(`Command failed: ${command} ${args.join(" ")}`, cause)
  });

export const withTempPng = <A>(use: (file: string) => Promise<A>) =>
  Effect.tryPromise({
    try: async () => {
      const dir = await mkdtemp(join(tmpdir(), "changli-"));
      try {
        return await use(join(dir, "screenshot.png"));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    catch: (cause) => new ChangliError("Temporary screenshot file failed", cause)
  });

export const readBytes = (file: string) =>
  Effect.tryPromise({
    try: async () => new Uint8Array(await readFile(file)),
    catch: (cause) => new ChangliError(`Unable to read ${file}`, cause)
  });
