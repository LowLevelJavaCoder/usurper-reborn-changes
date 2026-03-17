# Usurper Reborn v0.52.12 Release Notes

**Release Date:** March 17, 2026
**Version Name:** The Hook

## Online Mode Daily Reset Banner Fix

The "ENDLESS ADVENTURE CONTINUES!" banner with "Endless mode: Time flows differently here..." was displaying to online multiplayer players on every daily reset. This was a single-player feature leaking into online mode — the default `DailyCycleMode` is `Endless`, and the guard that was supposed to prevent Endless resets (`!DoorMode.IsOnlineMode && ...`) only blocked them in single-player, allowing online mode to fall through and show the full Endless reset sequence including the banner and `ProcessEndlessReset()`.

Online mode now performs silent daily resets — counter refreshes and maintenance run without any banner or mode-specific processing. The MUD server's world sim handles world-level resets independently.

---

## Home Menu Label Fix

Shortened "Master Craftsman's Renovations" to just "Renovations" in all languages. The long label was breaking the fixed-width 3-column menu grid at Home, causing column misalignment.

---

## Companion HP Equipment Bug Fix

Companions were starting with less than full HP on dungeon entry, login/logout, and after healing. `CompanionSystem` used `companion.BaseStats.HP` (base HP without equipment) everywhere instead of computing the actual MaxHP with Constitution bonuses from gear. Added `GetCompanionMaxHP()` helper that builds a temporary Character wrapper with equipment and calls `RecalculateStats()` to get the true MaxHP. Fixed 7 call sites in CompanionSystem plus display bugs in Inn and Dungeon companion HP readouts.

---

## Multi-Target Spell Target Prompt Fix

Wavecaller's Restorative Tide (party heal) and Tidecall Barrier (party AC buff) incorrectly prompted for a single target despite being `IsMultiTarget` spells that affect the entire party. The quickbar spell handler now checks `IsMultiTarget` and skips the target selection prompt for area buff/heal spells.

---

## Monster Ability Display Fix

When monsters used abilities like CriticalStrike against companions, the damage message showed the raw enum name ("takes 574 damage from CriticalStrike!") instead of clean text. The ability's descriptive message (e.g. "lands a critical strike!") already displays above the damage line, so the damage message now just says "takes X damage!" without the redundant raw ability name.

---

## Group Combat Victory Markup Fix

Group dungeon followers saw raw markup tags in victory messages (e.g. `[bright_green]Triple kill![/]` instead of colored text). The victory messages had embedded markup that rendered on the leader's terminal but passed through as literal text when broadcast to followers via ANSI. Removed embedded markup from `CombatMessages.GetVictoryMessage()` — callers already handle coloring.

---

## Group Loot Distribution Overhaul

When a player passed on loot in group dungeons, the item was offered to other human players first (with a 30-second timeout each), then NPCs. This caused the leader to sit waiting for timeouts even when the follower had already moved on. Reversed the priority: NPC/companion auto-pickup now happens first (instant evaluation), and only if no NPC wants the item does it get offered to other human players. Cascade offer timeout reduced from 30 seconds to 10 seconds.

---

## Team System Bug Fixes

Team Corner audit: `SackMember()` and `ChangeTeamPassword()` were missing `SaveAllSharedState()` calls, so NPC team removal and password changes would revert on world-sim reload in online mode. Removed unreachable duplicate case "!" (Resurrect) in ProcessChoice. All `new Random()` replaced with `Random.Shared` across TeamCornerLocation and TeamSystem (5 instances).

---

## Group Reward Fairness Fix

Group dungeon followers were missing several XP multipliers that the leader received — Blood Moon, Child XP bonus, Study/Library, Settlement Tavern/Library, Guild XP bonus, and HQ Training bonus were all skipped in the follower XP calculation path. Followers now receive the same set of multipliers as the leader, calculated independently per player. Gold distribution also fixed: was splitting raw base gold among players while the leader kept fully-multiplied gold, causing the leader to retain more than their fair share.

---

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.52.12
- `Scripts/Systems/DailySystemManager.cs` — Online mode daily reset skips display banner and mode-specific processing; single-player path unchanged
- `Scripts/Systems/CompanionSystem.cs` — `GetCompanionMaxHP()` helper; fixed 7 `BaseStats.HP` references in `GetCompanionsAsCharacters()`, `DamageCompanion()`, `HealCompanion()`, `GetCompanionHP()`, `RestoreCompanionHP()`, and level-up
- `Scripts/Systems/CombatEngine.cs` — Multi-target spell skip target prompt; monster ability display fix; group loot NPC-first priority; cascade timeout 30s→10s; group follower XP multiplier parity (Blood Moon, Child, Study, Settlement, Guild, HQ Training); gold distribution uses post-multiplier amount
- `Scripts/Systems/CombatMessages.cs` — Removed markup tags from `GetVictoryMessage()`
- `Scripts/Systems/TeamSystem.cs` — `new Random()` → `Random.Shared` (4 instances)
- `Scripts/Locations/TeamCornerLocation.cs` — `SaveAllSharedState()` after SackMember and ChangeTeamPassword; removed dead duplicate case "!"; `new Random()` → `Random.Shared`
- `Scripts/Locations/InnLocation.cs` — Companion summary uses `GetCompanionMaxHP()` for display
- `Scripts/Locations/DungeonLocation.cs` — Party HP readout uses `GetCompanionMaxHP()`
- `Localization/en.json` — `home.upgrades` shortened to "Renovations"
- `Localization/es.json` — `home.upgrades` shortened to "Renovaciones"
- `Localization/it.json` — `home.upgrades` shortened to "Ristrutturazioni"
- `Localization/hu.json` — `home.upgrades` unchanged (already short: "Felújítások")
