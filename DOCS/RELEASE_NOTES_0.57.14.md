# v0.57.14 - Save Recovery, Music Shop, Discord Stats & Login Events

## Save Listing and Load-Path Resilience

Player report (Lin, single-player Steam): loaded the game and her saves were gone from the slot list. The save files were fine on disk (`%APPDATA%\UsurperReloaded\saves\Lin.json` at 73 MB, plus `Lin_backup.json` and five recent autosaves), but the load screen showed *"Existing Save Slots:"* with nothing underneath. The save was there; the game just couldn't see it.

Two compounding bugs in the save subsystem:

**Silent listing failure.** `FileSaveBackend.GetAllSaves()` iterates every `.json` in the saves folder, calls `File.ReadAllText(file)` (pulls the whole file into memory as a UTF-16 string — a 73 MB JSON file becomes ~146 MB allocated), then runs `JsonSerializer.Deserialize<SaveGameData>` on the lot. Any exception in that chain — `OutOfMemoryException`, `JsonException`, anything — was swallowed by `catch (Exception ex) { DebugLogger.Log(Debug, ...) }`. The save vanished from the list. The player had no way to know it was still there.

**Silent load failure.** `FileSaveBackend.ReadGameDataByFileName` had the same shape: `catch (Exception ex) { return null; }` (ex unused, no logging). `GameEngine.LoadSaveByFileName` saw null and printed a generic `"Load failed — save may be corrupted"` line, then returned straight to the menu. No path, no error detail, no recovery suggestion. From the player's perspective, identical to "save doesn't exist."

Fix, two layers:

**Listing side** (`FileSaveBackend.GetAllSaves`): each file's deserialize is wrapped in its own try/catch with a fallback branch. If the full deserialize works, use it (same as before). If it throws, log the specific exception at Warning level and still include the file in the list — populating `PlayerName` from `Path.GetFileNameWithoutExtension` and `SaveTime` from the file's `LastWriteTime`. The slot appears; the player can select it; the load path handles whatever's next. Also skips obvious non-character files up front (`*_autosave_*.json`, `*_backup.json`, `emergency_*.json`) so the slot list stays clean.

**Load side** (`FileSaveBackend.ReadGameDataByFileNameWithError` → `SaveSystem.LoadSaveByFileNameWithError` → `GameEngine.LoadSaveByFileName`): new error-returning load method. On failure it returns a specific human-readable message distinguishing between:
- File not found (with full path)
- IO error (file locked by another process, permission denied)
- Out-of-memory during read or deserialize (with file size in MB)
- JSON parse error (with line/position from the `JsonException`)
- Version too old (with the numbers)
- Unexpected deserializer output

`GameEngine.LoadSaveByFileName` now routes failures through a new `ShowLoadFailureWithRecovery` method that:
1. Prints the specific error.
2. Shows the full save folder path.
3. Scans for recovery files alongside the broken save — `<name>_backup.json`, up to three most-recent `<name>_autosave_*.json` files, and `emergency_autosave.json` — listing each with its `LastWriteTime`.
4. Offers numbered options to load a recovery file (which copies it over the primary and re-attempts the load through the normal pipeline), start a new character (with explicit warning that it overwrites), or return to the main menu.

If a recovery file ALSO fails to load, the menu re-enters with the new error so the player can try the next one. In no case does the game silently drop the player back to the main menu with the impression that their saves vanished.

**Root cause of the bloat is separate** — all of the affected autosaves are 73 MB each, written seconds apart, which means something in the save pipeline is writing a huge quantity of state on every save. Likely candidates: the `NPCs` list (serialized per-player in single-player — ~130 alive NPCs with their memories/goals/dialogue history each), or `DungeonFloorStates` (accumulated per-floor room state). Investigation open; this release fixes the "I can't even see my save" symptom. The next release will target the actual bloat.

## Music Shop Instrument Browsing

Two compounding bugs:

