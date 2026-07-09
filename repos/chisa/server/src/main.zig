//! chisa sync server.
//!
//! Speaks a small JSON protocol over WebSocket:
//!   client -> server:
//!     {"type":"subscribe","id":"s1","query":{...}}
//!     {"type":"unsubscribe","id":"s1"}
//!     {"type":"mutation","id":"m1","mutation":{"op":"insert","table":"t","value":{...}}}
//!   server -> client:
//!     {"type":"hello","version":N}
//!     {"type":"data","id":"s1","version":N,"docs":[...]}
//!     {"type":"result","id":"m1","ok":true,"docId":"..."} | {"type":"result","id":"m1","ok":false,"error":"..."}
//!     {"type":"error","message":"..."}
//!
//! Every committed mutation re-runs the live queries subscribed to the
//! affected table and pushes fresh results, which is what keeps clients
//! in sync.

const std = @import("std");
const Io = std.Io;
const ws = @import("ws.zig");
const db_mod = @import("db.zig");
const Db = db_mod.Db;
const getString = db_mod.getString;
const Value = std.json.Value;

const Conn = struct {
    io: Io,
    stream: Io.net.Stream,
    reader: Io.net.Stream.Reader,
    writer: Io.net.Stream.Writer,
    read_buf: [16384]u8,
    write_buf: [16384]u8,
    write_mu: Io.Mutex = .init,
    closed: bool = false,
};

const Sub = struct {
    conn: *Conn,
    id: []u8,
    table: []u8,
    query_json: []u8,
};

const Server = struct {
    gpa: std.mem.Allocator,
    io: Io,
    db: Db,
    /// Guards db, subs and conns. All socket writes to a connection that
    /// is not the current thread's own happen while this is held.
    mu: Io.Mutex = .init,
    conns: std.ArrayList(*Conn) = .empty,
    subs: std.ArrayList(*Sub) = .empty,
};

fn usage() void {
    std.debug.print(
        \\chisa-server: sync engine server
        \\
        \\Usage: chisa-server [options]
        \\
        \\Options:
        \\  --host <addr>    Address to bind (default 127.0.0.1)
        \\  --port <port>    Port to bind (default 4700)
        \\  --data <path>    Append-only JSONL data log (default chisa.log)
        \\  --schema <path>  Schema JSON exported by @chisa/client (optional;
        \\                   without it the server accepts any shape)
        \\  --help           Show this help
        \\
    , .{});
}

pub fn main(init: std.process.Init) !void {
    const gpa = init.gpa;
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());

    var host: []const u8 = "127.0.0.1";
    var port: u16 = 4700;
    var data_path: []const u8 = "chisa.log";
    var schema_path: ?[]const u8 = null;

    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (std.mem.eql(u8, arg, "--help")) {
            usage();
            return;
        }
        if (i + 1 >= args.len) {
            usage();
            return error.MissingArgumentValue;
        }
        if (std.mem.eql(u8, arg, "--host")) {
            i += 1;
            host = args[i];
        } else if (std.mem.eql(u8, arg, "--port")) {
            i += 1;
            port = try std.fmt.parseInt(u16, args[i], 10);
        } else if (std.mem.eql(u8, arg, "--data")) {
            i += 1;
            data_path = args[i];
        } else if (std.mem.eql(u8, arg, "--schema")) {
            i += 1;
            schema_path = args[i];
        } else {
            usage();
            return error.UnknownArgument;
        }
    }

    var server = Server{
        .gpa = gpa,
        .io = io,
        .db = Db.init(gpa, io),
    };
    if (schema_path) |p| {
        try server.db.loadSchema(p);
        std.log.info("loaded schema from {s}", .{p});
    } else {
        std.log.warn("no --schema given; running schemaless (any shape accepted)", .{});
    }
    try server.db.openLog(data_path);
    std.log.info("replayed {d} mutations from {s}", .{ server.db.version, data_path });

    const addr = try Io.net.IpAddress.parse(host, port);
    var listener = try addr.listen(io, .{ .reuse_address = true });
    std.log.info("chisa server listening on ws://{s}:{d}", .{ host, port });

    while (true) {
        const stream = listener.accept(io) catch |err| {
            std.log.warn("accept failed: {s}", .{@errorName(err)});
            continue;
        };
        const conn = gpa.create(Conn) catch {
            stream.close(io);
            continue;
        };
        conn.* = .{
            .io = io,
            .stream = stream,
            .reader = undefined,
            .writer = undefined,
            .read_buf = undefined,
            .write_buf = undefined,
        };
        conn.reader = conn.stream.reader(io, &conn.read_buf);
        conn.writer = conn.stream.writer(io, &conn.write_buf);

        server.mu.lockUncancelable(server.io);
        server.conns.append(gpa, conn) catch {
            server.mu.unlock(server.io);
            stream.close(io);
            gpa.destroy(conn);
            continue;
        };
        server.mu.unlock(server.io);

        const thread = std.Thread.spawn(.{}, handleConn, .{ &server, conn }) catch {
            cleanupConn(&server, conn);
            continue;
        };
        thread.detach();
    }
}

