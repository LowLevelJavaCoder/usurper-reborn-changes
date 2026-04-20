# v0.57.7 - Hotfix Rollup (Partner XP, Enchantments, Dungeon UX, Teammate Auto-Equip, Immunity, Companion Gear, Safe Haven Guide, Arena Self-Fight)

Nine-report rollup on top of v0.57.6.

## Report 1 — Partner-time infinite XP

Confirmed. `HomeLocation.SpendQualityTime` case 1 (Romantic Dinner) granted `Level * 50` XP on every selection with no cooldown, so a player could stand in their Home and keystroke-farm XP indefinitely. At Lv.66 that's +3300 XP per press. Cases 2 (walk — heals 5% MaxHP) and 3 (cuddle — restores 10% MaxMana) had the same shape: tangible reward, no gate.

**Fix.** Wall-clock 20-hour cooldown, shared across all three reward paths. One "quality time" event per day per player. Flavor text still plays every time so a player can RP the interaction at will — only the XP / HP / Mana reward is gated. Repeat attempts within the 20h window show a new message: [i]"A warm moment, but you've already shared quality time together today."[/i]

Bedroom, deep conversation, and discuss-relationship (cases 4-6) don't grant XP/HP/Mana in this code path — they delegate to `IntimacySystem` / `VisualNovelDialogueSystem` / `DiscussRelationship`. Those aren't rate-limited here; this fix is strictly about the three rewarding activities that were the exploit surface.

Mirrors the v0.57.6 child-parenting cooldown fix — wall-clock DateTime beats shared-day-counter every time in MUD mode.

## Report 2 — Siphoning staff lost its enchantment

