# v0.54.2 - Bug Fixes & Server Stability

## NPC World Reset Prevention

The online server's NPC population was periodically resetting — all NPCs dropped to level 5-10, player team assignments were lost, and the world had to rebuild from scratch. Root cause: when a MysticShaman NPC existed in the database (from children coming of age as Troll/Orc/Gnoll), deserializing their class enum triggered a `KeyNotFoundException` during world state loading. The catch block called `ForceReinitializeNPCs()`, wiping the entire NPC population.

- **LoadWorldState catch block no longer wipes NPCs** — if NPCs already exist in memory, they are kept despite the load error. Fresh initialization only happens as a last resort when zero NPCs exist.
- **Per-NPC error handling in RestoreNPCsFromData** — one bad NPC is now skipped with a detailed error log (including stack trace) instead of killing the entire 120+ NPC restore. The skipped count is logged.
- **TolerantEnumReadOnlyConverterFactory** — new JSON converter that reads enums tolerantly (handles both string and numeric values without throwing) but writes as numeric values for dashboard/API compatibility. Applied to both WorldSimService and OnlineStateManager serializers.
- **Online mode NPC level diversity** — if NPCs are ever regenerated fresh in online mode, they now span levels 1-80 instead of all spawning at template defaults (level 5-10). Previously, the level diversity randomization only ran in single-player mode.

## Companion & Party Equipment Persistence

Companion equipment (Lyris, Aldric, Mira, Vex) and NPC party member equipment kept disappearing after logout or disconnect. Four missing save points were identified and fixed:

- **InnLocation.ManageCompanionEquipment** — had `AutoSave` but was missing `SaveAllSharedState` for online mode, so companion equipment changes at the Inn were not persisted to shared world state.
- **InnLocation.CompanionEquipBestGear** — missing both `ResetAutoSaveThrottle` (rapid equips got throttled and skipped) and `SaveAllSharedState`.
- **CombatEngine companion loot auto-pickup (2 paths)** — when a companion/NPC auto-picks up loot that the player passed on, `SyncCompanionEquipment` was called but no save was triggered. Epic loot picked up by companions was lost on disconnect. Both the player-pass and follower-pass code paths now fire an immediate background save.

## Arena Dungeon Event XP Reset Fix

The random arena portal encounter in dungeons created a new CombatEngine and ran solo combat (no teammates). The `HandleVictory` XP distribution logic detected "no teammates" and reset `TeamXPPercent[0]` to 100% while zeroing all teammate slots. When the player returned to dungeon combat with their actual party, all XP distribution settings were wiped. Fix: `TeamXPPercent` is now saved and restored around the arena solo fight.

## Duplicate Ring Equip Fix

Buying two identical rings from Ravanella's Magic Shop and equipping both caused one to disappear. Both rings shared the same equipment database ID, and the duplicate-ID guard in `EquipItem`/`RecalculateStats` removed the second one. Fix: when equipping an item whose ID is already equipped in another slot, a clone with a fresh dynamic ID is created via `Equipment.Clone()` + `EquipmentDatabase.RegisterDynamic()`.

## Dashboard NPC Class/Race Display Fix

The admin dashboard NPC directory showed `?` for all NPC class and race fields. The SSE snapshot format (used for real-time dashboard updates) was missing `class` and `race` fields — it had the mapping tables (`CLASS_NAMES`, `RACE_NAMES`) but never included the data to map. Added to both the periodic snapshot and initial SSE connection snapshot.

## Quick Commands Help Fix

The `/stats` alias was shown as `/s` and `/inventory` as `/i` in the quick commands help menu. In online mode, `/s` is intercepted by the `/say` chat command, so typing `/s` opened chat instead of stats. Help now shows `%` and `*` (the single-key shortcuts that always work) as the aliases instead.

## Team Quit / Dissolution Fix

Quitting a team as the sole member left a ghost team with 1 member in the database. Root cause: `UpdatePlayerTeamMemberCount` counted players by querying `player_data` in the database, but the quitting player's save data hadn't been written yet — so the SQL query still found them in the team. Fix: save player data to DB before counting, then explicitly check for zero players AND zero NPCs and delete the team record if empty.

## Security & Thread Safety

- **SQL injection fix** — 2 interpolated SQL values in SqlSaveBackend parameterized: `PruneCombatEvents` days parameter and `UpdateTeamWarScore` column selection (now uses two hardcoded query strings instead of string-interpolated column name).
- **Thread-safe Random** — `NPCSpawnSystem.random` changed from `new Random()` to `Random.Shared` for safe use in the multithreaded MUD server context.

## Server Log Watcher

New persistent log watcher agent (`usurper-log-watcher.service`) monitors `debug.log` for `[ERR]` level entries and sends instant Discord notifications with color-coded embeds. Features 5-minute dedup cooldown per unique error signature, service crash detection, and automatic log rotation handling.

---

### Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.54.2
- `Scripts/Systems/WorldSimService.cs` — LoadWorldState catch block no longer wipes NPCs; per-NPC error handling with skip+log in RestoreNPCsFromData; TolerantEnumReadOnlyConverterFactory in jsonOptions
- `Scripts/Systems/OnlineStateManager.cs` — TolerantEnumReadOnlyConverterFactory in jsonOptions
- `Scripts/Utils/TolerantEnumConverter.cs` — New TolerantEnumReadOnlyConverterFactory, TolerantEnumNumericConverter, NullableTolerantEnumNumericConverter (reads tolerantly, writes as numbers)
- `Scripts/Systems/NPCSpawnSystem.cs` — Level diversity randomization now applies to online mode (removed `!IsOnlineMode` guard)
- `Scripts/Locations/InnLocation.cs` — SaveAllSharedState after ManageCompanionEquipment and CompanionEquipBestGear; ResetAutoSaveThrottle before EquipBest save
- `Scripts/Systems/CombatEngine.cs` — Background save after companion loot auto-pickup (2 code paths: player-pass and follower-pass)
- `Scripts/Systems/RareEncounters.cs` — Arena portal encounter saves/restores TeamXPPercent around solo combat
- `Scripts/Locations/MagicShopLocation.cs` — Duplicate ring fix: clone + RegisterDynamic when equipping item already in another slot
- `web/ssh-proxy.js` — Added class and race fields to both SSE NPC snapshot locations
- `Scripts/Locations/BaseLocation.cs` — Quick commands help shows `%`/`*` instead of conflicting `/s`/`/i` aliases (both visual and SR versions)
- `Scripts/Systems/SqlSaveBackend.cs` — Parameterized 2 SQL injection sites (PruneCombatEvents days, UpdateTeamWarScore column)
- `Scripts/Systems/NPCSpawnSystem.cs` — `new Random()` → `Random.Shared` for thread safety
- `Scripts/Locations/TeamCornerLocation.cs` — Save player data before UpdatePlayerTeamMemberCount; delete team when 0 players + 0 NPCs remain
- `scripts-server/log-watcher.sh` — **NEW** — Log watcher agent with Discord webhook notifications
- `scripts-server/usurper-log-watcher.service` — **NEW** — Systemd service for log watcher
