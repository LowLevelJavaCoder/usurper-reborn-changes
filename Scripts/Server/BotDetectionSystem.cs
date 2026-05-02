using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using UsurperRemake.Systems;

namespace UsurperRemake.Server
{
    /// <summary>
    /// v0.60.0 server-side bot/automation detection (Tier 1: instrumentation only).
    /// Tracks per-username combat-input intervals (time between combat-menu render
    /// and the subsequent terminal.GetInput return) in a fixed-size ring buffer.
    /// When the rolling window indicates robotic timing patterns (low mean + low
    /// stddev + many consecutive sub-fast-threshold actions), a structured
    /// BOT_SUSPECT entry is logged via DebugLogger for sysop review.
    ///
    /// No automated action is taken at this tier. The detector exists to gather
    /// evidence and let the sysop calibrate thresholds against real player data
    /// before any throttling or kicking is wired in (Tier 2 / Tier 3 deferred).
    ///
    /// The v0.57.21 reverted approach used visible "Press [X] to continue"
    /// prompts which trigger-script users noticed within minutes and which broke
    /// legit screen-reader / accessibility workflows. Server-side timing
    /// detection is invisible to players when calibrated correctly. Memory note:
    /// "if we revisit anti-automation, target server-side input-cadence detection
    /// rather than visible prompt friction."
    ///
    /// Thresholds chosen so a fast human player (~200ms typical) is well clear:
    ///   * FastThresholdMs = 50 -- "any input under this is suspiciously fast"
    ///     A human's perceive+decide+key cycle has a hard physiological floor of
    ///     ~150-200ms even with good keybinds; anything routinely under 50ms is
    ///     a triggered script.
    ///   * SuspectMeanMs = 80 -- rolling mean must drop below this AND stddev
    ///     must be low for a flag. Prevents false-positives from a player who
    ///     just had a fast-decision combo (one or two quick inputs in a row).
    ///   * SuspectStdDevMs = 30 -- humans have higher variance even at speed.
    ///     A bot's intervals tend to cluster in a 5-15ms band.
    ///   * SuspectConsecutiveCount = 20 -- need at least 20 in a row, not just
    ///     a quick streak. Pure-bot players hit this within seconds; human
    ///     fast-clickers don't sustain it across 20+ combat decisions.
    ///   * FlagCooldownSeconds = 60 -- once flagged, suppress re-logging for a
    ///     minute so a confirmed bot doesn't spam the log line every input.
    /// </summary>
    public static class BotDetectionSystem
    {
        public const int WindowSize = 30;
        // v0.60.0 alpha balance review: tightened thresholds. Original 80ms
        // mean / 30ms stddev never tripped during alpha (Aura at 3 min/fight
        // wasn't fast enough to flag). Lowered slightly so we get actual
        // signal when beta opens. Still well above human reaction-time
        // floors so legitimate fast-clickers don't false-positive.
        public const double FastThresholdMs = 40.0;
        public const double SuspectMeanMs = 60.0;
        public const double SuspectStdDevMs = 20.0;
        public const int SuspectConsecutiveCount = 20;
        public const int FlagCooldownSeconds = 60;

        private class SessionStats
        {
            public Queue<double> RecentIntervalsMs = new();
            public int ConsecutiveFastCount;
            public DateTime LastFlaggedUtc = DateTime.MinValue;
            public int TotalFlagCount;
        }

        private static readonly ConcurrentDictionary<string, SessionStats> _stats = new();

