//! Minimal RFC 6455 WebSocket support (server side), std-lib only.
//! Supports unfragmented text/binary/control frames, which is all the
//! chisa protocol needs.

const std = @import("std");
const Io = std.Io;

pub const Opcode = enum(u4) {
    continuation = 0x0,
    text = 0x1,
    binary = 0x2,
    close = 0x8,
    ping = 0x9,
    pong = 0xA,
    _,
};

pub const Frame = struct {
    opcode: Opcode,
    payload: []u8,
};

/// Hard cap on a single frame; also bounds per-message memory usage.
pub const max_frame_len: u64 = 1 << 20;

const ws_guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// Reads the HTTP upgrade request and answers with a 101 response.
pub fn handshake(r: *Io.Reader, w: *Io.Writer, alloc: std.mem.Allocator) !void {
    var req: std.ArrayList(u8) = .empty;
    defer req.deinit(alloc);

    while (true) {
        if (req.items.len > 16384) return error.RequestTooLarge;
        const byte = try r.takeByte();
        try req.append(alloc, byte);
        if (std.mem.endsWith(u8, req.items, "\r\n\r\n")) break;
    }

    const key = findHeader(req.items, "sec-websocket-key") orelse return error.MissingWebSocketKey;

    var sha = std.crypto.hash.Sha1.init(.{});
    sha.update(key);
    sha.update(ws_guid);
    var digest: [20]u8 = undefined;
    sha.final(&digest);

    var accept: [28]u8 = undefined;
    _ = std.base64.standard.Encoder.encode(&accept, &digest);

    try w.print(
        "HTTP/1.1 101 Switching Protocols\r\n" ++
            "Upgrade: websocket\r\n" ++
            "Connection: Upgrade\r\n" ++
            "Sec-WebSocket-Accept: {s}\r\n\r\n",
        .{accept},
    );
    try w.flush();
}

fn findHeader(request: []const u8, name: []const u8) ?[]const u8 {
    var lines = std.mem.splitSequence(u8, request, "\r\n");
    while (lines.next()) |line| {
        const colon = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const header_name = std.mem.trim(u8, line[0..colon], " \t");
        if (!std.ascii.eqlIgnoreCase(header_name, name)) continue;
        return std.mem.trim(u8, line[colon + 1 ..], " \t");
    }
    return null;
}

/// Reads one frame; payload is allocated with `alloc` (use an arena).
pub fn readFrame(r: *Io.Reader, alloc: std.mem.Allocator) !Frame {
    var hdr: [2]u8 = undefined;
    try r.readSliceAll(&hdr);
    if (hdr[0] & 0x80 == 0) return error.FragmentedFramesUnsupported;
    const opcode: Opcode = @enumFromInt(@as(u4, @truncate(hdr[0] & 0x0F)));

    const masked = hdr[1] & 0x80 != 0;
    var len: u64 = hdr[1] & 0x7F;
    if (len == 126) {
        var ext: [2]u8 = undefined;
        try r.readSliceAll(&ext);
        len = std.mem.readInt(u16, &ext, .big);
    } else if (len == 127) {
        var ext: [8]u8 = undefined;
        try r.readSliceAll(&ext);
        len = std.mem.readInt(u64, &ext, .big);
    }
    if (len > max_frame_len) return error.FrameTooLarge;

    var mask: [4]u8 = undefined;
    if (masked) try r.readSliceAll(&mask);

    const payload = try alloc.alloc(u8, @intCast(len));
    try r.readSliceAll(payload);
    if (masked) {
        for (payload, 0..) |*b, i| b.* ^= mask[i % 4];
    }
    return .{ .opcode = opcode, .payload = payload };
}

/// Writes one unmasked (server-to-client) frame and flushes.
pub fn writeFrame(w: *Io.Writer, opcode: Opcode, payload: []const u8) !void {
    var hdr: [10]u8 = undefined;
    hdr[0] = 0x80 | @as(u8, @intFromEnum(opcode));
    var hdr_len: usize = 2;
    if (payload.len < 126) {
        hdr[1] = @intCast(payload.len);
    } else if (payload.len < 65536) {
        hdr[1] = 126;
        std.mem.writeInt(u16, hdr[2..4], @intCast(payload.len), .big);
        hdr_len = 4;
    } else {
        hdr[1] = 127;
        std.mem.writeInt(u64, hdr[2..10], @intCast(payload.len), .big);
        hdr_len = 10;
    }
    try w.writeAll(hdr[0..hdr_len]);
    try w.writeAll(payload);
    try w.flush();
}
