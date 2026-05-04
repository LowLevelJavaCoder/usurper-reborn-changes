# v0.60.7 -- Beta

Hotfix release on top of v0.60.6. One critical security fix (cross-player save deletion via a hidden Main Street command), two new admin features for self-hosted MUD servers (server-wide permadeath / resurrection controls + a schema-driven web admin Server Settings panel), and a one-line cleanup removing the dormant alpha-era "Erased by Rage" admin panel.

---

## SECURITY: cross-player save deletion via hidden Main Street command

Same reporter who flagged the v0.60.5 trusted-AUTH bypass also flagged this one: typing the bare word `settings` or `config` from the Main Street prompt (with no leading slash, no menu hint, no documentation) opened a hidden "SETTINGS & SAVE OPTIONS" menu. The menu exposed all-players save management: Load Different Save, **Delete Save Files**, View Save File Information, Force Daily Reset, Change Daily Cycle Mode. In MUD / online mode, any non-admin user could use this to delete the admin's save file (or any other player's save).

Reporter's repro: in MUD mode with `--mud-server --mud-port 4001 --admin admin`, register a regular user account. Type `settings` or `config` from Main Street as that non-admin user. Pick "Delete Save Files." Pick the admin's save. It's gone.

Root cause: the menu was originally a single-player save-management UI from the desktop / standalone build. When MUD mode was added, the bare-word handler for these commands was never gated -- it stayed reachable globally. The visible `[~] Settings` hotkey on Main Street routes to the SAFE per-player preferences (`ShowPreferencesMenu` in BaseLocation: combat speed, auto-heal, intimate scenes), which is the only thing players ever needed from "settings." The dangerous all-players menu had no visible entry point at all -- only the hidden bare-word command, which functioned as an undocumented backdoor.

A v0.60.6 attempt removed the bare-word `settings` / `set` cases from `BaseLocation.cs` but missed the duplicate override in `MainStreetLocation.cs` -- the reporter retested on the live server post-deploy and showed the menu still opening via `config`.

### Fix

The dangerous menu and all of its helper methods are deleted entirely from `MainStreetLocation.cs` (594 lines removed). No more code path can reach the all-players save-management UI from any context. The `[~]` hotkey continues to work and routes to the safe per-player preferences as before.

What this changes for legitimate users:

- Single-player save management (Save Game Now, Load Different Save, Delete Save Files, etc.) is no longer reachable from the in-game Main Street menu. Players who want to manage saves should use the standalone editor (`UsurperReborn --editor`, or `[G] Game Editor` from the title screen) which has the same functionality with a proper UI and is single-player only by design.
- Force Daily Reset and Change Daily Cycle Mode are no longer reachable from the Main Street menu. Sysops who need these can still toggle them via the SysOp Console in BBS mode, the admin dashboard in MUD mode, or directly via DailySystemManager API for code-level access.
- The visible `[~]` hotkey for per-player preferences (combat speed, auto-heal, etc.) is unchanged.

Files: `Scripts/Locations/MainStreetLocation.cs` (the bare-word case block + `ShowSettingsMenu` + `ShowGamePreferences` + `ChangeCombatSpeed` + `ChangeDailyCycleMode` + `ConfigureAutoSave` + `SaveGameNow` + `LoadDifferentSave` + `DeleteSaveFiles` + `ViewSaveFileInfo` + `ForceDailyReset` + `GetDailyCycleModeDescription` all removed; -594 lines).

---

## Admin: server-wide resurrection / permadeath controls

Sysops running their own MUD server now have two new knobs in the Online Admin Console under `[R] Resurrection / Permadeath Settings`:

1. **Starting Resurrections** (default 3, range 0-99). How many free deaths each NEW character gets before permadeath fires. Setting it to 0 means one death equals permadeath. Existing characters keep their current Resurrections counter unchanged -- this only affects characters created after the change.

2. **Online Permadeath ENABLED / DISABLED** (default ENABLED). Master switch for the whole online death model:
   - **Enabled (default):** Each death consumes one resurrection. At zero, the next death erases the character permanently with a server-wide red broadcast and a news entry. This is the live-server beta default.
   - **Disabled:** Online deaths route through the legacy single-player penalty menu (Temple, Deal with Death, Accept Fate). The Resurrections counter is no longer consulted; no character is ever erased regardless of how many times they die. This is "softcore" mode for sysops who want a more forgiving server.

