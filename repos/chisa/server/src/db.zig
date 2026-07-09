//! In-memory document store with schema validation, structured (AST-based)
//! queries, and append-only JSONL persistence.
//!
//! Queries and mutations arrive as JSON trees, never as query-language
//! strings, so there is no injection surface: every table/field/value is
//! checked against the schema before it touches data.
//!
//! Memory model: all live documents are allocated in one arena. Memory of
//! deleted/overwritten documents is reclaimed on restart (log replay), not
//! at runtime. Simple and safe; fine for the intended workloads.

const std = @import("std");
const Io = std.Io;
const Allocator = std.mem.Allocator;
pub const Value = std.json.Value;

pub const DbError = error{
    UnknownTable,
    UnknownField,
    TypeMismatch,
    MissingField,
    DocNotFound,
    BadMutation,
    BadQuery,
    FilterTooDeep,
};

const max_filter_depth: usize = 32;

pub const Table = struct {
    docs: std.json.ObjectMap = .empty,
};

pub const Db = struct {
    gpa: Allocator,
    io: Io,
    arena: std.heap.ArenaAllocator,
    tables: std.StringArrayHashMapUnmanaged(*Table) = .empty,
    schema: ?Value = null,
    log_file: ?Io.File = null,
    log_pos: u64 = 0,
    /// Monotonic commit counter, bumped on every applied mutation.
    version: u64 = 0,

    pub fn init(gpa: Allocator, io: Io) Db {
        return .{
            .gpa = gpa,
            .io = io,
            .arena = std.heap.ArenaAllocator.init(gpa),
        };
    }

    pub fn loadSchema(self: *Db, path: []const u8) !void {
        const a = self.arena.allocator();
        const file = try Io.Dir.cwd().openFile(self.io, path, .{});
        defer file.close(self.io);
        var rbuf: [4096]u8 = undefined;
        var fr = file.reader(self.io, &rbuf);
        const data = try fr.interface.allocRemaining(a, .unlimited);
        self.schema = try std.json.parseFromSliceLeaky(Value, a, data, .{});
    }

    /// Replays an existing log (if any), then opens it for appending.
    pub fn openLog(self: *Db, path: []const u8) !void {
        const cwd = Io.Dir.cwd();
        if (cwd.openFile(self.io, path, .{})) |file| {
            var rbuf: [4096]u8 = undefined;
            var fr = file.reader(self.io, &rbuf);
            const data = fr.interface.allocRemaining(self.gpa, .unlimited) catch |err| {
                file.close(self.io);
                return err;
            };
            file.close(self.io);
            defer self.gpa.free(data);
            var lines = std.mem.splitScalar(u8, data, '\n');
            while (lines.next()) |line| {
                const trimmed = std.mem.trim(u8, line, " \r\t");
                if (trimmed.len == 0) continue;
                self.replayLine(trimmed) catch |err| {
                    std.log.warn("chisa: skipping bad log line ({s})", .{@errorName(err)});
                };
            }
        } else |err| switch (err) {
            error.FileNotFound => {},
            else => return err,
        }
        const file = try cwd.createFile(self.io, path, .{ .truncate = false });
        self.log_file = file;
        self.log_pos = try file.length(self.io);
    }

    fn replayLine(self: *Db, line: []const u8) !void {
        var tmp = std.heap.ArenaAllocator.init(self.gpa);
        defer tmp.deinit();
        const root = std.json.parseFromSliceLeaky(Value, tmp.allocator(), line, .{}) catch
            return DbError.BadMutation;
        if (root != .object) return DbError.BadMutation;
        const op = getString(root, "op") orelse return DbError.BadMutation;
        const table = getString(root, "table") orelse return DbError.BadMutation;

        if (std.mem.eql(u8, op, "insert") or std.mem.eql(u8, op, "replace")) {
            const doc = root.object.get("doc") orelse return DbError.BadMutation;
            _ = try self.putRaw(table, doc);
        } else if (std.mem.eql(u8, op, "patch")) {
            const id = getString(root, "id") orelse return DbError.BadMutation;
            const fields = root.object.get("fields") orelse return DbError.BadMutation;
            const t = self.tables.get(table) orelse return DbError.DocNotFound;
            const doc_ptr = t.docs.getPtr(id) orelse return DbError.DocNotFound;
            try self.applyPatch(doc_ptr, fields);
        } else if (std.mem.eql(u8, op, "delete")) {
            const id = getString(root, "id") orelse return DbError.BadMutation;
            const t = self.tables.get(table) orelse return DbError.DocNotFound;
            if (!t.docs.orderedRemove(id)) return DbError.DocNotFound;
        } else {
            return DbError.BadMutation;
        }
        self.version += 1;
    }

    /// Inserts/overwrites a document that already carries `_id` (log replay).
    fn putRaw(self: *Db, table_name: []const u8, doc_in: Value) !Value {
        if (doc_in != .object) return DbError.BadMutation;
        const a = self.arena.allocator();
        const doc = try copyValue(a, doc_in);
        const id = getString(doc, "_id") orelse return DbError.BadMutation;
        const t = try self.getOrCreateTable(table_name);
        try t.docs.put(a, id, doc);
        return doc;
    }

    pub fn insert(self: *Db, table_name: []const u8, value: Value) !Value {
        try self.checkTableAllowed(table_name);
        if (value != .object) return DbError.BadMutation;
        try self.validate(table_name, value, .insert);
        const a = self.arena.allocator();
        var doc = try copyValue(a, value);

        var raw: [8]u8 = undefined;
        self.io.random(&raw);
        const hex_chars = "0123456789abcdef";
        var id_buf: [16]u8 = undefined;
        for (raw, 0..) |b, i| {
            id_buf[i * 2] = hex_chars[b >> 4];
            id_buf[i * 2 + 1] = hex_chars[b & 0xF];
        }
        const id = try a.dupe(u8, &id_buf);

        try doc.object.put(a, "_id", .{ .string = id });
        try doc.object.put(a, "_creationTime", .{ .integer = self.nowMs() });

        const t = try self.getOrCreateTable(table_name);
        try t.docs.put(a, id, doc);
        try self.appendLog("insert", table_name, null, "doc", doc);
        self.version += 1;
        return doc;
    }

    pub fn patch(self: *Db, table_name: []const u8, id: []const u8, fields: Value) !Value {
        try self.checkTableAllowed(table_name);
        if (fields != .object) return DbError.BadMutation;
        try self.validate(table_name, fields, .patch);
        const t = self.tables.get(table_name) orelse return DbError.DocNotFound;
        const doc_ptr = t.docs.getPtr(id) orelse return DbError.DocNotFound;
        try self.applyPatch(doc_ptr, fields);
        try self.appendLog("patch", table_name, id, "fields", fields);
        self.version += 1;
        return doc_ptr.*;
    }

    pub fn replace(self: *Db, table_name: []const u8, id: []const u8, value: Value) !Value {
        try self.checkTableAllowed(table_name);
        if (value != .object) return DbError.BadMutation;
        try self.validate(table_name, value, .insert);
        const t = self.tables.get(table_name) orelse return DbError.DocNotFound;
        const entry = t.docs.getEntry(id) orelse return DbError.DocNotFound;
        const a = self.arena.allocator();
        var doc = try copyValue(a, value);
        const creation = entry.value_ptr.object.get("_creationTime") orelse
            Value{ .integer = self.nowMs() };
        try doc.object.put(a, "_id", .{ .string = entry.key_ptr.* });
        try doc.object.put(a, "_creationTime", creation);
        entry.value_ptr.* = doc;
        try self.appendLog("replace", table_name, id, "doc", doc);
        self.version += 1;
        return doc;
    }

    pub fn delete(self: *Db, table_name: []const u8, id: []const u8) !void {
        try self.checkTableAllowed(table_name);
        const t = self.tables.get(table_name) orelse return DbError.DocNotFound;
        if (!t.docs.orderedRemove(id)) return DbError.DocNotFound;
        try self.appendLog("delete", table_name, id, null, null);
        self.version += 1;
    }

    /// Evaluates a structured query. Result slice is allocated with
    /// `out_alloc`; the documents themselves stay owned by the db arena.
    pub fn runQuery(self: *Db, query: Value, out_alloc: Allocator) ![]Value {
        if (query != .object) return DbError.BadQuery;
        const table_name = getString(query, "table") orelse return DbError.BadQuery;
        try self.checkTableAllowed(table_name);

        var results: std.ArrayList(Value) = .empty;
        const filter = query.object.get("filter");
        if (self.tables.get(table_name)) |t| {
            var it = t.docs.iterator();
            while (it.next()) |e| {
                if (filter) |f| {
                    if (f != .null and !(try evalFilter(f, e.value_ptr.*, 0))) continue;
                }
                try results.append(out_alloc, e.value_ptr.*);
            }
        }

        if (query.object.get("order")) |ord| {
            if (ord == .object) {
                const field = getString(ord, "field") orelse return DbError.BadQuery;
                const dir = getString(ord, "dir") orelse "asc";
                const ctx = SortCtx{ .field = field, .desc = std.mem.eql(u8, dir, "desc") };
                std.mem.sort(Value, results.items, ctx, docLessThan);
            }
        }

        if (query.object.get("limit")) |lim| {
            if (lim == .integer and lim.integer >= 0) {
                const n: usize = @intCast(lim.integer);
                if (results.items.len > n) results.shrinkRetainingCapacity(n);
            }
        }
        return results.items;
    }

    fn nowMs(self: *Db) i64 {
        return Io.Clock.now(.real, self.io).toMilliseconds();
    }

    fn getOrCreateTable(self: *Db, name: []const u8) !*Table {
        if (self.tables.get(name)) |t| return t;
        const a = self.arena.allocator();
        const t = try a.create(Table);
        t.* = .{};
        try self.tables.put(self.gpa, try a.dupe(u8, name), t);
        return t;
    }

    fn applyPatch(self: *Db, doc_ptr: *Value, fields: Value) !void {
        if (fields != .object) return DbError.BadMutation;
        const a = self.arena.allocator();
        var it = fields.object.iterator();
        while (it.next()) |e| {
            if (std.mem.startsWith(u8, e.key_ptr.*, "_")) continue;
            try doc_ptr.object.put(a, try a.dupe(u8, e.key_ptr.*), try copyValue(a, e.value_ptr.*));
        }
    }

    fn checkTableAllowed(self: *Db, name: []const u8) !void {
        const schema = self.schema orelse return;
        if (schema != .object) return;
        const tables = schema.object.get("tables") orelse return;
        if (tables != .object) return;
        if (tables.object.get(name) == null) return DbError.UnknownTable;
    }

    const ValidateMode = enum { insert, patch };

    fn validate(self: *Db, table_name: []const u8, obj: Value, mode: ValidateMode) !void {
        const schema = self.schema orelse return;
        if (schema != .object) return;
        const tables = schema.object.get("tables") orelse return;
        if (tables != .object) return;
        const tspec = tables.object.get(table_name) orelse return DbError.UnknownTable;
        if (tspec != .object) return;
        const fields = tspec.object.get("fields") orelse return;
        if (fields != .object) return;
        if (obj != .object) return DbError.BadMutation;

        var it = obj.object.iterator();
        while (it.next()) |e| {
            if (std.mem.startsWith(u8, e.key_ptr.*, "_")) continue;
            const spec = fields.object.get(e.key_ptr.*) orelse return DbError.UnknownField;
            if (!typeMatches(spec, e.value_ptr.*)) return DbError.TypeMismatch;
        }

        if (mode == .insert) {
            var fit = fields.object.iterator();
            while (fit.next()) |e| {
                if (specOptional(e.value_ptr.*)) continue;
                if (obj.object.get(e.key_ptr.*) == null) return DbError.MissingField;
            }
        }
    }

    fn appendLog(
        self: *Db,
        op: []const u8,
        table: []const u8,
        id: ?[]const u8,
        payload_key: ?[]const u8,
        payload: ?Value,
    ) !void {
        const file = self.log_file orelse return;
        var aw: Io.Writer.Allocating = .init(self.gpa);
        defer aw.deinit();
        const w = &aw.writer;
        try w.writeAll("{\"op\":");
        try std.json.Stringify.value(op, .{}, w);
        try w.writeAll(",\"table\":");
        try std.json.Stringify.value(table, .{}, w);
        if (id) |i| {
            try w.writeAll(",\"id\":");
            try std.json.Stringify.value(i, .{}, w);
        }
        if (payload) |p| {
            try w.writeAll(",\"");
            try w.writeAll(payload_key.?);
            try w.writeAll("\":");
            try std.json.Stringify.value(p, .{}, w);
        }
        try w.writeAll("}\n");

        var fw = file.writer(self.io, &.{});
        fw.pos = self.log_pos;
        try fw.interface.writeAll(aw.written());
        try fw.interface.flush();
        self.log_pos = fw.pos;
    }
};

