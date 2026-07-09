export type Point = Readonly<{ x: number; y: number }>;
export type Size = Readonly<{ width: number; height: number }>;
export type Rect = Point & Size;

export type Button = "left" | "middle" | "right";

export type Screenshot = Readonly<{
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  size?: Size;
  capturedAt: Date;
}>;

export type InputAction =
  | Readonly<{ _tag: "Move"; to: Point; durationMs?: number }>
  | Readonly<{ _tag: "Click"; at?: Point; button?: Button; count?: number }>
  | Readonly<{ _tag: "Drag"; from: Point; to: Point; durationMs?: number }>
  | Readonly<{ _tag: "Type"; text: string }>
  | Readonly<{ _tag: "Key"; key: string; modifiers?: readonly string[] }>;

export type Observation = Readonly<{
  screenshot: Screenshot;
  cursor?: Point;
  display?: Rect;
}>;
