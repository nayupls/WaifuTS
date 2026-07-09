/**
 * Schema definition: the single source of truth for your database shape.
 * Define it once in code; the client gets full static types and the server
 * enforces the same rules at runtime (export it with `JSON.stringify(schema)`
 * and start the server with `--schema`).
 */

import type { FieldValidators, ObjectType, ValidatorJSON } from "./values.js";

export interface TableJSON {
  fields: Record<string, ValidatorJSON>;
}

export interface SchemaJSON {
  tables: Record<string, TableJSON>;
}

export class TableDefinition<F extends FieldValidators = FieldValidators> {
  constructor(readonly fields: F) {}

  toJSON(): TableJSON {
    return {
      fields: Object.fromEntries(Object.entries(this.fields).map(([k, f]) => [k, f.json])),
    };
  }
}

export function defineTable<F extends FieldValidators>(fields: F): TableDefinition<F> {
  return new TableDefinition(fields);
}

export class SchemaDefinition<
  T extends Record<string, TableDefinition<any>> = Record<string, TableDefinition<any>>,
> {
  constructor(readonly tables: T) {}

  toJSON(): SchemaJSON {
    return {
      tables: Object.fromEntries(Object.entries(this.tables).map(([k, t]) => [k, t.toJSON()])),
    };
  }
}

export function defineSchema<T extends Record<string, TableDefinition<any>>>(
  tables: T,
): SchemaDefinition<T> {
  return new SchemaDefinition(tables);
}

/** Fields the server adds to every document. */
export interface SystemFields {
  _id: string;
  _creationTime: number;
}

export type TableNames<S extends SchemaDefinition<any>> = keyof S["tables"] & string;

/** A full document in table `T`, including system fields. */
export type Doc<S extends SchemaDefinition<any>, T extends TableNames<S>> =
  S["tables"][T] extends TableDefinition<infer F> ? ObjectType<F> & SystemFields : never;

/** The insertable shape of table `T` (no system fields). */
export type NewDoc<S extends SchemaDefinition<any>, T extends TableNames<S>> =
  S["tables"][T] extends TableDefinition<infer F> ? ObjectType<F> : never;
