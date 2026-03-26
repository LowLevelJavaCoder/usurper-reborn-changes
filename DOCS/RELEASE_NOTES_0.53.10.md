# Usurper Reborn v0.53.10 Release Notes

**Version Name:** Ancestral Spirits (Hotfix)

## NPC Orientation Diversity Fix

Two bugs caused the NPC orientation distribution to drift significantly from intended values:

**Orientation rates corrected** — The random orientation roll for new NPCs (immigrants, children coming of age) used rates of 85% straight / 8% gay / 5% bisexual / 2% asexual. This generated far too many non-straight and asexual NPCs over time. Corrected to ~95% straight / ~2% gay/lesbian / ~3% bisexual. Asexual is no longer randomly assigned — it remains a valid orientation for players who choose it and for specific story NPCs (e.g., Sir Cedric the Pure), but new NPCs will not randomly spawn as asexual.

**Diversity check counted dead NPCs** — `EnsureOrientationDiversity()` guaranteed minimum gay/lesbian/bisexual NPCs in the population, but counted all NPCs including dead ones. With 40+ dead NPCs accumulated over time, the diversity check could pass even when no living NPCs had the required orientations. Now filters to living NPCs only (`!n.IsDead`) before checking diversity minimums and converting straight NPCs to fill gaps.

## Compact Mode Combat Action Fix

Power Attack (`[P]`) and Precise Strike (`[E]`) in the compact/BBS combat menu had two bugs:

**Power Attack placeholder text** — The multi-monster Power Attack message used `Loc.Get("combat.power_attack_hit", powerDamage)` with only one argument, but the localization key expects two (`{0}` = target name, `{1}` = damage). This displayed raw `{1}` placeholder text in combat. Fixed by passing `target.Name` as the first argument.

**Precise Strike broken damage** — The multi-monster Precise Strike had multiple issues: defense calculation only subtracted `ArmPow / 2` instead of the full defense formula (missing `target.Defence` entirely), displayed two confusing damage numbers (pre-defense and post-defense), and didn't apply enchantment procs or track kills properly. Rewritten to use the same defense formula as the single-monster path (25% defense reduction for accuracy) with `ApplySingleMonsterDamage` for proper enchantment/kill handling and a single damage display.

## Companion Loot Equip Item Loss Fix

Equipping loot directly to a companion during the post-combat loot screen caused the companion's old equipment to vanish. When switching to a companion with `<`/`>` and pressing `[E]` to equip, `Character.EquipItem()` correctly added displaced items to the companion's inventory — but the loot equip code path never transferred those items back to the player's backpack. Unlike the Inn/Home/Team Corner equip flows which track `targetInventoryBefore` and move displaced items to the player, the combat loot path had no such handling.

Fixed by tracking the companion's inventory count before equip and moving any displaced items to the actual player's inventory after. Also fixed: when equip fails on a companion, the loot item now goes to the player's inventory instead of the companion's.

## Companion Death Equipment Sync Fix

When a companion died in combat, their equipment was returned to the player's inventory — but it returned the **old** equipment from before the combat started, not the current equipment. This happened because `KillCompanion()` reads from the `Companion` object's `EquippedItems`, but during combat, equipment changes (from loot equip) only update the combat `charWrapper` Character, not the `Companion` object. The sync from charWrapper back to Companion normally happens after combat ends — but if the companion dies before combat ends, it never happens.

Fixed by calling `SyncCompanionEquipment()` immediately before `KillCompanion()` to ensure the companion object has the current equipment state.

---

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.53.10
- `Scripts/AI/PersonalityProfile.cs` — Orientation random roll: 85/8/5/2% -> 95/2/3/0% (straight/gay/bisexual/asexual); removed asexual from random assignment
- `Scripts/Systems/NPCSpawnSystem.cs` — `EnsureOrientationDiversity()` filters to living NPCs only before counting and converting orientations
- `Scripts/Systems/CombatEngine.cs` — Power Attack multi-monster: added missing target name arg to localization; Precise Strike multi-monster: full defense calc, single damage display, proper kill/enchantment handling via `ApplySingleMonsterDamage`; Loot equip to companion: displaced items now transferred to player's inventory; equip failure adds loot to player inventory; Companion death: `SyncCompanionEquipment()` called before `KillCompanion()` to return current equipment
- `Localization/en.json` — Added `combat.loot_displaced_to_player` key