**Level-range filter hid low-level instruments.** `BuyInstruments()` filtered the instrument list to `MinLevel <= playerLevel + 30 && MinLevel >= playerLevel - 20`. At Lv.100 that is MinLevel 80 to 130 only. Every instrument below Lv.80 was invisible, so an endgame player shopping for a low-level companion (Melodia recruits at Lv.20 and wants an Old Lute) literally could not browse to the item they wanted. The weapon shop shows everything from Lv.1 up and leans on display-time colouring + purchase-time validation to handle affordability and level requirements, which is the right pattern.

**Boundary pagination silently exited the shop.** Pressing P on page 1 or N on the last page checked for `currentPage > 0` / `currentPage < totalPages - 1` respectively. On failure the code fell through to the int-parse block, which failed to parse "N" or "P" as a number, then hit `currentPage = 0` and returned — kicking the player all the way back to the main shop menu with no message. Unknown input (typos, Enter on an empty prompt) did the same.

Fix:
- Removed the level-range filter. The list now shows every instrument, sorted by `MinLevel` then by `Value`. Items the player cannot afford or cannot equip are already greyed out at display time, and `PurchaseInstrument` enforces class + level at the point of sale.
- Pagination: boundary N / P now stays on the current page instead of falling through. Empty input and unknown input also stay on the current page. Only `Q` (back to shop) and a valid purchase number exit the browser. A successful purchase resets `currentPage` to 0 for next visit.
- `BuyInstrumentByNumber` (the direct-number path from the main shop menu) updated to use the same ordering as the browser so typed numbers continue to line up with the displayed list.

## Discord Live Server Status Channel

New Discord feature on top of the v0.57.13 gossip bridge: a single auto-updating stats embed posted to a designated `#server-status` channel. The message is edited in place every 60 seconds with:

- Online players (level, class, location) — up to 20 shown, with `*...and N more*` footer if the server is busier
- World totals (registered players, total monsters slain, average level, highest level, deepest floor reached)
- Highlights (top player by level, current king, most popular class)
- Server uptime (read from `systemctl show --value -p ActiveEnterTimestamp usurper-mud` so it reflects actual game-server uptime, not bot-reconnect uptime)
- Connection instructions (SSH command, web terminal URL, BBS reference)

Implementation. New env var `DISCORD_STATS_CHANNEL_ID` (separate from the existing `DISCORD_GOSSIP_CHANNEL_ID`) — if unset the feature is skipped silently. On bot ready the bot scans the last 50 messages in the channel looking for its own previous stats message and reuses that ID if found; otherwise posts a fresh one. Self-heals if the message is deleted manually (catches `Unknown Message` on edit and reposts on the next tick). Reuses the existing `getStats()` function (30s cache) so the DB isn't hammered by the 60s timer. Bot only needs `View Channel`, `Send Messages`, `Embed Links`, `Read Message History` on the stats channel — same perm set as the gossip channel, no new OAuth scopes.

Node-side change only — ships via `ssh-proxy.js` and `usurper-web` restart, no game-server binary change needed for this feature.

## Discord `!who` Command and Login / Logout Announcements

Two additions on top of the v0.57.13 gossip bridge, both landing fully in v0.57.14:

**`!who` command in the Discord channel.** Typing `!who` (or `!online`) in `#in-game-gossip` responds with the current list of players in-game — name, level, class, location — pulled directly from the shared `online_players` SQLite table. Same data source as the website live stats feed, so the Discord output always matches what the site shows. Command is intercepted BEFORE the gossip relay path, so it's not mirrored into the game and doesn't count against the per-Discord-user gossip rate limit. `!help` is also handled locally and lists available commands. Everything else continues to relay into `/gos` as before.

Text commands used instead of slash commands because Discord slash commands need the `applications.commands` OAuth scope at bot-invite time, and the existing invite doesn't include it — re-inviting would force every server admin to re-authorize. Text commands work with the already-enabled MessageContent intent and didn't need a re-invite.

**Login / logout announcements.** When a player connects to the online server, `#in-game-gossip` shows an italicised *"PlayerName has entered the world."* line. On disconnect, *"PlayerName has left the world."* Implemented via a new sentinel author `__SYSTEM__` on the existing `discord_gossip` queue — no schema change. C# `DiscordBridge.QueueSystemEvent(message)` wraps `QueueOutbound` with the sentinel; the Node poll detects the sentinel author and renders as italic with no author-bold prefix instead of the standard `**Name** *(in-game)*: message` format.

