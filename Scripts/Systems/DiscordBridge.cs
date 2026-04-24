using System;
using System.Collections.Generic;
using Microsoft.Data.Sqlite;

namespace UsurperRemake.Systems;

/// <summary>
/// v0.57.13: Bidirectional Discord ↔ in-game /gos bridge via the shared SQLite database.
///
/// Game → Discord: MudChatSystem.HandleGossip calls QueueOutbound after the in-game broadcast.
///   The Node bot (ssh-proxy.js) polls to_discord rows, posts to the Discord channel,
///   marks processed.
///
/// Discord → Game: The Node bot writes from_discord rows on Discord messageCreate events.
///   MudServer.DiscordBridgePollerAsync drains unprocessed rows every 2s and re-broadcasts
///   them through the same global gossip channel everyone else sees.
///
/// Secrets (bot token, channel ID) only exist on the Node side as env vars. The C# side
/// only knows the database path.
/// </summary>
public static class DiscordBridge
{
    private static string? _connectionString;

    public static bool IsEnabled => _connectionString != null;

    public static void Initialize(string databasePath)
    {
        _connectionString = $"Data Source={databasePath};Pooling=true";
        EnsureSchema();
    }

    private static void EnsureSchema()
    {
        if (_connectionString == null) return;
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                CREATE TABLE IF NOT EXISTS discord_gossip (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    direction TEXT NOT NULL CHECK(direction IN ('to_discord', 'from_discord')),
                    author TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    processed INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_discord_gossip_pending
                    ON discord_gossip(direction, processed, id);
            ";
            cmd.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[DISCORD] Schema init failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Queue an in-game gossip message to relay out to Discord. Fire-and-forget, swallows errors.
    /// Safe to call from any context — no-op if Initialize hasn't been called.
    /// </summary>
    public static void QueueOutbound(string author, string message)
    {
        if (_connectionString == null || string.IsNullOrWhiteSpace(message)) return;
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                INSERT INTO discord_gossip (direction, author, message, created_at, processed)
                VALUES ('to_discord', @author, @message, @created_at, 0)
            ";
            cmd.Parameters.AddWithValue("@author", string.IsNullOrEmpty(author) ? "???" : author);
            cmd.Parameters.AddWithValue("@message", message);
            cmd.Parameters.AddWithValue("@created_at", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            cmd.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[DISCORD] Outbound queue failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Sentinel "author" used for system events (login/logout, server announcements).
    /// The Node-side bot recognises this and renders the message as an italicised
    /// system line instead of a normal gossip post.
    /// </summary>
    public const string SystemAuthor = "__SYSTEM__";

    /// <summary>
    /// Queue a system event (login, logout, ...) for Discord. The Node bot formats
    /// these differently from regular gossip. Fire-and-forget.
    /// </summary>
    public static void QueueSystemEvent(string message)
    {
        QueueOutbound(SystemAuthor, message);
    }

    public record InboundMessage(long Id, string Author, string Message);

    /// <summary>
    /// Drain all unprocessed from_discord rows in a single transaction.
    /// Safe to call every couple seconds; returns empty list on any error.
    /// </summary>
    public static List<InboundMessage> DrainInbound()
    {
        var result = new List<InboundMessage>();
        if (_connectionString == null) return result;
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            conn.Open();
            using var tx = conn.BeginTransaction();

            long maxId = 0;
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = @"
                    SELECT id, author, message FROM discord_gossip
                    WHERE direction = 'from_discord' AND processed = 0
                    ORDER BY id LIMIT 50
                ";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    long id = reader.GetInt64(0);
                    maxId = id;
                    result.Add(new InboundMessage(id, reader.GetString(1), reader.GetString(2)));
                }
            }

            if (result.Count > 0)
            {
                using var upd = conn.CreateCommand();
                upd.Transaction = tx;
                // Only mark ids we just read; any newer rows that arrived mid-transaction
                // stay processed=0 and get picked up on the next poll.
                upd.CommandText = @"
                    UPDATE discord_gossip SET processed = 1
                    WHERE direction = 'from_discord' AND processed = 0 AND id <= @maxId
                ";
                upd.Parameters.AddWithValue("@maxId", maxId);
                upd.ExecuteNonQuery();
            }

            tx.Commit();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[DISCORD] Drain inbound failed: {ex.Message}");
        }
        return result;
    }
}