pub fn getString(v: Value, key: []const u8) ?[]const u8 {
    if (v != .object) return null;
    const field = v.object.get(key) orelse return null;
    if (field != .string) return null;
    return field.string;
}

fn specOptional(spec: Value) bool {
    if (spec != .object) return false;
    const o = spec.object.get("optional") orelse return false;
    return o == .bool and o.bool;
}

fn typeMatches(spec: Value, value: Value) bool {
    if (spec != .object) return true;
    const t = getString(spec, "type") orelse return true;
    if (std.mem.eql(u8, t, "any")) return true;
    if (std.mem.eql(u8, t, "string") or std.mem.eql(u8, t, "id")) return value == .string;
    if (std.mem.eql(u8, t, "number"))
        return value == .integer or value == .float or value == .number_string;
    if (std.mem.eql(u8, t, "boolean")) return value == .bool;
    if (std.mem.eql(u8, t, "null")) return value == .null;
    if (std.mem.eql(u8, t, "array")) {
        if (value != .array) return false;
        const el = spec.object.get("element") orelse return true;
        for (value.array.items) |item| {
            if (!typeMatches(el, item)) return false;
        }
        return true;
    }
    if (std.mem.eql(u8, t, "object")) {
        if (value != .object) return false;
        const fields = spec.object.get("fields") orelse return true;
        if (fields != .object) return true;
        var it = value.object.iterator();
        while (it.next()) |e| {
            const fspec = fields.object.get(e.key_ptr.*) orelse return false;
            if (!typeMatches(fspec, e.value_ptr.*)) return false;
        }
        var fit = fields.object.iterator();
        while (fit.next()) |e| {
            if (specOptional(e.value_ptr.*)) continue;
            if (value.object.get(e.key_ptr.*) == null) return false;
        }
        return true;
    }
    return false;
}