Wired into `OnlineStateManager.StartOnlineTracking` (fires after `RegisterOnline` succeeds, so the player is actually in `online_players` by the time Discord sees the line) and `OnlineStateManager.Shutdown` (fires before the log line, using a cached `cachedDisplayName` set at login time so the logout line has a proper name rather than the DB username). Identity switches via `SwitchIdentity` do NOT fire events — only real connect/disconnect transitions do.

Both paths are no-ops when the Discord bridge isn't configured (single-player, BBS door mode, unconfigured env vars).

## Files Changed

- `Scripts/Core/GameConfig.cs` — version bump 0.57.13 → 0.57.14.
- `Scripts/Systems/FileSaveBackend.cs` — `GetAllSaves` now resilient: per-file try/catch with filename-metadata fallback, skips `*_autosave_*.json` / `*_backup.json` / `emergency_*.json` from the slot list. New `ReadGameDataByFileNameWithError` returns `(SaveGameData?, string? error)` distinguishing missing file / IO / OOM / JSON parse / version mismatch.
- `Scripts/Systems/SaveSystem.cs` — new `LoadSaveByFileNameWithError` facade method exposing the error-returning path.
- `Scripts/Core/GameEngine.cs` — `LoadSaveByFileName` routes failures through new `ShowLoadFailureWithRecovery` method (full error detail, save folder path, scanned recovery files with numbered options to load backup/autosave/emergency, start-new with overwrite warning, or return to menu).
- `Scripts/Locations/MusicShopLocation.cs` — removed level-range filter from `BuyInstruments`; pagination N/P boundary, empty input, and unknown input now stay on the current page instead of falling through to menu exit; `BuyInstrumentByNumber` reorders to match the browser so typed numbers line up with what's displayed.
- `Scripts/Systems/DiscordBridge.cs` — new `SystemAuthor` constant and `QueueSystemEvent(message)` helper for login/logout/server-event messages using sentinel author `__SYSTEM__`.
- `Scripts/Systems/OnlineStateManager.cs` — new `cachedDisplayName` field; `StartOnlineTracking` queues *"entered the world"* event after `RegisterOnline`; `Shutdown` queues *"left the world"* event before the log line using the cached display name.
- `web/ssh-proxy.js` — (A) `DISCORD_STATS_CHANNEL_ID` env var + live stats channel implementation: `getGameServerStart` reads game-server uptime via `systemctl show`, `formatUptime` produces `NdNhNm` strings, `buildStatsEmbed` assembles the rich embed with online / totals / highlights / uptime / connect-info fields, `initStatsMessage` finds-or-creates on bot ready, `updateStatsChannel` edits in place every 60s with self-heal on deleted message; (B) `!who` / `!online` and `!help` text commands intercepted before gossip relay, with `buildWhoResponse` reading `online_players` table; (C) outbound poll formats `__SYSTEM__`-author messages as italic system lines.
- `/etc/systemd/system/usurper-web.service.d/discord.conf` (server-side config, 600 perms) — appended `Environment="DISCORD_STATS_CHANNEL_ID=<channel id>"`.

## Deploy Notes

Game binary (linux-x64 tarball → `/opt/usurper`, restart `usurper-mud` + `sshd-usurper`): ships the resilient save listing, load-path recovery UI, Music Shop browser fixes, and the C# side of Discord login/logout announcements.

Node file (`scp web/ssh-proxy.js` → `/opt/usurper/web/ssh-proxy.js`, restart `usurper-web`): ships the Discord stats channel and the `!who`/`!help` commands. Can be deployed independently of the game binary (and was, incrementally, during 0.57.14 development) because the two sides communicate only through the `discord_gossip` SQLite table and are loosely coupled.

New `DISCORD_STATS_CHANNEL_ID` environment variable on the `usurper-web` service is optional — bot skips the feature silently if unset. Bot also needs `View Channel`, `Send Messages`, `Embed Links`, `Read Message History` permissions on the stats channel (same four as the gossip channel).
