/**
 * Structured, typed queries. A query is built with methods and compiled to a
 * plain JSON AST — there is no query string anywhere, so user input can never
 * change the shape of a query (the classic injection failure mode is
 * unrepresentable).
 */

export type ComparisonOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";

export type FilterExpr =
  | { op: ComparisonOp; field: string; value: unknown }
  | { op: "and" | "or"; exprs: FilterExpr[] }
  | { op: "not"; expr: FilterExpr };

export interface QueryAST {
  table: string;
  filter?: FilterExpr;
  order?: { field: string; dir: "asc" | "desc" };
  limit?: number;
}

export class FilterBuilder<D> {
  eq<K extends keyof D & string>(field: K, value: D[K]): FilterExpr {
    return { op: "eq", field, value };
  }
  neq<K extends keyof D & string>(field: K, value: D[K]): FilterExpr {
    return { op: "neq", field, value };
  }
  lt<K extends keyof D & string>(field: K, value: D[K]): FilterExpr {
    return { op: "lt", field, value };
  }
  lte<K extends keyof D & string>(field: K, value: D[K]): FilterExpr {
    return { op: "lte", field, value };
  }
  gt<K extends keyof D & string>(field: K, value: D[K]): FilterExpr {
    return { op: "gt", field, value };
  }
  gte<K extends keyof D & string>(field: K, value: D[K]): FilterExpr {
    return { op: "gte", field, value };
  }
  and(...exprs: FilterExpr[]): FilterExpr {
    return { op: "and", exprs };
  }
  or(...exprs: FilterExpr[]): FilterExpr {
    return { op: "or", exprs };
  }
  not(expr: FilterExpr): FilterExpr {
    return { op: "not", expr };
  }
}

export class QueryBuilder<D> {
  constructor(private readonly ast: QueryAST) {}

  /** Keep only documents matching the filter expression. */
  filter(build: (f: FilterBuilder<D>) => FilterExpr): QueryBuilder<D> {
    return new QueryBuilder({ ...this.ast, filter: build(new FilterBuilder<D>()) });
  }

  /** Sort by a field. */
  order(field: keyof D & string, dir: "asc" | "desc" = "asc"): QueryBuilder<D> {
    return new QueryBuilder({ ...this.ast, order: { field, dir } });
  }

  /** Keep at most `limit` documents (applied after `order`). */
  take(limit: number): QueryBuilder<D> {
    return new QueryBuilder({ ...this.ast, limit });
  }

  toAST(): QueryAST {
    return this.ast;
  }
}

/**
 * Standalone query factory. Prefer `client.query(table)` which infers the
 * document type from your schema.
 */
export function query<D = Record<string, unknown>>(table: string): QueryBuilder<D> {
  return new QueryBuilder<D>({ table });
}
