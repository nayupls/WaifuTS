/**
 * React bindings for chisa.
 *
 * ```tsx
 * const client = new ChisaClient<typeof schema>({ url: "ws://127.0.0.1:4700" });
 *
 * <ChisaProvider client={client}>
 *   <App />
 * </ChisaProvider>
 *
 * function TodoList() {
 *   const client = useChisaClient<typeof schema>();
 *   const todos = useQuery(client.query("todos").filter(f => f.eq("done", false)));
 *   const { insert, patch, remove } = useMutation<typeof schema>();
 *   // ...
 * }
 * ```
 */

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChisaClient, QueryBuilder, SchemaDefinition } from "@chisa/client";

const ChisaContext = createContext<ChisaClient<any> | null>(null);

export function ChisaProvider(props: {
  client: ChisaClient<any>;
  children?: ReactNode;
}): ReturnType<typeof createElement> {
  return createElement(ChisaContext.Provider, { value: props.client }, props.children);
}

export function useChisaClient<S extends SchemaDefinition<any> = SchemaDefinition<any>>(): ChisaClient<S> {
  const client = useContext(ChisaContext);
  if (!client) {
    throw new Error("chisa: useChisaClient must be used inside a <ChisaProvider>");
  }
  return client as ChisaClient<S>;
}

/**
 * Live query results. Returns `undefined` while the first result set is
 * loading, then re-renders with fresh documents on every relevant mutation.
 */
export function useQuery<D>(qb: QueryBuilder<D>): D[] | undefined {
  const client = useChisaClient();
  const key = JSON.stringify(qb.toAST());
  const [docs, setDocs] = useState<D[] | undefined>(undefined);
  useEffect(() => {
    setDocs(undefined);
    return client.subscribe(qb, setDocs);
    // `key` is the serialized query AST; it fully captures `qb`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return docs;
}

/** Stable, schema-typed mutation helpers bound to the ambient client. */
export function useMutation<S extends SchemaDefinition<any> = SchemaDefinition<any>>() {
  const client = useChisaClient<S>();
  return useMemo(
    () => ({
      insert: client.insert.bind(client),
      patch: client.patch.bind(client),
      replace: client.replace.bind(client),
      remove: client.delete.bind(client),
    }),
    [client],
  );
}