fn handleConn(server: *Server, conn: *Conn) void {
    defer cleanupConn(server, conn);

    {
        var arena = std.heap.ArenaAllocator.init(server.gpa);
        defer arena.deinit();
        ws.handshake(&conn.reader.interface, &conn.writer.interface, arena.allocator()) catch return;
    }

    {
        server.mu.lockUncancelable(server.io);
        defer server.mu.unlock(server.io);
        var buf: [64]u8 = undefined;
        const hello = std.fmt.bufPrint(&buf, "{{\"type\":\"hello\",\"version\":{d}}}", .{server.db.version}) catch unreachable;
        sendText(conn, hello);
    }

    while (true) {
        if (conn.closed) return;
        var arena = std.heap.ArenaAllocator.init(server.gpa);
        defer arena.deinit();
        const frame = ws.readFrame(&conn.reader.interface, arena.allocator()) catch return;
        switch (frame.opcode) {
            .text => handleMessage(server, conn, frame.payload, arena.allocator()) catch return,
            .ping => {
                conn.write_mu.lockUncancelable(conn.io);
                defer conn.write_mu.unlock(conn.io);
                ws.writeFrame(&conn.writer.interface, .pong, frame.payload) catch return;
            },
            .close => {
                conn.write_mu.lockUncancelable(conn.io);
                defer conn.write_mu.unlock(conn.io);
                ws.writeFrame(&conn.writer.interface, .close, "") catch {};
                return;
            },
            else => {},
        }
    }
}

fn cleanupConn(server: *Server, conn: *Conn) void {
    server.mu.lockUncancelable(server.io);
    var i: usize = 0;
    while (i < server.subs.items.len) {
        const sub = server.subs.items[i];
        if (sub.conn == conn) {
            freeSub(server, sub);
            _ = server.subs.swapRemove(i);
        } else {
            i += 1;
        }
    }
    for (server.conns.items, 0..) |c, idx| {
        if (c == conn) {
            _ = server.conns.swapRemove(idx);
            break;
        }
    }
    server.mu.unlock(server.io);
    conn.stream.close(server.io);
    server.gpa.destroy(conn);
}

fn freeSub(server: *Server, sub: *Sub) void {
    server.gpa.free(sub.id);
    server.gpa.free(sub.table);
    server.gpa.free(sub.query_json);
    server.gpa.destroy(sub);
}

/// Writes one text frame; on socket failure marks the connection dead so
/// its own thread tears it down.
fn sendText(conn: *Conn, payload: []const u8) void {
    if (conn.closed) return;
    conn.write_mu.lockUncancelable(conn.io);
    defer conn.write_mu.unlock(conn.io);
    ws.writeFrame(&conn.writer.interface, .text, payload) catch {
        conn.closed = true;
    };
}

fn handleMessage(server: *Server, conn: *Conn, payload: []u8, tmp: std.mem.Allocator) !void {
    const root = std.json.parseFromSliceLeaky(Value, tmp, payload, .{}) catch {
        try sendError(conn, tmp, "invalid json");
        return;
    };
    const msg_type = getString(root, "type") orelse {
        try sendError(conn, tmp, "missing message type");
        return;
    };

    if (std.mem.eql(u8, msg_type, "subscribe")) {
        try handleSubscribe(server, conn, root, tmp);
    } else if (std.mem.eql(u8, msg_type, "unsubscribe")) {
        handleUnsubscribe(server, conn, root);
    } else if (std.mem.eql(u8, msg_type, "mutation")) {
        try handleMutation(server, conn, root, tmp);
    } else if (std.mem.eql(u8, msg_type, "ping")) {
        sendText(conn, "{\"type\":\"pong\"}");
    } else {
        try sendError(conn, tmp, "unknown message type");
    }
}

fn handleSubscribe(server: *Server, conn: *Conn, root: Value, tmp: std.mem.Allocator) !void {
    const sub_id = getString(root, "id") orelse return sendError(conn, tmp, "subscribe: missing id");
    const query = root.object.get("query") orelse return sendError(conn, tmp, "subscribe: missing query");
    const table = getString(query, "table") orelse return sendError(conn, tmp, "subscribe: query missing table");

    server.mu.lockUncancelable(server.io);
    defer server.mu.unlock(server.io);

    const docs = server.db.runQuery(query, tmp) catch |err| {
        return sendError(conn, tmp, @errorName(err));
    };

    const sub = try server.gpa.create(Sub);
    errdefer server.gpa.destroy(sub);
    var aw: Io.Writer.Allocating = .init(server.gpa);
    errdefer aw.deinit();
    try std.json.Stringify.value(query, .{}, &aw.writer);
    sub.* = .{
        .conn = conn,
        .id = try server.gpa.dupe(u8, sub_id),
        .table = try server.gpa.dupe(u8, table),
        .query_json = try aw.toOwnedSlice(),
    };
    try server.subs.append(server.gpa, sub);

    try sendDocs(server, conn, sub_id, docs, tmp);
}