        /// <summary>
        /// Record a single combat-input interval. Called from CombatEngine after the
        /// player's terminal.GetInput returns -- the interval is (input received time
        /// minus menu render time) in milliseconds. Username is the SSH/MUD account
        /// name from SessionContext, not the display name (display names can change,
        /// account name is the stable per-player identity).
        /// </summary>
        public static void RecordCombatInput(string? username, double responseMs)
        {
            if (string.IsNullOrWhiteSpace(username) || responseMs < 0) return;

            var s = _stats.GetOrAdd(username, _ => new SessionStats());
            lock (s)
            {
                s.RecentIntervalsMs.Enqueue(responseMs);
                while (s.RecentIntervalsMs.Count > WindowSize)
                    s.RecentIntervalsMs.Dequeue();

                if (responseMs < FastThresholdMs)
                    s.ConsecutiveFastCount++;
                else
                    s.ConsecutiveFastCount = 0;

                if (s.RecentIntervalsMs.Count < WindowSize) return;

                double mean = s.RecentIntervalsMs.Average();
                double variance = s.RecentIntervalsMs.Sum(v => (v - mean) * (v - mean)) / s.RecentIntervalsMs.Count;
                double stddev = Math.Sqrt(variance);

                bool suspect = mean < SuspectMeanMs &&
                               stddev < SuspectStdDevMs &&
                               s.ConsecutiveFastCount >= SuspectConsecutiveCount;

                if (suspect && (DateTime.UtcNow - s.LastFlaggedUtc).TotalSeconds > FlagCooldownSeconds)
                {
                    s.LastFlaggedUtc = DateTime.UtcNow;
                    s.TotalFlagCount++;
                    DebugLogger.Instance.LogWarning("BOT_SUSPECT",
                        $"player={username} mean={mean:F1}ms stddev={stddev:F1}ms consecFast={s.ConsecutiveFastCount} window={WindowSize} totalFlagsThisSession={s.TotalFlagCount}");
                }
            }
        }

        /// <summary>
        /// Drop a session's stats (called on disconnect). Keeps the dictionary
        /// bounded and prevents reconnects from inheriting stale fast-streaks.
        /// </summary>
        public static void ClearSession(string? username)
        {
            if (string.IsNullOrWhiteSpace(username)) return;
            _stats.TryRemove(username, out _);
        }

        /// <summary>
        /// Snapshot of all currently-tracked sessions for admin dashboard surfacing.
        /// Returns username, recent mean ms, recent stddev ms, consecutive fast count,
        /// and total flag count for the session. Sysops can compare suspected players
        /// against confirmed legit fast players to calibrate thresholds.
        /// </summary>
        public static List<(string username, double meanMs, double stddevMs, int consecFast, int totalFlags)> Snapshot()
        {
            var result = new List<(string, double, double, int, int)>();
            foreach (var kvp in _stats)
            {
                var s = kvp.Value;
                lock (s)
                {
                    if (s.RecentIntervalsMs.Count == 0) continue;
                    double mean = s.RecentIntervalsMs.Average();
                    double variance = s.RecentIntervalsMs.Sum(v => (v - mean) * (v - mean)) / s.RecentIntervalsMs.Count;
                    double stddev = Math.Sqrt(variance);
                    result.Add((kvp.Key, mean, stddev, s.ConsecutiveFastCount, s.TotalFlagCount));
                }
            }
            return result;
        }

        /// <summary>
        /// v0.60.4: serialize Snapshot() to a single-row SQLite table the admin
        /// dashboard polls. Called on a 30s timer from MudServer. Writes a JSON
        /// blob plus the threshold values so the dashboard can render "this
        /// player is X% of the way to a flag" without hardcoding the constants.
        /// Silent no-op when SqlBackend is null (single-player mode).
        /// </summary>
        public static void WriteSnapshotToDb(SqlSaveBackend? backend)
        {
            try
            {
                if (backend == null) return;

                var rows = Snapshot();
                var payload = new
                {
                    thresholds = new
                    {
                        windowSize = WindowSize,
                        fastThresholdMs = FastThresholdMs,
                        suspectMeanMs = SuspectMeanMs,
                        suspectStdDevMs = SuspectStdDevMs,
                        suspectConsecutiveCount = SuspectConsecutiveCount
                    },
                    sessions = rows.Select(r => new
                    {
                        username = r.username,
                        meanMs = Math.Round(r.meanMs, 1),
                        stddevMs = Math.Round(r.stddevMs, 1),
                        consecFast = r.consecFast,
                        totalFlags = r.totalFlags,
                        // Convenience: "is this session matching all 3 flag conditions right now?"
                        suspect = r.meanMs < SuspectMeanMs
                            && r.stddevMs < SuspectStdDevMs
                            && r.consecFast >= SuspectConsecutiveCount
                    }).ToList()
                };

                string json = System.Text.Json.JsonSerializer.Serialize(payload,
                    new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });

                backend.UpsertBotDetectionSnapshot(json);
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.LogWarning("BOT_SNAPSHOT",
                    $"WriteSnapshotToDb failed: {ex.GetType().Name}: {ex.Message}");
            }
        }
    }
}