fn copyValue(alloc: Allocator, v: Value) Allocator.Error!Value {
    return switch (v) {
        .null => .null,
        .bool => |b| .{ .bool = b },
        .integer => |i| .{ .integer = i },
        .float => |f| .{ .float = f },
        .number_string => |s| .{ .number_string = try alloc.dupe(u8, s) },
        .string => |s| .{ .string = try alloc.dupe(u8, s) },
        .array => |arr| blk: {
            var out = std.json.Array.init(alloc);
            try out.ensureTotalCapacity(arr.items.len);
            for (arr.items) |item| {
                out.appendAssumeCapacity(try copyValue(alloc, item));
            }
            break :blk .{ .array = out };
        },
        .object => |obj| blk: {
            var out: std.json.ObjectMap = .empty;
            try out.ensureTotalCapacity(alloc, obj.count());
            var it = obj.iterator();
            while (it.next()) |e| {
                out.putAssumeCapacity(
                    try alloc.dupe(u8, e.key_ptr.*),
                    try copyValue(alloc, e.value_ptr.*),
                );
            }
            break :blk .{ .object = out };
        },
    };
}

fn evalFilter(expr: Value, doc: Value, depth: usize) DbError!bool {
    if (depth > max_filter_depth) return DbError.FilterTooDeep;
    if (expr != .object) return DbError.BadQuery;
    const op = getString(expr, "op") orelse return DbError.BadQuery;

    if (std.mem.eql(u8, op, "and") or std.mem.eql(u8, op, "or")) {
        const exprs = expr.object.get("exprs") orelse return DbError.BadQuery;
        if (exprs != .array) return DbError.BadQuery;
        const is_and = op[0] == 'a';
        for (exprs.array.items) |sub| {
            const r = try evalFilter(sub, doc, depth + 1);
            if (is_and and !r) return false;
            if (!is_and and r) return true;
        }
        return is_and;
    }
    if (std.mem.eql(u8, op, "not")) {
        const inner = expr.object.get("expr") orelse return DbError.BadQuery;
        return !(try evalFilter(inner, doc, depth + 1));
    }

    const field = getString(expr, "field") orelse return DbError.BadQuery;
    const rhs = expr.object.get("value") orelse Value{ .null = {} };
    const lhs: Value = if (doc == .object)
        doc.object.get(field) orelse Value{ .null = {} }
    else
        Value{ .null = {} };

    if (std.mem.eql(u8, op, "eq")) return valuesEqual(lhs, rhs);
    if (std.mem.eql(u8, op, "neq")) return !valuesEqual(lhs, rhs);

    const ord = compareValues(lhs, rhs);
    if (std.mem.eql(u8, op, "lt")) return ord == .lt;
    if (std.mem.eql(u8, op, "lte")) return ord != .gt;
    if (std.mem.eql(u8, op, "gt")) return ord == .gt;
    if (std.mem.eql(u8, op, "gte")) return ord != .lt;
    return DbError.BadQuery;
}

