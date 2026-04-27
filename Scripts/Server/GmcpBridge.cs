using System;
using System.IO;
using System.Text;
using System.Text.Json;
using UsurperRemake.Systems;

namespace UsurperRemake.Server;

/// <summary>
/// v0.57.21: GMCP (Generic MUD Communication Protocol) out-of-band event emitter.
///
/// GMCP is a telnet subnegotiation extension supported by Mudlet, MUSHclient, TinTin++,
/// and other modern MUD clients. The server emits structured JSON payloads inside
/// IAC SB GMCP framing; clients parse them into dedicated UI panes (status bars,
/// gauges, map widgets) instead of dumping raw text into the scroll buffer.
///
/// Wire format (per the GMCP spec):
///   IAC (0xFF) SB (0xFA) GMCP (0xC9) "Package.Message" SP "{json}" IAC (0xFF) SE (0xF0)
///
/// Two important framing rules:
///  - 0xFF bytes inside the payload MUST be doubled (0xFF 0xFF) so the SE terminator
///    is unambiguous. JsonSerializer.Serialize never emits 0xFF in valid UTF-8 JSON
///    output (no Unicode codepoint encodes to a single 0xFF byte), but the package
///    name comes from caller-controlled strings so we escape defensively anyway.
///  - The package name and JSON payload are separated by a single space (0x20).
///
/// This bridge is a no-op when:
///  - SessionContext.Current is null (single-player, BBS door, --local mode).
///  - SessionContext.Current.GmcpEnabled is false (client did not respond DO GMCP).
///  - The session's OutputStream is null or closed.
///
/// Mirrors the ElectronBridge.Emit pattern — same call sites, different transport.
/// </summary>
public static class GmcpBridge
{
    private static readonly byte[] IacSbGmcp = new byte[] { 0xFF, 0xFA, 0xC9 }; // IAC SB GMCP
    private static readonly byte[] IacSe = new byte[] { 0xFF, 0xF0 };           // IAC SE
    private static readonly byte Space = 0x20;

    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        // GMCP payloads are tiny (one Char.Vitals = ~80 bytes); compact serialization
        // matches conventions of every other GMCP-speaking server (Achaea, Iron Realms).
        WriteIndented = false
    };

    /// <summary>
    /// True if there's an active GMCP-enabled session on the current async flow.
    /// Cheap check call sites can use to skip JSON serialization when GMCP is off.
    /// </summary>
    public static bool IsActive
    {
        get
        {
            var ctx = SessionContext.Current;
            return ctx != null && ctx.GmcpEnabled && ctx.OutputStream != null;
        }
    }

    /// <summary>
    /// Emit a GMCP frame to the current session's output stream.
    /// Package format follows the GMCP convention: "Module.Submodule" (e.g. "Char.Vitals",
    /// "Room.Info", "Comm.Channel.Text"). Payload is JSON-serialized with camelCase property
    /// names. Silently no-ops when GMCP is not active for the current session.
    /// </summary>
    public static void Emit(string package, object? payload)
    {
        var ctx = SessionContext.Current;
        if (ctx == null || !ctx.GmcpEnabled) return;

        var stream = ctx.OutputStream;
        if (stream == null || !stream.CanWrite) return;

        try
        {
            var frame = BuildFrame(package, payload);
            // Synchronous Write — GMCP frames are small (<200 bytes) and writing them
            // async would interleave with other output unpredictably. Locks on the
            // stream are handled by the underlying NetworkStream.
            lock (stream)
            {
                stream.Write(frame, 0, frame.Length);
                stream.Flush();
            }
        }
        catch (IOException)
        {
            // Connection dropped mid-emit — ignore. The session's main read/write loop
            // will detect the disconnect and clean up.
        }
        catch (ObjectDisposedException)
        {
            // Stream closed while we held the reference. Same handling as IOException.
        }
        catch (Exception ex)
        {
            DebugLogger.Instance.LogWarning("GMCP",
                $"Emit '{package}' failed: {ex.GetType().Name}: {ex.Message}");
        }
    }

    /// <summary>
    /// Emit a GMCP frame to a specific session's output stream regardless of which
    /// session is "current." Used by chat fan-out paths where the sender's
    /// SessionContext is current but the GMCP frame needs to reach the recipient.
    /// Silently no-ops when the target session has GmcpEnabled=false.
    /// </summary>
    public static void EmitTo(PlayerSession? session, string package, object? payload)
    {
        if (session?.Context == null || !session.Context.GmcpEnabled) return;
        var stream = session.Context.OutputStream;
        if (stream == null || !stream.CanWrite) return;

        try
        {
            var frame = BuildFrame(package, payload);
            lock (stream)
            {
                stream.Write(frame, 0, frame.Length);
                stream.Flush();
            }
        }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
        catch (Exception ex)
        {
            DebugLogger.Instance.LogWarning("GMCP",
                $"EmitTo[{session.Username}] '{package}' failed: {ex.GetType().Name}: {ex.Message}");
        }
    }

    /// <summary>
    /// Build a complete GMCP frame as raw bytes. Exposed internal for unit testing —
    /// callers should use Emit() in production code.
    /// </summary>
    internal static byte[] BuildFrame(string package, object? payload)
    {
        // UTF-8 encode package name with 0xFF doubling.
        byte[] pkgBytes = EscapeIacBytes(Encoding.UTF8.GetBytes(package ?? ""));

        // Serialize payload as JSON. Null payload is permitted — some GMCP messages
        // are pure event signals with no body (e.g. Comm.Channel.Start).
        byte[] jsonBytes = payload == null
            ? Array.Empty<byte>()
            : EscapeIacBytes(JsonSerializer.SerializeToUtf8Bytes(payload, PayloadOptions));

        int total = IacSbGmcp.Length + pkgBytes.Length + (jsonBytes.Length > 0 ? 1 + jsonBytes.Length : 0) + IacSe.Length;
        var frame = new byte[total];
        int offset = 0;

        Buffer.BlockCopy(IacSbGmcp, 0, frame, offset, IacSbGmcp.Length);
        offset += IacSbGmcp.Length;
        Buffer.BlockCopy(pkgBytes, 0, frame, offset, pkgBytes.Length);
        offset += pkgBytes.Length;

        if (jsonBytes.Length > 0)
        {
            frame[offset++] = Space;
            Buffer.BlockCopy(jsonBytes, 0, frame, offset, jsonBytes.Length);
            offset += jsonBytes.Length;
        }

        Buffer.BlockCopy(IacSe, 0, frame, offset, IacSe.Length);
        return frame;
    }

    /// <summary>
    /// Per-RFC, 0xFF bytes inside an SB block must be doubled (sent as 0xFF 0xFF) so
    /// the IAC SE terminator (0xFF 0xF0) is unambiguous. Returns the input unchanged
    /// when no escaping is needed (the common case for all-ASCII package names and
    /// JSON payloads).
    /// </summary>
    internal static byte[] EscapeIacBytes(byte[] input)
    {
        if (input == null || input.Length == 0) return Array.Empty<byte>();

        // Fast path: scan for any 0xFF. If none, return original (zero allocations).
        bool needsEscape = false;
        for (int i = 0; i < input.Length; i++)
        {
            if (input[i] == 0xFF) { needsEscape = true; break; }
        }
        if (!needsEscape) return input;

        // Slow path: rebuild with doubled 0xFF.
        using var ms = new MemoryStream(input.Length + 8);
        for (int i = 0; i < input.Length; i++)
        {
            ms.WriteByte(input[i]);
            if (input[i] == 0xFF) ms.WriteByte(0xFF);
        }
        return ms.ToArray();
    }
}