Confirmed — and the bug is wider than one weapon. When dungeon loot is picked up at the combat loot prompt, [CombatEngine.cs:7633-7699](../Scripts/Systems/CombatEngine.cs#L7633-L7699) runs a full switch that copies the item's `LootEffects` list into the Equipment struct — LifeSteal, ManaSteal, all 6 elemental enchants, CriticalChance/Damage, ArmorPiercing, Thorns, HPRegen, ManaRegen, MagicResist, PoisonDamage, Constitution, Intelligence, AllStats, BossSlayer, TitanResolve. That's the authoritative path.

But the **two inventory equip paths** — Electron inventory at [InventorySystem.cs:228](../Scripts/Systems/InventorySystem.cs#L228) and the text inventory at [InventorySystem.cs:1138](../Scripts/Systems/InventorySystem.cs#L1138) — only handled **5** cases out of the 20+: Constitution, Intelligence, AllStats, BossSlayer, TitanResolve. Every other proc fell through the switch and was silently dropped on the floor.

Lumina's Siphoning Archmage's Staff hit the bug the way anyone touching enchanted loot eventually would: picked it up from a dungeon kill (LifeSteal + ManaSteal working), unequipped it at some point — to compare something, to swap in a different weapon, to check stats — then re-equipped it from inventory. The Intelligence bonus (`Int:+62`) survived because Intelligence *was* in the limited switch. The mana-steal proc was not, so it just disappeared. Same fate would have befallen Vampiric weapons, any elemental-enchant weapon, crit gear, Thorns armor, MagicResist gear, Regen rings, and so on.

**Fix.** Both inventory switches now replicate the full case list used by the dungeon-loot path and the editor-inventory equip path at `BaseLocation.cs:9253`. The four sites are now consistent: whatever the loot generator rolls onto an item will carry through every subsequent equip/unequip cycle. Pre-v0.57.7 saves heal on their own — the `LootEffects` list itself was being persisted correctly through all the save/load plumbing; it was only the last-mile inventory-equip step that was stripping procs. Next re-equip restores the missing proc.

## Report 3 — Dungeon hotkeys didn't match the rest of the game

Confirmed. Globally (every non-dungeon location), `%` opens Status and `*` opens Inventory — this is what the quick-command bar advertises and what `BaseLocation.TryProcessGlobalCommand` handles. The dungeon's in-room menu was historically older and advertised `[I]` and `[=]` as its own local hotkeys. `%` and `*` already worked in-dungeon (the dungeon calls `TryProcessGlobalCommand` first at `DungeonLocation.cs:3545` before its own key handlers), but the *displayed* hints told the player to press different keys than the rest of the game.

Same drift showed up in the dungeon's first-visit tutorial page ("Check your count with [=] (Status)"), in the group-follower status bar that shows during cooperative dungeon runs, and in the screen-reader dungeon menu.

**Fix.** Aligned the displayed hints across every dungeon surface — visual in-room menu, SR in-room menu, tutorial text, group-follower prompt. `[%] Status` and `[*] Inventory` now read the same way everywhere. The old `I`, `=`, and `S` keys still work as legacy input aliases so no one's muscle memory breaks; only the displayed labels moved. The group-follower input loop (which has its own handler and doesn't route through `TryProcessGlobalCommand`) grew explicit `*` / `%` cases in addition to its existing `I` / `=`.

## Report 4 — "Aldric auto equipped trash again. I chose Pass to throw it out and he grabbed it."

Different bug than the v0.57.6 phantom-slot issue — that fix is still holding. Here the weighted-power comparison did find a legitimate upgrade by the numbers, and the v0.57.2 "companion pass-down chain" is working exactly as designed: when the player picks `(P)ass`, `TryTeammatePickupItem` runs; the best matching teammate silently auto-equips; if nobody wants it the item leaves. From Lumina's perspective though, "Pass" read like "throw this out" — not "offer to the party and let a companion replace their weapon without asking me first".

The scoring function isn't wrong; it's just that a mid-tier procedurally-named drop ("Bloodriver") can score higher than a lovingly-curated companion weapon through raw `WP*3 + stat bonuses` arithmetic, and the player has zero visibility into the trade.

**Fix.** Teammate auto-equip now asks. When `TryTeammatePickupItem` finds a candidate, combat shows:

```
  Aldric could equip this — Bloodriver would be a 45% upgrade.
  Currently wearing:   Soldier's Sword of Thunder [WP:407 Def:+15 Str:+8 Dex:+4 Leech:5%]
  Would replace with:  Bloodriver                 [WP:420 Str:+12 Dex:+6]

  Let Aldric take it? (Y/N)
```

`Y` proceeds with the existing auto-equip path (inventory displacement, save, broadcast). `N` falls through to the next step in the existing chain — offer to other grouped human players (if any), otherwise leave the item behind. So the feature that players asked for in v0.57.2 still works; it just requires consent now. `TryTeammatePickupItem` also returns the target slot alongside the candidate, so the comparison shows the *actual* slot being replaced (important for dual-wielders where the weaker hand is the target). Both combat paths are patched — single-monster loot prompt and the grouped-player multi-monster path. Six new loc keys in en/es/fr/hu/it. Affirmative first letters `Y`/`S`/`O`/`I` all accepted so Spanish / French / Italian / Hungarian users can press the letter shown on their prompt.

## Report 5 — Aldric wasted a turn casting Iron Will over an active Arcane Immunity

Does the same thing, strictly worse. Both abilities set `HasStatusImmunity = true`. Arcane Immunity grants it for 999 rounds (whole fight, per its "Duration: whole fight" description); Iron Will grants it for 3 rounds plus +50 defense over the same window. The handler at [CombatEngine.cs:22809](Scripts/Systems/CombatEngine.cs#L22809) and [CombatEngine.cs:12389](Scripts/Systems/CombatEngine.cs#L12389) is an unconditional assignment, not a max — Iron Will's 3-round duration *overwrites* Arcane Immunity's 999, cutting the whole-fight buff short. Player's opening-turn immunity spell becomes useless after Aldric's round-two Iron Will.

The existing "tank defensive-spread" filter at [CombatEngine.cs:16331](Scripts/Systems/CombatEngine.cs#L16331) prevents stacked short-term Defense abilities (Shield Wall / Aura / Divine Shield / Formation / Mandate / Rage Challenge), but it only inspects `TempDefenseBonus` / `TempDamageReduction` / `TempThornReflect` / `TempPercentRegen`. It doesn't look at `HasStatusImmunity`, so the immunity-cluster abilities slipped past it.

**Fix.** One additional filter in `TryTeammateClassAbility`, right after the defensive-spread block: if the teammate already has `HasStatusImmunity` with any remaining duration, strip `resist_all`, `immunity`, and `mindblank` abilities from the candidate list. The teammate spends the turn on something useful (attack, heal, buff a different stat) instead of shadowing a buff that's already up. Applies to both single-monster and multi-monster combat paths since both route through the same AI function.

## Report 6 — Arcane Immunity didn't actually prevent fear on Aldric

Does not work on companions. Two separate asymmetries between the player path and the companion path made immunity a no-op for allies:

1. **The resist check was missing entirely on the companion side.** When a monster ability inflicts a status on the *player*, [CombatEngine.cs:4799-4825](Scripts/Systems/CombatEngine.cs#L4799-L4825) walks an ordered resist chain: `HasStatusImmunity` → Cyclebreaker Probability Manipulation → Paladin Divine Resolve → Calm Waters shield → roll. The equivalent *companion* path at [CombatEngine.cs:16912](Scripts/Systems/CombatEngine.cs#L16912) only checked Calm Waters — it skipped `HasStatusImmunity` and went straight to the roll. Arcane Immunity set the flag correctly on Aldric (the `allyTarget`-branch of `ApplySpellEffects` at [14577](Scripts/Systems/CombatEngine.cs#L14577) does route to him), but nothing in the monster-hits-companion path ever consulted the flag.

2. **Teammate immunity duration was never decrementing.** The end-of-round tick at [CombatEngine.cs:21408](Scripts/Systems/CombatEngine.cs#L21408) only decremented `player.StatusImmunityDuration`. Teammate durations just sat at their initial value until combat-start reset zeroed them for the next fight. Not user-visible yet because of fix #1, but would have made Iron Will's "3 rounds" last all fight once the companion actually used it — wrong in the other direction.

**Fix.**

1. Mirror the player's resist chain onto the companion path: check `HasStatusImmunity` first, then Calm Waters, then the random roll. New loc key `combat.companion_iron_will_resists` in all 5 languages — "{0}'s iron will resists {1}!" pattern so the player knows the buff earned its mana cost.

2. Add teammate `StatusImmunityDuration` decrement to the existing end-of-round teammate-buff block at [CombatEngine.cs:21388](Scripts/Systems/CombatEngine.cs#L21388). Mirrors the player tick at `21408`, but silent on expiration (the player tick has a "your immunity fades" message; on teammates that would just spam the log).

No save contract changes — `HasStatusImmunity` is per-combat transient and already resets on combat start via the existing reset blocks (lines 205, 463, 688, 1513).

## Report 7 — Equipment given to Lyris reverted to her starting gear every time

Steam-build single-player report, not related to the online game. Confirmed — and the bug is *old*, predating the combat-loot pickup flow that does sync correctly. The three "give equipment to a party member" surfaces — Inn, Home, Team Corner — all use the same pattern: fetch a list of `Character` wrappers via `CompanionSystem.GetCompanionsAsCharacters()`, let the player pick one as `target`, then `target.EquipItem(...)`. Works fine as long as `target` *is* the underlying entity.

It isn't, for companions. `GetCompanionsAsCharacters` builds a *fresh* `Character` wrapper on every call and copies `EquippedItems` FROM the real `Companion` TO the wrapper for read-only display of stats. Edits to `wrapper.EquippedItems` don't propagate back automatically. Companion system has a dedicated `SyncCompanionEquipment(wrapper)` helper for exactly this reason — the combat-loot path calls it, but the three manager-location equip flows never did. So:

1. Player hands Lyris a bow via Inn `[E] Equip Item`.
2. Wrapper gets the new bow; companion still holds the Ranger starting gear `EquipStartingGear` gave her at recruit.
3. Player leaves Inn. Next call into anything that rebuilds wrappers (next combat, save/load, another location visit) regenerates Lyris's wrapper from the *real* companion record — which still has starting gear.
4. Lyris reverts. Save keeps reverting because save reads the real record, not the discarded wrapper.

Affected surfaces:

- `InnLocation.CompanionEquipItemToCharacter` (equip)
- `InnLocation.CompanionUnequipItemFromCharacter` (unequip)
- `InnLocation.CompanionTakeAllEquipment` (take-all)
- `HomeLocation.EquipItemToCharacter` (equip)
- `HomeLocation.UnequipItemFromCharacter` (unequip)
- `HomeLocation.TakeAllEquipment` (take-all)
- `TeamCornerLocation.EquipItemToCharacter` (equip)
- `TeamCornerLocation.UnequipItemFromCharacter` (unequip)
- `TeamCornerLocation.TakeAllEquipment` (take-all)

**Fix.** Every one of those surfaces now calls `CompanionSystem.Instance?.SyncCompanionEquipment(target)` after a successful mutation, gated on `target.IsCompanion` so non-companion targets (spouse, lover, child, team NPC) skip it — those entities aren't wrappers, they're the real objects, and they persist through normal save paths. Nine surface fixes, one-line each, same pattern everywhere.

No save contract changes — `Companion.EquippedItems` is already serialized (`CompanionSaveData.EquippedItemsSave`, line 1546). Existing saves where Lyris's gear reverted will heal themselves once the player re-equips, since the sync now writes through to the companion record.

## Report 8 — Dungeon guide pointed to a "safe haven" in a different room than the one you're in

Floor 85 (fire theme) generated two designated safe rooms — `Magma Chamber` (where Lumina was standing) and `Heart-Fire Sanctuary` (elsewhere on the floor). `ShowDungeonNavigator` at [DungeonLocation.cs:11860](Scripts/Locations/DungeonLocation.cs#L11860) runs a BFS from the current room and the BFS skips the start room itself (`if (roomId == startId) continue;` at line 11927) — nearest targets are supposed to be *other* rooms, not the one you're already in. That logic is correct for destinations like stairs or the boss room. For safe haven it read as a lie: the guide silently excluded the player's current safe haven and pointed to the next one, with no acknowledgement that the player was already in one.

**Fix.** Before the BFS, check `current.IsSafeRoom`. If true, print an up-front "You are already in a safe haven — you can rest here." line above the destination list. The existing BFS then still runs and still lists the *next* safe haven as `[H]` (useful if the player wants to rest in a different one, or if that one has a shop/event the current one doesn't), but it can no longer read as contradictory — the player sees both lines and the two facts reconcile: "I'm already in one AND here's where another one is."

Small, one-line addition in the guide render plus a new loc key `dungeon.nav_safe_haven_here` in en/es/fr/hu/it. No changes to BFS scoring, the safe-haven option listing, or any room state.

## Report 9 — Could fight yourself in the PvP arena

Arena opponent list built a self-exclusion key from the **character display name** rather than the authenticated account username. [ArenaLocation.cs:162-163](Scripts/Locations/ArenaLocation.cs#L162-L163) was:

```csharp
string myName = currentPlayer.Name2 ?? currentPlayer.Name1;
string myUsername = myName.ToLower();
```

and the self-exclusion filter compared that against `PlayerSummary.Username` — which is the **DB save-key** (account username, e.g. `jane_42`, or `jane_42__alt` for alts). If the character's display name differs from the account username, the filter's string comparison never matched the player's own row and the row survived into the eligible list. Case hit: display name `Lumina`, account username `something_else` → self-exclusion did nothing, and Lumina saw herself in her own opponent list.

The same-account filter right below (`GetAccountUsername(p.Username) != myAccount`) ran off the same bad key, so it didn't catch the miss either.

**Fix.** Read the authoritative save-key from `SessionContext.Current?.CharacterKey` in MUD mode (exact DB-row format, handles both main and alt characters), fall back to the old display-name-derived key only in single-player (where there's one player and the filter is moot). Both self-exclusion and same-account filter now compare real DB keys against real DB keys. Mirrored fix in `ProcessPvPResult` for the bounty-claim / gold-deduction / PvP attack-record writes that used the same bad `myUsername`, plus corrected `defenderUsername` from `target.DisplayName.ToLower()` to `target.Username.ToLower()` so those writes target the correct rows — a latent-related bug that would have silently mis-routed arena bounty claims whenever display name and username differed.

No save or DB contract changes. Pre-existing saves unaffected.

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.57.7.
- `Scripts/Core/Character.cs` — New `DateTime LastPartnerBondingUtc` field; defaults to `DateTime.MinValue` so the first bonding attempt on any existing save is always rewarded.
- `Scripts/Systems/SaveDataStructures.cs` — `LastPartnerBondingUtc` added to `PlayerData`.
- `Scripts/Systems/SaveSystem.cs` — Serialize the new field.
- `Scripts/Core/GameEngine.cs` — Restore the new field on load.
- `Scripts/Locations/HomeLocation.cs` — `SpendQualityTime` gates XP / HP / Mana rewards behind the 20h cooldown; sets the timestamp on a successful reward. Non-reward paths (cases 4-6) unchanged.
- `Scripts/Systems/InventorySystem.cs` — Both inventory equip paths (Electron line ~228, text line ~1138) now transfer the full `LootEffects` list into the Equipment struct — LifeSteal, ManaSteal, all 6 elemental enchants, crit stats, ArmorPiercing, Thorns, HPRegen, ManaRegen, MagicResist, PoisonDamage. Was only transferring 5 of 20+ cases.
- `Scripts/Locations/DungeonLocation.cs` — In-room visual menu shows `[*]` Inventory / `[%]` Status (was `[I]` / `[=]`). SR in-room menu matches. First-visit tutorial and group-follower status bar updated. Group-follower input loop now accepts `*` and `%` in addition to the legacy `I` / `=`. Non-dungeon dungeon surfaces (overview menu, combat) untouched. `ShowDungeonNavigator` prints "You are already in a safe haven" above the destination list when `current.IsSafeRoom` is true, so the `[H] Nearest safe haven` entry no longer reads as contradictory when the player is standing in one.
- `Scripts/Systems/CombatEngine.cs` — `TryTeammatePickupItem` return type extended with the target `EquipmentSlot`. New helpers `BuildEquipmentStatSummary` (compact stat block) and `ConfirmTeammateAutoEquip` (prompts the player with the candidate teammate's current item *and* the incoming item for a Y/N approval). Both loot paths (single-monster Pass branch at ~line 7869, grouped multi-monster at ~line 8315) gate the auto-equip on the new confirmation. Affirmative input accepts `Y`/`S`/`O`/`I` for localization compatibility. `TryTeammateClassAbility` now strips `resist_all` / `immunity` / `mindblank` abilities from the NPC AI's candidate list when `HasStatusImmunity` is already active — prevents Iron Will from cutting Arcane Immunity's 999-round duration down to 3. Monster-inflicts-status-on-companion path at ~line 16912 now checks `HasStatusImmunity` first, matching the player path at `~4799-4825`. End-of-round teammate-buff block at ~line 21388 now decrements `StatusImmunityDuration` for teammates (previously player-only).
- `Scripts/Locations/HomeLocation.cs`, `Scripts/Locations/InnLocation.cs`, `Scripts/Locations/TeamCornerLocation.cs` — Every `Equip` / `Unequip` / `TakeAll` flow that mutates a companion wrapper's equipment now calls `CompanionSystem.Instance?.SyncCompanionEquipment(target)` before exiting the block, gated on `target.IsCompanion`. Without the call the real companion record stayed on `EquipStartingGear`'s recruit-time set, so any gear the player gave Lyris/Aldric/Mira/Vex/Melodia silently evaporated on the next wrapper regeneration.
- `Scripts/Locations/ArenaLocation.cs` — Opponent self-exclusion key and `ProcessPvPResult` attacker/defender keys now use `SessionContext.Current?.CharacterKey` (MUD) or display-name fallback (single-player), and the defender key reads from `PlayerSummary.Username` instead of `DisplayName`. Fixes Lumina's "I can fight myself" report and a latent bounty/attack-record mis-routing when display name differs from account username.
- 5 localization files (en/es/fr/hu/it) — New `home.partner_bond_already_today` key. New `combat.loot_ally_upgrade_prompt`, `combat.loot_ally_current_label`, `combat.loot_ally_new_label`, `combat.loot_ally_empty_slot`, `combat.loot_ally_confirm_prompt`, `combat.loot_ally_approved`, `combat.loot_ally_declined` keys for the teammate auto-equip confirmation. New `combat.companion_iron_will_resists` key for the ally-side immunity resist message. New `dungeon.nav_safe_haven_here` key for the "you're already in a safe haven" guide message.
- `Tests/SaveRoundTripTests.cs` — New `PlayerData_RoundTrip_PreservesLastPartnerBondingUtc` test. Full suite: 596/596 passing.
