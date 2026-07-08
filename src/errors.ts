export class ChangliError extends Error {
  readonly _tag: string = "ChangliError";
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ChangliError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class CapabilityUnavailable extends ChangliError {
  override readonly _tag = "CapabilityUnavailable";
  constructor(readonly capability: string, cause?: unknown) {
    super(`Computer capability unavailable: ${capability}`, cause);
    this.name = "CapabilityUnavailable";
  }
}
