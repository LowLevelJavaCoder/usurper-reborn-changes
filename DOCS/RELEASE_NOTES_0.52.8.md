# Usurper Reborn v0.52.8 Release Notes

**Release Date:** March 15, 2026
**Version Name:** The Hook

## Sunforged Blade Quest Fix

The Sunforged Blade on floor 90 and Aurelion's save quest return on floor 85 were permanently inaccessible if the player visited those floors before having the required quest flags. Both events were inside a first-visit-only check, so if a player explored floor 90 before receiving the `aurelion_save_quest` flag, the blade discovery event could never fire on subsequent visits. Quest-dependent floor events now run on every floor entry, not just the first visit.

## Dungeon Fatigue Indicator

Fatigue status (Tired/Exhausted) now displays in the dungeon room status bar alongside HP, Potions, and Gold. Previously fatigue was only visible in the `/health` command and dungeon header, making it easy to miss the combat penalties.

## Wavecaller CHA Scaling Fix

Wavecaller spell damage and protection scaling now use Charisma instead of Intelligence, matching the class's +5 CHA per level stat growth and performance-based magic theme. Healing already used Wisdom correctly. Previously, Wavecaller's primary stat (CHA) had no effect on spell power, making the class's stat distribution misleading.

## Monster Self-Heal Attack Message Fix

When a monster used a self-healing ability (Regeneration, Heal, Cocoon, etc.) while targeting a companion or NPC teammate, the combat log incorrectly showed "The Troll attacks Aldric!" before the regeneration message, even though the monster wasn't actually attacking anyone. Self-targeting abilities now skip the misleading "attacks" header and just show the heal message.

## NG+ Story Progress Reset Fix

Starting a New Game Plus cycle was not resetting collected seals, leaving the new character with all 7 seals already collected from the previous run. The `StartNewCycle()` method cleared artifacts, choices, and story flags but explicitly skipped seals. Seals are now properly cleared alongside all other story progress.

## NG+ Screen Reader Preference Fix

Players using screen reader mode lost their accessibility preference when starting NG+. `CreateNewGame()` set screen reader mode from the global CLI flag default instead of preserving the previous character's setting. The preference is now saved before the old character is deleted and restored to the new one.

## Music Shop Prestige Instrument Fix

Prestige classes could not buy instruments at the Music Shop — the purchase flow had a hardcoded Bard-only check that rejected all other classes. The instrument would go to inventory with a "only Bards can equip" message, but equipping it from the inventory screen worked fine (since `CanEquip()` already has the prestige bypass). The Music Shop now allows prestige classes to buy and equip instruments directly, matching the existing prestige equipment restriction bypass.

## Slot-Based Equipment Management

Equipping items to companions (Inn), NPC teammates (Team Corner), and spouses (Home) now uses a slot-based flow: choose a slot first, then see only items that fit that slot with full stat details. Previously all items were dumped in a single list with only basic Atk/AC/Shield stats, making it hard to compare. The new flow shows the current item in the slot for easy comparison, and all secondary stats (STR, DEX, INT, CON, WIS, CHA, AGI, DEF, HP, MP, CRIT, etc.) are displayed on every item. Equipment currently worn by party members also shows full stat summaries instead of just item names.

## Dungeon Party Management

Party members (companions and NPC teammates) can now be managed between fights in the dungeon via the new `[Y] Party` menu option. View each member's stats, current equipment with full stat breakdowns, and equip or unequip items using the same slot-based flow — no need to leave the dungeon and return to town. Grouped players and echo characters are view-only.

## NG+ Starting Level Bonus

NG+ characters now receive a starting level bonus based on their previous playthrough's progress. Players who reached level 50 start their next cycle at level 5 (VETERAN), and players who reached level 100 start at level 10 (MASTER). The bonus includes all class-appropriate stat increases for those levels. The `MetaProgressionSystem.GetStartingLevelBonus()` method existed but was never wired into character creation — now called during `ApplyCycleBonusesToNewCharacter()`.

## Prestige Class Quickbar Fix

