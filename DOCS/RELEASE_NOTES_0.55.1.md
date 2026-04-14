# v0.55.1 - The Specialist

## Guardian Paladin Specialization

Added a third specialization for Paladin: **Guardian (Tank)**. Paladins can now be DPS (Retribution), Healer (Holy), or Tank (Guardian). This brings the total tank options to three: Protection Warrior, Juggernaut Barbarian, and Guardian Paladin. Per-level bonuses: +2 CON, +2 DEF, +6 HP, +1 WIS.

## NPC Population Cap

NPC population is now hard-capped at 200. Previously, immigration and births had no effective upper limit -- the pregnancy cap was hardcoded at 120 but immigration had no cap at all, and `populationHigh` was hardcoded to `false`. On the online server, population had grown to 193 NPCs (2.1MB of JSON serialized every save cycle), contributing to periodic lag. The cap is enforced in three places: immigration, new pregnancies, and child/orphan graduation to adult NPCs.

## NPC XP Sharing Persistence Fix (Online)

Sharing XP with NPC teammates at the Level Master didn't persist in online mode. The NPC level-ups existed only in memory and were overwritten by the next world sim reload cycle, so only one NPC (or none) would keep their levels after leaving and returning. Now saves shared state immediately after XP transfer.

## Specialization System Bug Fixes

Three bugs found during a comprehensive audit of the new specialization system:

- **Spec bonuses not reversed on death level loss** -- `ReverseClassStatIncrease()` subtracted base class stats when an NPC lost a level but didn't subtract specialization bonuses. Specialized NPCs that died would retain inflated stats. Now reverses spec bonuses in lockstep with class stats.
- **Smite Cleric still casting healing spells** -- The Smite spec restricted Heal-type class abilities but the spell healing path was a separate code path that bypassed the restriction. A Smite Cleric would still prioritize casting healing spells. Now specs that restrict Heal abilities also suppress spell healing -- Smite Clerics will only heal via potions at the emergency 30% threshold.
- **BBS menu missing Specialize option** -- The `[X] Specialize` option was added to the visual and screen reader menus but was missing from the BBS compact menu. BBS door players couldn't access the feature. Added to the BBS menu row with `team.bbs_specialize` key in all 5 languages.
- **Class rebalancing didn't clear specialization** -- `RebalanceClassDistribution()` changes an NPC's class to maintain diversity but didn't clear their old specialization. A Cleric with Restoration spec rebalanced to Warrior would keep the healer spec, causing them to behave as a healer despite being a Warrior. Now clears spec to None on class change.

## Session Emergency Save on Shutdown

Server deploys/restarts were losing player progress — specifically companion equipment changes made just before the restart. Root cause: `MudServer` fire-and-forget session tasks were not tracked, so when SIGTERM was received, the server's main loop exited before session `finally` blocks (which run the emergency `SaveGame()`) could complete. On the next login, players loaded the pre-change DB state and saw equipment revert. Now `MudServer.RunAsync()` tracks all session tasks in a list and waits up to 30 seconds on shutdown for emergency saves to complete before exiting. Combined with `TimeoutStopSec=60` on the systemd service, this gives saves plenty of headroom.

## Mid-Dungeon Companion XP Split Fix

When a companion was recruited or activated mid-dungeon, they were correctly added to the teammates list but did not receive any share of combat XP until the player left and re-entered the dungeon. Root cause: entering the dungeon solo auto-set `TeamXPPercent[0] = 100`, and `AutoDistributeTeamXP` had a "respect player's 100% choice" bail-out that couldn't distinguish auto-set solo state from an explicit player choice. Now the function only treats the distribution as custom if at least one teammate slot has > 0% allocated — a stale 100%-with-zero-teammates setup gets redistributed evenly to include the new companion.

---

### Files Changed

- `Scripts/Core/GameConfig.cs` -- Version 0.55.1; `MaxNPCPopulation = 200` constant
- `Scripts/Core/Character.cs` -- `Guardian` added to `ClassSpecialization` enum
- `Scripts/Data/SpecializationData.cs` -- Guardian Paladin spec definition (Tank role, +2 CON, +2 DEF, +6 HP, +1 WIS); Jester Chaos/Trickster stat bonuses rebalanced for better differentiation
- `Scripts/Locations/LevelMasterLocation.cs` -- `SaveAllSharedState()` after NPC XP sharing in online mode; spec bonus reversal in `ReverseClassStatIncrease()`
- `Scripts/Systems/CombatEngine.cs` -- Specs restricting Heal abilities now also suppress spell healing in `TryTeammateHealAction()`
- `Scripts/Locations/TeamCornerLocation.cs` -- `[X] Specialize` added to BBS compact menu
- `Scripts/Systems/WorldSimulator.cs` -- Population cap check in `ProcessNPCImmigration()` (hard return at cap, slow down within 10 of cap); pregnancy cap updated from hardcoded 120 to `MaxNPCPopulation`; population cap in `OrphanBecomesNPC()`
- `Scripts/Systems/FamilySystem.cs` -- Population cap in `ConvertChildToNPC()`
- `Scripts/Systems/NPCSpawnSystem.cs` -- Clear specialization on class reassignment in `RebalanceClassDistribution()`
- `Scripts/Server/MudServer.cs` -- Track session tasks in `_sessionTasks` list; wait up to 30 seconds for emergency saves to complete on shutdown before exiting
- `Scripts/Systems/CompanionSystem.cs` -- Diagnostic logging in `Serialize()` (saves), `Deserialize()` (before reset + after restore) to trace companion equipment through the save/load cycle
- `Scripts/Systems/CombatEngine.cs` (again) -- `AutoDistributeTeamXP()` no longer bails out on player == 100% alone; only respects custom distribution when at least one teammate slot > 0%
- `Scripts/Locations/InnLocation.cs` -- Removed "Days Together" from companion history display (was showing 0 regardless of actual time)
- `Localization/en.json` -- `spec.paladin.guardian.desc`, `team.bbs_specialize` keys
- `Localization/es.json` -- Spanish translations
- `Localization/fr.json` -- French translations
- `Localization/hu.json` -- Hungarian translations
- `Localization/it.json` -- Italian translations
