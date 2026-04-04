# Usurper Reborn v0.53.13 Release Notes

**Version Name:** Ancestral Spirits (Beta Hardening)

## Trade Item Data Loss Fix

When a player sent items via the trade system and the recipient declined, cancelled, or let the offer expire, the items vanished. Only gold was being returned — items were permanently lost.

**Root cause:** The decline, cancel, and expiry code paths in the trade system only returned gold via `AddGoldToPlayer()`. The item JSON was stored in the database but never deserialized and returned to the sender's inventory.

**Fix:** All three trade resolution paths (decline, cancel, expiry) now return items to the sender. For online players who may be offline when their trade is declined/expired, a new `AddItemsToPlayerSave()` method safely merges returned items into their saved inventory via JSON manipulation.

## Save Data Persistence Fix

Five daily-reset properties were never serialized, causing them to reset to defaults on every login:

- **DrinksLeft** — Tavern drink counter reset on logout
- **PrisonsLeft** — King imprisonment limit reset on logout
- **ExecuteLeft** — King execution limit reset on logout
- **QuestsLeft** — Quest board daily limit reset on logout
- **PrisonActivitiesToday** — Prison activity counter reset on logout

All five are now properly serialized, saved, and restored on load.

## Combat Engine Crash Prevention

Three `.First()` LINQ calls in the combat engine could throw `InvalidOperationException` if their source collections were empty:

- PvP AI ability selection
- Healer AI doom dispel target selection
- Healer AI corruption cleanse target selection

All changed to `.FirstOrDefault()` with null guards for defense-in-depth.

## Server Stability Improvements

**Fire-and-forget connection handling:** The MUD server's connection handler was called as a fire-and-forget task (`_ = HandleConnectionAsync()`). If the handler threw an unexpected exception, it was silently swallowed — no logging, no cleanup. Now wrapped with try/catch and logged via DebugLogger.

**Exception logging in hot paths:** 22 empty catch blocks in the four highest-traffic files (CombatEngine, GameEngine, BaseLocation, DungeonLocation) now log exceptions to the debug log. Previously these silently swallowed errors, making post-mortem debugging impossible.

## Localization Sync

Added missing `combat.loot_displaced_to_player` key to Spanish, Hungarian, Italian, and French. All 5 language files are now fully synced at 16,769 keys.

## Test Suite Expansion

98 new automated tests (469 → 567 total):

**CombatEngineTests** (49 tests): Combat result data structures, boss phase transitions (including per-boss custom thresholds), monster combat state, player combat properties, combat action types, and MonsterGenerator integration.

**SaveRoundTripTests** (49 tests): Comprehensive serialization round-trip coverage for all daily-reset properties, combat buff counters, herb inventory, login streaks, weekly rankings, Blood Moon state, home upgrades, immortal/god system, faction consumables, prison state, diseases, equipped items, inventory, preferences, team XP distribution, chest contents, and a full "all daily reset" property sweep.

---

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.53.13
- `Scripts/Core/GameEngine.cs` — Restore 5 daily counter properties on load; logging added to 10 empty catch blocks
- `Scripts/Systems/SaveDataStructures.cs` — Added DrinksLeft, PrisonsLeft, ExecuteLeft, QuestsLeft, PrisonActivitiesToday to PlayerData
- `Scripts/Systems/SaveSystem.cs` — Serialize/deserialize 5 new daily counter fields
- `Scripts/Systems/CombatEngine.cs` — `.First()` → `.FirstOrDefault()` with null guards (3 sites); logging added to 4 empty catch blocks
- `Scripts/Systems/SqlSaveBackend.cs` — New `AddItemsToPlayerSave()` method for returning trade items to offline players; trade expiry now returns items + gold
- `Scripts/Locations/BaseLocation.cs` — Trade decline/cancel now returns items to sender; logging added to 10 empty catch blocks
- `Scripts/Locations/DungeonLocation.cs` — Logging added to 5 empty catch blocks
- `Scripts/Server/MudServer.cs` — `HandleConnectionAsync` fire-and-forget wrapped with try/catch + logging
- `Localization/es.json` — Added `combat.loot_displaced_to_player`
- `Localization/hu.json` — Added `combat.loot_displaced_to_player`
- `Localization/it.json` — Added `combat.loot_displaced_to_player`
- `Localization/fr.json` — Added `combat.loot_displaced_to_player`
- `Tests/CombatEngineTests.cs` — **NEW** — 49 combat engine smoke tests
- `Tests/SaveRoundTripTests.cs` — **NEW** — 49 save serialization round-trip tests