Prestige classes (Wavecaller, Tidesworn, etc.) that have both combat abilities and spells share a single 9-slot quickbar. Previously, opening the Combat Abilities screen would show spell-occupied slots as "empty" and silently clear the spell entries from those slots — `GetAbility("spell:5")` returned null, triggering the "invalid ability" cleanup path. Similarly, the Spell Library screen showed ability-occupied slots as empty (though didn't clear them). Both screens now properly display cross-type entries: the ability screen shows spell slots labeled "(spell)" in cyan, and the spell screen shows ability slots labeled "(ability)" in yellow. Neither screen clears entries from the other system.

## Dissolution Ending Fixes

The Secret (Dissolution) ending had three issues: it was never recorded in `MetaProgressionSystem` (the early return in `TriggerEnding()` skipped `PlayCredits()` where `RecordEndingUnlock()` lives), the "DISSOLVE" confirmation was whitespace-sensitive (trailing space would silently fail and fallback to True Ending), and `MetaProgressionSystem` file I/O silently swallowed all exceptions. Dissolution now records the ending in meta-progression before returning. The confirmation uses `.Trim().ToUpper()`. File I/O errors are logged to debug log.

## MetaProgressionSystem Concurrent Write Fix

In online MUD mode, multiple player sessions could overwrite each other's meta-progression data since all sessions read/wrote the same `meta_progression.json` file without synchronization. `SaveData()` now uses a file lock and re-reads/merges disk data before writing — counters take the max value, sets are unioned. This prevents ending unlocks from being lost when two players complete endings near-simultaneously.

## World Boss Spawn Cooldown

World bosses could respawn immediately after being defeated — `CheckSpawnConditions()` only checked for an `active` boss, and once a boss was marked `defeated`, the next world sim tick (every ~30 seconds) would spawn a new one. There is now a 4-hour cooldown after a boss is defeated or expires before a new one can spawn.

## World Boss Menu Display Fix

The world boss attack menu showed `[Q] [B]ack` instead of `[Q] Back`. The `ui.back` localization key already contained bracket formatting (`[B]ack`), which doubled up with the `[Q]` key prefix.

## NPC Team Recruitment Persistence Fix

Recruiting an NPC to your team in online mode could result in the NPC immediately vanishing from the team. The NPC's team assignment was set in memory but not persisted to the database — the world sim reload cycle (every ~30 seconds) would overwrite it from the database where the team field was still empty. NPC state is now saved immediately after recruitment, same pattern used for equipment changes since v0.52.6.

---

## Files Changed

- `Scripts/Core/GameConfig.cs` -- Version 0.52.8
- `Scripts/Locations/DungeonLocation.cs` -- `CheckQuestDependentFloorEvents()` runs quest-gated events on every floor entry (floors 85, 90, 95); fatigue indicator in `ShowQuickStatus()` status bar; `[Y] Party` menu option in room actions (visual + SR); `ManagePartyInDungeon()` party overview with stats/equipment; `ManagePartyMemberEquipment()` full equipment screen; `DungeonEquipItemToMember()` slot-based equip; `DungeonUnequipItemFromMember()` with stat display
- `Scripts/Locations/BaseLocation.cs` -- Shared equipment management helpers: `WriteEquipmentStatSummary()` compact stat line; `DisplayEquipmentSlotWithStats()` slot display with stats; `PromptForEquipmentSlot()` two-column slot picker; `GetItemsForSlot()` slot-filtered item list; `ItemMatchesSlot()` weapon/ring/armor slot matching; `DisplayEquipmentItemList()` numbered item list with full stats
- `Scripts/Locations/InnLocation.cs` -- `CompanionEquipItemToCharacter()` rewritten with slot-based flow; removes "which hand?" prompt (slot already chosen)
- `Scripts/Locations/TeamCornerLocation.cs` -- `EquipItemToCharacter()` rewritten with slot-based flow; `DisplayEquipmentSlot()` delegates to shared `DisplayEquipmentSlotWithStats()` for full stat display
- `Scripts/Locations/HomeLocation.cs` -- `EquipItemToCharacter()` rewritten with slot-based flow; `DisplayEquipmentSlot()` delegates to shared `DisplayEquipmentSlotWithStats()` for full stat display
- `Scripts/Systems/SpellSystem.cs` -- Wavecaller uses CHA instead of INT for `ScaleSpellEffect()` damage/crit and `ScaleProtectionEffect()` protection scaling
- `Scripts/Systems/MonsterAbilities.cs` -- `IsSelfOnly` flag on `AbilityResult`; set for Regeneration, Heal, SelfRepair, Cocoon, Sanctuary, Phylactery, Rebirth
- `Scripts/Systems/CombatEngine.cs` -- `MonsterAttacksCompanion()` defers "attacks companion" message until after ability check; skips it for self-only abilities
- `Scripts/Systems/StoryProgressionSystem.cs` -- `StartNewCycle()` now clears `CollectedSeals` (was incorrectly preserved across NG+ cycles)
- `Scripts/Core/GameEngine.cs` -- NG+ path preserves screen reader preference before deleting old save and restores it to new character
- `Scripts/Locations/MusicShopLocation.cs` -- `PurchaseInstrument()` allows prestige classes (`>= Tidesworn`) to buy and equip instruments, not just Bards
- `Scripts/Systems/OpeningSequence.cs` -- `ApplyCycleBonusesToNewCharacter()` now calls `MetaProgressionSystem.GetStartingLevelBonus()` and applies level-up stat increases with training points; `GetCurrentCycleBonuses()` displays starting level bonus
- `Scripts/Systems/EndingsSystem.cs` -- Dissolution ending records in `MetaProgressionSystem` before early return; `DISSOLVE` confirmation uses `.Trim().ToUpper()`
- `Scripts/Systems/MetaProgressionSystem.cs` -- `SaveData()` uses file lock with read-merge-write for MUD concurrency safety; exception handlers now log errors via `DebugLogger`
- `Scripts/Systems/ClassAbilitySystem.cs` -- Ability quickbar screen no longer clears spell entries; shows spell-occupied slots as "(spell)" instead of "empty"
- `Scripts/Systems/SpellLearningSystem.cs` -- Spell quickbar screen shows ability-occupied slots as "(ability)" instead of "empty"
- `Scripts/Systems/WorldBossSystem.cs` -- World boss menu `[Q] [B]ack` formatting fix (double-bracketed from `ui.back` key); spawn cooldown: 4-hour delay after boss defeat/expiry prevents immediate respawn
- `Scripts/Systems/SqlSaveBackend.cs` -- `GetLastWorldBossEndTime()` queries most recent defeated/expired boss timestamp for spawn cooldown
- `Scripts/Core/GameConfig.cs` -- `WorldBossSpawnCooldownHours = 4.0` constant
- `Scripts/Locations/TeamCornerLocation.cs` -- `SaveAllSharedState()` after NPC recruitment in online mode (prevents world-sim reload from wiping team assignment)
