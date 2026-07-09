/**
 * Value validators — the building blocks for defining your database schema
 * in code (Convex-style). Each validator carries both the TypeScript type
 * (via inference) and a JSON description the server enforces at runtime.
 */

export interface ValidatorJSON {
  type: "string" | "number" | "boolean" | "null" | "any" | "id" | "array" | "object";
  optional?: boolean;
  /** For `id` validators: the table the id points at. */
  table?: string;
  /** For `array` validators. */
  element?: ValidatorJSON;
  /** For `object` validators. */
  fields?: Record<string, ValidatorJSON>;
}

export class Validator<T, IsOptional extends boolean = false> {
  declare readonly _type: T;
  declare readonly _optional: IsOptional;
  constructor(readonly json: ValidatorJSON) {}
}

export type Infer<V> = V extends Validator<infer T, boolean> ? T : never;

export type FieldValidators = Record<string, Validator<any, boolean>>;

type OptionalKeys<F extends FieldValidators> = {
  [K in keyof F]: F[K] extends Validator<any, true> ? K : never;
}[keyof F];
type RequiredKeys<F extends FieldValidators> = Exclude<keyof F, OptionalKeys<F>>;

export type ObjectType<F extends FieldValidators> = {
  [K in RequiredKeys<F>]: Infer<F[K]>;
} & {
  [K in OptionalKeys<F>]?: Infer<F[K]>;
};

function fieldsToJSON(fields: FieldValidators): Record<string, ValidatorJSON> {
  return Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.json]));
}

export const v = {
  string: () => new Validator<string>({ type: "string" }),
  number: () => new Validator<number>({ type: "number" }),
  boolean: () => new Validator<boolean>({ type: "boolean" }),
  null: () => new Validator<null>({ type: "null" }),
  any: () => new Validator<any>({ type: "any" }),
  /** A document id in `table`. Represented as a string. */
  id: (table: string) => new Validator<string>({ type: "id", table }),
  array: <V extends Validator<any, boolean>>(element: V) =>
    new Validator<Infer<V>[]>({ type: "array", element: element.json }),
  object: <F extends FieldValidators>(fields: F) =>
    new Validator<ObjectType<F>>({ type: "object", fields: fieldsToJSON(fields) }),
  /** Marks a field as optional (may be absent on insert). */
  optional: <V extends Validator<any, boolean>>(inner: V) =>
    new Validator<Infer<V>, true>({ ...inner.json, optional: true }),
};