fn rank(v: Value) u8 {
    return switch (v) {
        .null => 0,
        .bool => 1,
        .integer, .float, .number_string => 2,
        .string => 3,
        .array => 4,
        .object => 5,
    };
}

fn asFloat(v: Value) f64 {
    return switch (v) {
        .integer => |i| @floatFromInt(i),
        .float => |f| f,
        .number_string => |s| std.fmt.parseFloat(f64, s) catch 0,
        else => 0,
    };
}

/// Total order across all value types (type rank first, then value), so
/// sorting is always well-defined even for mixed-type fields.
fn compareValues(a: Value, b: Value) std.math.Order {
    const ra = rank(a);
    const rb = rank(b);
    if (ra != rb) return std.math.order(ra, rb);
    return switch (a) {
        .null => .eq,
        .bool => std.math.order(@intFromBool(a.bool), @intFromBool(b.bool)),
        .integer, .float, .number_string => std.math.order(asFloat(a), asFloat(b)),
        .string => std.mem.order(u8, a.string, b.string),
        else => .eq,
    };
}

fn valuesEqual(a: Value, b: Value) bool {
    if (rank(a) != rank(b)) return false;
    return switch (a) {
        .null => true,
        .bool => a.bool == b.bool,
        .integer, .float, .number_string => asFloat(a) == asFloat(b),
        .string => std.mem.eql(u8, a.string, b.string),
        else => false,
    };
}