Both settings persist in a new `server_config` SQLite table (`key TEXT PRIMARY KEY, value TEXT, updated_at, updated_by`) and are auto-loaded into the matching `GameConfig` static at backend startup, so admin choices survive restart and are in effect by the time the first session connects.

The admin UI shows the current values, prompts for confirmation on the permadeath toggle (since flipping it changes how every player's next death plays out), and writes an `ADMIN` debug log line + `updated_by` audit column on every change.

### Files

- `Scripts/Core/GameConfig.cs` -- new `DefaultStartingResurrections` and `OnlinePermadeathEnabled` statics with documentation comments.
- `Scripts/Systems/SqlSaveBackend.cs` -- new `server_config` table in the schema; new `LoadServerConfigIntoGameConfig` (runs in constructor after `InitializeDatabase`); new `ApplyServerConfigToGameConfig` (key->static mapping); new `GetServerConfig` / `SetServerConfig` API.
- `Scripts/Systems/CharacterCreationSystem.cs` -- `Resurrections` and `MaxResurrections` initialised from `GameConfig.DefaultStartingResurrections` on every new character.
- `Scripts/Systems/CombatEngine.cs` -- the `isOnlinePermadeathMode` gate in `HandlePlayerDeath` now ANDs `GameConfig.OnlinePermadeathEnabled`. When disabled, the permadeath path is never entered and the existing single-player penalty menu (`PresentResurrectionChoices` -> Temple / Deal / Accept) handles online deaths instead.
- `Scripts/Systems/PermadeathHelper.cs` -- `HandleOnlineDeath` short-circuits to a full-heal revive when `OnlinePermadeathEnabled == false`. Covers the non-combat death paths (location hazards, system-initiated deaths) that don't have a penalty menu of their own.
- `Scripts/Systems/OnlineAdminConsole.cs` -- new `[R] Resurrection / Permadeath Settings` menu entry under GAME SETTINGS; new `EditResurrectionSettings()` method.

### Schema migration

`server_config` is created via `CREATE TABLE IF NOT EXISTS` on first startup post-deploy. No manual SQL needed. Empty table on first boot means both settings stay at their `GameConfig` defaults (3 resurrections, permadeath enabled).

---

## Server Settings panel in the admin web UI (Phase 1)

A new "Server Settings" section on the admin dashboard exposes 9 admin-tunable settings, grouped by category, with per-row Save buttons. Changes persist in SQLite and apply to the running game within ~1 second -- no restart required.

### What's tunable in Phase 1

**Death**
- `default_starting_resurrections` (int, 0-99) -- same setting exposed by the in-game admin console above. Either path can edit it.
- `online_permadeath_enabled` (bool) -- same setting exposed by the in-game admin console above.

**Difficulty**
- `xp_multiplier` (float, 0.1-10.0): global multiplier on every XP award.
- `gold_multiplier` (float, 0.1-10.0): global multiplier on every gold award.
- `monster_hp_multiplier` (float, 0.1-10.0): global multiplier on monster HP.
- `monster_damage_multiplier` (float, 0.1-10.0): global multiplier on monster-to-player damage.

**Access**
- `disable_online_play` (bool): emergency kill switch for the desktop / Steam Online Play menu.
- `idle_timeout_minutes` (int, 1-60): disconnect threshold for idle sessions.

**Communication**
- `motd` (string, max 500 chars): Message of the Day shown to every player at session start.

### Architecture

Schema-driven so adding a new tunable in future releases is a 5-line descriptor in `ServerSettingsRegistry`, not a per-setting form field. The full pipeline:

1. **`Scripts/Systems/ServerSettingsRegistry.cs`** -- single source of truth. Each setting is a `ServerSettingDescriptor` carrying its key, type, default, validation bounds, description, change-impact note, current-value getter, and apply action. The registry is enumerated to render the form, validate writes, and route values into GameConfig.
2. **`server_config_schema` SQLite table** -- single-row JSON blob written by the C# game on startup. The web admin reads this to build the form, so the schema is always in sync with the binary.
3. **`server_config` SQLite table** -- the persistent backing store, introduced earlier in this release for the resurrection / permadeath settings; now holds all 10.
4. **`server_config_apply_queue` SQLite table** -- the bridge between the web process (which can't reach the running game's in-memory `GameConfig` statics) and the running game. Web POSTs queue a row; the game polls every 1 second and applies via the registry.
5. **Web API**: `GET /api/admin/server-settings` returns schema + current values; `POST /api/admin/server-settings/:key` validates against the descriptor's bounds before queuing the write.
6. **Web UI**: schema-rendered form. Bool settings get a select; Int/Float get number inputs with HTML5 min/max; String gets a text input with maxlength. Each row has its own Save button (one mistake doesn't trash everything), shows the current value, last-changed metadata, description, and change-impact note. The whole panel refreshes on the dashboard's 30s cycle.

### What's NOT in Phase 1 (deferred)

- PvP master switch, max murders/day, bot detection thresholds, Blood Moon frequency, daily quest limit, world boss spawn cooldown, news feed pruning, chat slowmode, max characters per account. These are easy 5-line additions for Phase 2 once Phase 1 is proven.
- NG+ multipliers, allowed-races/classes lists, faction enable/disable, individual class balance knobs, individual race lifespans. These directly affect game balance and want validation beyond simple range checks; Phase 3 territory.

Files: `Scripts/Systems/ServerSettingsRegistry.cs` (new), `Scripts/Systems/SqlSaveBackend.cs` (`server_config_schema` and `server_config_apply_queue` tables, `PublishServerSettingsSchema`, `DrainServerConfigApplyQueue`), `Scripts/Server/MudServer.cs` (`ServerSettingsApplyLoopAsync` 1s poller), `web/ssh-proxy.js` (`/api/admin/server-settings` GET/POST endpoints with descriptor-side validation), `web/admin.html` (new Server Settings section, `refreshServerSettings`, `renderSettingRow`, `saveServerSetting` functions).

---

## Removed: "Erased by Rage" admin panel (alpha-era event cleanup)

The `Erased by Rage` overview card and victims-list panel on the admin dashboard were specific to a one-time alpha-era cinematic memorial event. The event is over and the dashboard surface is no longer relevant. Removed from `web/admin.html` (overview-cards conditional, hidden victims-list section) and from the supporting query in `web/ssh-proxy.js` (the `rageEvent` payload field on `getAdminOverview`). The C# `RageEventSystem` itself remains -- it's still a sysop-invocable wizard command if you ever want to fire it again -- only the dashboard surface for it is gone.

Files: `web/admin.html`, `web/ssh-proxy.js`.

---

## Removed: Player Locations map (didn't work anyway)

The "Player Locations" world-map panel on the admin dashboard relied on `ip-api.com` to resolve player IPs to lat/lng/country. In practice nearly every connection on the live server hit the dashboard via the SSH gateway or the web terminal -- both of which arrive at the game from `127.0.0.1` and were filtered out before geolocation. The panel was almost always empty, the third-party API call ran on every refresh anyway, and the Leaflet bundle was downloaded on every admin page load.

Removed: the panel HTML, the `initMap` / `refreshPlayerMap` JS (~70 lines), the dark-theme Leaflet CSS overrides, the Leaflet CDN script + stylesheet, the dashboard refresh wiring, and the server-side `/api/admin/geolocate` endpoint (~55 lines, including the `ip-api.com` POST). Net: smaller admin page, faster refresh cycle, one fewer external dependency.

Files: `web/admin.html`, `web/ssh-proxy.js`.

---

## Bug fix: Resurrections going negative when permadeath disabled

Player report after the v0.60.7 admin permadeath toggle landed: turning off permadeath via the web admin caused deaths to keep decrementing the Resurrections counter into negative territory ("Resurrections remaining: -1 of 3") instead of routing to the legacy Temple / Deal with Death / Accept Fate menu.

Root cause: `CombatEngine.HandlePlayerDeath` had an early-out shortcut from the v0.60.0 beta launch -- "in online mode, just auto-consume one resurrection, skip the legacy menu, that's the whole death model." The v0.60.7 change to `HandleExcessiveDeathsPermadeath` (the permadeath path) was correctly gated on `GameConfig.OnlinePermadeathEnabled`, but the auto-consume shortcut below it was still keying on `IsOnlineMode` alone. With permadeath disabled, the permadeath gate above let the death pass through; the unconditional online-mode shortcut then auto-decremented even when Resurrections was already 0.

Fix: the online-mode shortcut now also checks `GameConfig.OnlinePermadeathEnabled`. When permadeath is OFF, the shortcut is also OFF, and the death falls through to `PresentResurrectionChoices` (the legacy menu: Divine Intervention / Temple Resurrection / Deal with Death / Accept Fate). Defensive clamp at zero so even if some other path tries to go negative, the displayed counter never reads as a negative number again.

Bonus: the hardcoded "of 3" display in both `CombatEngine` and `PermadeathHelper` now reads `MaxResurrections` so it correctly reflects the admin-set starting count (was misleading once an admin changed the default from 3).

Files: `Scripts/Systems/CombatEngine.cs`, `Scripts/Systems/PermadeathHelper.cs`.

---

## Bug fix: web admin MOTD overwritten by SysOpConfig file on session init

Player report after the Server Settings panel landed: setting the MOTD via the web admin persisted in SQLite, but MUD players never saw it -- only the hardcoded red beta box rendered.

Root cause: `InitializeGame` runs `SysOpConfigSystem.LoadConfig()` on the first session per process. That reads `/var/usurper/sysop_config.json` (a leftover from the BBS-mode file-based config) and overwrites `GameConfig.MessageOfTheDay` from the file's value -- which was an empty string. The web admin write set the SQLite row correctly, the registry's apply path set the in-memory MOTD correctly at backend startup, then `SysOpConfigSystem.LoadConfig` immediately wiped the in-memory value back to empty on the first session init. Player connects, MOTD check sees empty, doesn't print it, only the red banner box renders.

Fix: `SysOpConfigSystem.LoadConfig()` and `SaveConfig()` both early-return in MUD/online mode. The file-based config system is BBS-only; MUD uses the SQLite-backed `server_config` table via the registry as the single source of truth. No more split-source-of-truth where the SQLite write applies fine but the file load wipes it on the next session init.

Files: `Scripts/Systems/SysOpConfigSystem.cs`.

---

## Bug fixes: server settings audit (idle timeout, max dungeon level, monster damage description)

After the Server Settings panel went live, audit confirmed 5 of 7 settings were wired correctly to actually do what their descriptions promised. Two were broken; one had a misleading description; and one (max dungeon level) was wired correctly but turned out to be a footgun and was removed from the panel entirely:

- **`idle_timeout_minutes`:** broken on the MUD server. `MudServer.IdleTimeout` was a `static readonly TimeSpan` baked in at process start at 15 minutes; the watchdog disconnector read this constant, not `DoorMode.IdleTimeoutMinutes`. Setting only affected the BBS terminal warning. **Fixed:** converted to a getter that reads `DoorMode.IdleTimeoutMinutes` live, so admin changes take effect on the next 30s watchdog tick.
- **`max_dungeon_level`:** wiring fix shipped (`DungeonLocation.maxDungeonLevel` was its own hardcoded private field; converted to a property reading `GameConfig.MaxDungeonLevel` live), then the entire descriptor was **removed from the web admin panel**. Capping below 100 breaks the 7 Old God boss floors (25/40/55/70/85/95/100), the 7 Ancient Seals on specific floors, and the True / Conqueror ending sequence at floor 100. The field remains in `GameConfig` for BBS sysops who tune it via the file-based SysOpConfig (where breaking story content is at least an opt-in choice with a config file edit), but it's no longer surfaced as a one-click web-admin knob.
- **`monster_damage_multiplier`:** descriptor was misleading. `DifficultySystem.ApplyMonsterDamageMultiplier` IS used for monster basic attacks (CombatEngine.cs:4388, 17823), but monster special abilities (DirectDamage, life drain, AoE) bypass it and use raw damage. The descriptor said "every damage roll a monster makes against the player" which over-promised. **Fixed:** descriptor description rewritten to accurately scope to "monster basic-attack damage rolls" with an explicit note about what's not covered.

Net Phase 1 web-admin settings count: **9** (Death: 2, Difficulty: 4, Access: 2, Communication: 1).

Files: `Scripts/Server/MudServer.cs`, `Scripts/Locations/DungeonLocation.cs`, `Scripts/Systems/ServerSettingsRegistry.cs`.

---

## Files Changed

### New SQLite schema additions
- `server_config` table (key/value/updated_at/updated_by, created via `CREATE TABLE IF NOT EXISTS`)
- `server_config_schema` table (single-row JSON of the registry, re-published on every game startup)
- `server_config_apply_queue` table (web -> game bridge for live setting changes)

### Modified files (game)
- `Scripts/Core/Character.cs` -- documentation updated on `MaxResurrections` field.
- `Scripts/Core/GameConfig.cs` -- version bump to 0.60.7; new `DefaultStartingResurrections` and `OnlinePermadeathEnabled` statics.
- `Scripts/Locations/DungeonLocation.cs` -- `maxDungeonLevel` field converted to a property reading `GameConfig.MaxDungeonLevel` live (fixes admin-tunable max dungeon level not actually capping); hardcoded `100` in portal-deeper teleport replaced with `GameConfig.MaxDungeonLevel`.
- `Scripts/Locations/MainStreetLocation.cs` -- removed bare-word `SETTINGS` / `CONFIG` backdoor case + entire `ShowSettingsMenu` and 10 helper methods (594 lines). Closes the cross-player save-deletion vector.
- `Scripts/Server/MudServer.cs` -- new `ServerSettingsApplyLoopAsync` 1s poller for the web admin apply queue. `IdleTimeout` converted from `static readonly TimeSpan` to a getter reading `DoorMode.IdleTimeoutMinutes` live (fixes admin-tunable idle timeout not actually disconnecting on the new boundary).
- `Scripts/Systems/CharacterCreationSystem.cs` -- `Resurrections` and `MaxResurrections` initialised from `GameConfig.DefaultStartingResurrections`.
- `Scripts/Systems/CombatEngine.cs` -- `isOnlinePermadeathMode` gate in `HandlePlayerDeath` ANDs `GameConfig.OnlinePermadeathEnabled`. The online-mode auto-consume shortcut also gated on `OnlinePermadeathEnabled` so deaths fall through to the legacy menu when permadeath is off (fixes resurrections going negative bug). Defensive zero-clamp + hardcoded "of 3" replaced with `MaxResurrections`.
- `Scripts/Systems/OnlineAdminConsole.cs` -- new `[R]` menu entry + `EditResurrectionSettings()` method.
- `Scripts/Systems/PermadeathHelper.cs` -- `HandleOnlineDeath` short-circuits to soft revive when permadeath disabled. Hardcoded "of 3" replaced with `MaxResurrections`.
- `Scripts/Systems/ServerSettingsRegistry.cs` (NEW) -- schema-driven registry of admin-tunable settings; descriptor type, validation, apply routing. `monster_damage_multiplier` description rewritten to honestly scope to basic-attack rolls.
- `Scripts/Systems/SqlSaveBackend.cs` -- `server_config` / `server_config_schema` / `server_config_apply_queue` tables; `LoadServerConfigIntoGameConfig`, `ApplyServerConfigToGameConfig` (now routes through registry), `GetServerConfig`, `SetServerConfig`, `PublishServerSettingsSchema`, `DrainServerConfigApplyQueue`.
- `Scripts/Systems/SysOpConfigSystem.cs` -- `LoadConfig` and `SaveConfig` early-return in MUD/online mode so the file-based config stops overwriting registry-managed values on every session init.

### Modified files (web)
- `web/admin.html` -- new Server Settings section + `refreshServerSettings` / `renderSettingRow` / `saveServerSetting` functions. Removed alpha-era Rage event card and victims-list panel. Removed Player Locations map (HTML, ~70 lines of map JS, dark-theme Leaflet CSS, and the Leaflet CDN includes).
- `web/ssh-proxy.js` -- new `GET` and `POST` `/api/admin/server-settings` endpoints with descriptor-side validation. Removed `rageEvent` query and payload field from `getAdminOverview`. Removed `/api/admin/geolocate` endpoint (~55 lines, including the third-party `ip-api.com` POST).

---

## Deploy notes

- Standard recipe: publish linux-x64, tar, scp, restart `usurper-mud` and `sshd-usurper`. Web service unchanged.
- The new `server_config` table is auto-created via `CREATE TABLE IF NOT EXISTS` on first MUD-server startup post-deploy. No manual SQL needed.
- Existing player Resurrections counters are untouched; only NEW characters use the admin-set starting count.
- Default behaviour matches v0.60.6: 3 starting resurrections, permadeath enabled. The new admin controls only kick in when the sysop explicitly changes them.

---

## Credits

- Reporter who diagnosed the cross-player save deletion vector and tested both the v0.60.6 attempted fix and the v0.60.7 actual fix on the live server. Same reporter as the v0.60.5 trusted-AUTH disclosure. Thanks for the persistence and responsible disclosure.
