/**
 * ChisaClient: WebSocket sync client.
 *
 * - `subscribe(query, cb)` keeps `cb` fed with fresh results every time a
 *   mutation touches the queried table (that's the sync engine part).
 * - Mutations (`insert` / `patch` / `replace` / `delete`) resolve when the
 *   server has validated, applied and persisted them.
 * - Reconnects automatically with jittered exponential backoff and
 *   re-establishes all live subscriptions.
 *
 * Works in browsers and Node >= 20 (both have a global WebSocket); other
 * environments can inject an implementation via `options.webSocket`.
 */

import { query, type QueryBuilder } from "./query.js";
import type { Doc, NewDoc, SchemaDefinition, TableNames } from "./schema.js";

// Minimal structural types so this package needs neither the DOM nor the
// Node type libraries at build time.
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;
declare function setTimeout(cb: () => void, ms: number): unknown;

const WS_OPEN = 1;

export type ConnectionStatus = "connecting" | "connected" | "closed";

export interface ChisaClientOptions {
  /** e.g. "ws://127.0.0.1:4700" */
  url: string;
  /** Defaults to globalThis.WebSocket. */
  webSocket?: WebSocketCtor;
  /** Reconnect on disconnect (default true). */
  reconnect?: boolean;
  /** Cap for reconnect backoff (default 10_000). */
  maxBackoffMs?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
  /** Called for server-reported protocol errors. */
  onError?: (message: string) => void;
}

type ServerMessage =
  | { type: "hello"; version: number }
  | { type: "data"; id: string; version: number; docs: unknown[] }
  | { type: "result"; id: string; ok: true; docId?: string }
  | { type: "result"; id: string; ok: false; error: string }
  | { type: "error"; message: string }
  | { type: "pong" };

interface Subscription {
  id: string;
  ast: unknown;
  cb: (docs: any[]) => void;
}

interface PendingMutation {
  payload: string;
  sent: boolean;
  resolve: (docId: string | undefined) => void;
  reject: (err: Error) => void;
}

export class ChisaClient<S extends SchemaDefinition<any> = SchemaDefinition<any>> {
  private ws: WebSocketLike | null = null;
  private readonly subs = new Map<string, Subscription>();
  private readonly pending = new Map<string, PendingMutation>();
  private nextId = 1;
  private closedByUser = false;
  private backoffMs = 500;
  private status: ConnectionStatus = "connecting";

  constructor(private readonly opts: ChisaClientOptions) {
    this.connect();
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** Starts a typed query against a table from your schema. */
  query<T extends TableNames<S>>(table: T): QueryBuilder<Doc<S, T>> {
    return query<Doc<S, T>>(table);
  }

  /**
   * Subscribes to live results of a query. The callback fires with the
   * initial result set and again after every mutation that touches the
   * table. Returns an unsubscribe function.
   */
  subscribe<D>(q: QueryBuilder<D>, cb: (docs: D[]) => void): () => void {
    const id = `s${this.nextId++}`;
    this.subs.set(id, { id, ast: q.toAST(), cb: cb as (docs: any[]) => void });
    this.send({ type: "subscribe", id, query: q.toAST() });
    return () => {
      this.subs.delete(id);
      this.send({ type: "unsubscribe", id });
    };
  }

  /** Inserts a document; resolves with its server-assigned id. */
  async insert<T extends TableNames<S>>(table: T, value: NewDoc<S, T>): Promise<string> {
    const docId = await this.mutate({ op: "insert", table, value });
    return docId as string;
  }

  /** Shallow-merges `fields` into an existing document. */
  async patch<T extends TableNames<S>>(
    table: T,
    id: string,
    fields: Partial<NewDoc<S, T>>,
  ): Promise<void> {
    await this.mutate({ op: "patch", table, id, fields });
  }

  /** Replaces a document's fields entirely (system fields are preserved). */
  async replace<T extends TableNames<S>>(table: T, id: string, value: NewDoc<S, T>): Promise<void> {
    await this.mutate({ op: "replace", table, id, value });
  }

  async delete<T extends TableNames<S>>(table: T, id: string): Promise<void> {
    await this.mutate({ op: "delete", table, id });
  }

  /** Closes the connection permanently (no reconnect). */
  close(): void {
    this.closedByUser = true;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    for (const [id, m] of [...this.pending]) {
      m.reject(new Error("chisa: client closed"));
      this.pending.delete(id);
    }
    this.setStatus("closed");
  }

  private webSocketCtor(): WebSocketCtor {
    const ctor = this.opts.webSocket ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!ctor) {
      throw new Error("chisa: no global WebSocket available; pass options.webSocket");
    }
    return ctor;
  }

  private connect(): void {
    if (this.closedByUser) return;
    this.setStatus("connecting");
    const Ctor = this.webSocketCtor();
    const ws = new Ctor(this.opts.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoffMs = 500;
      this.setStatus("connected");
      for (const sub of this.subs.values()) {
        ws.send(JSON.stringify({ type: "subscribe", id: sub.id, query: sub.ast }));
      }
      for (const m of this.pending.values()) {
        if (!m.sent) {
          ws.send(m.payload);
          m.sent = true;
        }
      }
    };
    ws.onmessage = (ev) => this.handleMessage(String(ev.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.handleDisconnect();
    };
    ws.onerror = () => {
      // The close event that follows drives reconnection.
    };
  }

  private handleDisconnect(): void {
    this.ws = null;
    // In-flight mutations have an unknown outcome; surface that instead of
    // silently retrying (retry could double-apply).
    for (const [id, m] of [...this.pending]) {
      if (m.sent) {
        m.reject(new Error("chisa: connection lost before mutation was acknowledged"));
        this.pending.delete(id);
      }
    }
    if (this.closedByUser || this.opts.reconnect === false) {
      this.setStatus("closed");
      return;
    }
    this.setStatus("connecting");
    const delay = this.backoffMs * (0.5 + Math.random());
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs ?? 10_000);
    setTimeout(() => this.connect(), delay);
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "data": {
        const sub = this.subs.get(msg.id);
        if (sub) sub.cb(msg.docs);
        break;
      }
      case "result": {
        const m = this.pending.get(msg.id);
        if (!m) break;
        this.pending.delete(msg.id);
        if (msg.ok) m.resolve(msg.docId);
        else m.reject(new Error(`chisa: mutation rejected: ${msg.error}`));
        break;
      }
      case "error": {
        this.opts.onError?.(msg.message);
        break;
      }
      default:
        break;
    }
  }

  private mutate(mutation: Record<string, unknown>): Promise<string | undefined> {
    const id = `m${this.nextId++}`;
    const payload = JSON.stringify({ type: "mutation", id, mutation });
    return new Promise((resolve, reject) => {
      const entry: PendingMutation = { payload, sent: false, resolve, reject };
      this.pending.set(id, entry);
      if (this.ws && this.ws.readyState === WS_OPEN) {
        this.ws.send(payload);
        entry.sent = true;
      }
    });
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatusChange?.(status);
  }
}