const SortCtx = struct { field: []const u8, desc: bool };

fn docLessThan(ctx: SortCtx, a: Value, b: Value) bool {
    const av: Value = if (a == .object)
        a.object.get(ctx.field) orelse Value{ .null = {} }
    else
        Value{ .null = {} };
    const bv: Value = if (b == .object)
        b.object.get(ctx.field) orelse Value{ .null = {} }
    else
        Value{ .null = {} };
    const ord = compareValues(av, bv);
    return if (ctx.desc) ord == .gt else ord == .lt;
}

test "filter evaluation" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const doc = try std.json.parseFromSliceLeaky(Value, a,
        \\{"text":"buy milk","done":false,"priority":3}
    , .{});

    const f1 = try std.json.parseFromSliceLeaky(Value, a,
        \\{"op":"eq","field":"done","value":false}
    , .{});
    try std.testing.expect(try evalFilter(f1, doc, 0));

    const f2 = try std.json.parseFromSliceLeaky(Value, a,
        \\{"op":"and","exprs":[{"op":"gt","field":"priority","value":1},{"op":"neq","field":"text","value":"x"}]}
    , .{});
    try std.testing.expect(try evalFilter(f2, doc, 0));

    const f3 = try std.json.parseFromSliceLeaky(Value, a,
        \\{"op":"not","expr":{"op":"lte","field":"priority","value":2}}
    , .{});
    try std.testing.expect(try evalFilter(f3, doc, 0));
}

test "schema type matching" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const spec = try std.json.parseFromSliceLeaky(Value, a,
        \\{"type":"array","element":{"type":"number"}}
    , .{});
    const good = try std.json.parseFromSliceLeaky(Value, a, "[1,2,3]", .{});
    const bad = try std.json.parseFromSliceLeaky(Value, a, "[1,\"two\"]", .{});
    try std.testing.expect(typeMatches(spec, good));
    try std.testing.expect(!typeMatches(spec, bad));
}