fn handleUnsubscribe(server: *Server, conn: *Conn, root: Value) void {
    const sub_id = getString(root, "id") orelse return;
    server.mu.lockUncancelable(server.io);
    defer server.mu.unlock(server.io);
    var i: usize = 0;
    while (i < server.subs.items.len) {
        const sub = server.subs.items[i];
        if (sub.conn == conn and std.mem.eql(u8, sub.id, sub_id)) {
            freeSub(server, sub);
            _ = server.subs.swapRemove(i);
        } else {
            i += 1;
        }
    }
}

fn handleMutation(server: *Server, conn: *Conn, root: Value, tmp: std.mem.Allocator) !void {
    const msg_id = getString(root, "id") orelse return sendError(conn, tmp, "mutation: missing id");
    const mutation = root.object.get("mutation") orelse
        return sendResult(server, conn, tmp, msg_id, null, "BadMutation");
    const op = getString(mutation, "op") orelse
        return sendResult(server, conn, tmp, msg_id, null, "BadMutation");
    const table = getString(mutation, "table") orelse
        return sendResult(server, conn, tmp, msg_id, null, "BadMutation");

    server.mu.lockUncancelable(server.io);
    defer server.mu.unlock(server.io);

    if (applyMutation(&server.db, op, table, mutation)) |doc_id| {
        try sendResult(server, conn, tmp, msg_id, doc_id, null);
        notifyTable(server, table, tmp);
    } else |err| {
        try sendResult(server, conn, tmp, msg_id, null, @errorName(err));
    }
}

fn applyMutation(db: *Db, op: []const u8, table: []const u8, mutation: Value) !?[]const u8 {
    if (std.mem.eql(u8, op, "insert")) {
        const value = mutation.object.get("value") orelse return error.BadMutation;
        const doc = try db.insert(table, value);
        return getString(doc, "_id");
    } else if (std.mem.eql(u8, op, "patch")) {
        const id = getString(mutation, "id") orelse return error.BadMutation;
        const fields = mutation.object.get("fields") orelse return error.BadMutation;
        _ = try db.patch(table, id, fields);
        return id;
    } else if (std.mem.eql(u8, op, "replace")) {
        const id = getString(mutation, "id") orelse return error.BadMutation;
        const value = mutation.object.get("value") orelse return error.BadMutation;
        _ = try db.replace(table, id, value);
        return id;
    } else if (std.mem.eql(u8, op, "delete")) {
        const id = getString(mutation, "id") orelse return error.BadMutation;
        try db.delete(table, id);
        return id;
    }
    return error.UnknownOp;
}

/// Re-runs every live query on `table` and pushes fresh results.
/// Caller must hold server.mu.
fn notifyTable(server: *Server, table: []const u8, tmp: std.mem.Allocator) void {
    for (server.subs.items) |sub| {
        if (!std.mem.eql(u8, sub.table, table)) continue;
        if (sub.conn.closed) continue;
        const query = std.json.parseFromSliceLeaky(Value, tmp, sub.query_json, .{}) catch continue;
        const docs = server.db.runQuery(query, tmp) catch continue;
        sendDocs(server, sub.conn, sub.id, docs, tmp) catch continue;
    }
}

fn sendDocs(server: *Server, conn: *Conn, sub_id: []const u8, docs: []const Value, tmp: std.mem.Allocator) !void {
    var aw: Io.Writer.Allocating = .init(tmp);
    const w = &aw.writer;
    try w.writeAll("{\"type\":\"data\",\"id\":");
    try std.json.Stringify.value(sub_id, .{}, w);
    try w.print(",\"version\":{d},\"docs\":[", .{server.db.version});
    for (docs, 0..) |doc, i| {
        if (i > 0) try w.writeAll(",");
        try std.json.Stringify.value(doc, .{}, w);
    }
    try w.writeAll("]}");
    sendText(conn, aw.written());
}

fn sendResult(
    server: *Server,
    conn: *Conn,
    tmp: std.mem.Allocator,
    msg_id: []const u8,
    doc_id: ?[]const u8,
    err_name: ?[]const u8,
) !void {
    _ = server;
    var aw: Io.Writer.Allocating = .init(tmp);
    const w = &aw.writer;
    try w.writeAll("{\"type\":\"result\",\"id\":");
    try std.json.Stringify.value(msg_id, .{}, w);
    if (err_name) |e| {
        try w.writeAll(",\"ok\":false,\"error\":");
        try std.json.Stringify.value(e, .{}, w);
    } else {
        try w.writeAll(",\"ok\":true");
        if (doc_id) |d| {
            try w.writeAll(",\"docId\":");
            try std.json.Stringify.value(d, .{}, w);
        }
    }
    try w.writeAll("}");
    sendText(conn, aw.written());
}

fn sendError(conn: *Conn, tmp: std.mem.Allocator, message: []const u8) !void {
    var aw: Io.Writer.Allocating = .init(tmp);
    const w = &aw.writer;
    try w.writeAll("{\"type\":\"error\",\"message\":");
    try std.json.Stringify.value(message, .{}, w);
    try w.writeAll("}");
    sendText(conn, aw.written());
}
