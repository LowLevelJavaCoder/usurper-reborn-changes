# v0.57.9 - Hotfix Rollup (Staff Casting, Bug Report Ping, World Boss Kill Credit, Team Corner Hotkey, Companion Equip Messages, Ghost Turf, Ravanella Stats, Royal Quest Floor Cap, Feature-Check Bonus, Loot Level Requirement Honesty, Stale Grief, Curse Removal Price Display, Royal Guard Defense Teleport, Hide Character/Monster Art Toggle)

Thirteen fixes plus one new preference.

## Staff spell casting

Magicians and Sages equipping procedurally-named staves from their inventory (or pulled from the Home chest, or any other inventory-equip path) were getting "you need a staff" errors when trying to cast spells, despite visibly having a staff equipped.

Spell casting for Magician / Sage gates on `HasRequiredSpellWeapon` which checks `mainHand.WeaponType == WeaponType.Staff`. `/gear` renders the item's name and stats but doesn't surface the WeaponType field, so the player had no way to see what went wrong.

The break was in [InventorySystem.cs:1351-1390](Scripts/Systems/InventorySystem.cs#L1351-L1390)'s `GetHandedness` helper, used by every inventory-equip path:

1. First branch: if `EquipmentDatabase.GetByName(item.Name)` finds a match, copy both `Handedness` AND `WeaponType` from the database entry.
2. Fallback branch: if no match, infer `Handedness` from name keywords ("staff" → TwoHanded, etc.) but leave `WeaponType` at its default of `WeaponType.None`.

The original "Archmage's Staff of Darkness" is a hand-crafted unique in `EquipmentData.cs`, so it hits branch 1 and gets `WeaponType = Staff` correctly. "Blazing Archmage's Staff" is the same base item with a procedural "Blazing" elemental-enchant prefix applied by the loot generator; that prefixed name doesn't match any database entry, so it hits branch 2, gets `Handedness = TwoHanded` but `WeaponType = None`. Spell-requirement check fails.

Every other dungeon-loot staff / bow / dagger the player has ever used probably had the same problem, but because most items are equipped at drop-time through `CombatEngine.ConvertLootItemToEquipment` (which does call `InferWeaponType` correctly), the hole was only exposed when the player explicitly routed a procedurally-named weapon through their *inventory* — typically after swapping, chest-storing, or picking it up to compare.

**Fix.** Branch 2 now also sets `weaponType = ShopItemGenerator.InferWeaponType(item.Name)` — the same name-based inference the dungeon-loot pickup path already uses. "Blazing Archmage's Staff" now resolves to `WeaponType.Staff`, Ranger's bows resolve to `WeaponType.Bow`, Assassin's daggers resolve to `WeaponType.Dagger`, etc. All downstream checks (spell requirement, ability weapon requirement, shield-slot conflicts, two-handed enforcement) now agree with the drop-time equip path.

Existing saves heal on next re-equip. Nothing in the save format changed.

## Bug report ping removed

Every in-game bug report prefixed the Discord message with an owner `@mention`. Useful once; intrusive at volume. Removed from both the client (future binaries will not send the mention at all) and the server-side proxy (strips any Discord mention syntax before forwarding, so existing v0.57.8 clients also stop pinging without needing an update).

- `Scripts/Systems/BugReportSystem.cs` — no longer prepends `<@owner>` to the forwarded content.
- `web/ssh-proxy.js` — `handleBugReport` sanitizes `<@id>`, `<@!id>`, `<@&id>`, `@everyone`, `@here` from the content string and also sends Discord `allowed_mentions: { parse: [] }` as defense-in-depth. The proxy is never a tool for silently pinging Discord users.

## World boss kill credit counted twice

Two players brought a world boss's HP to zero in the same round; both sessions printed the killing-blow line, both broadcast "X defeated the boss" to the whole server, both posted defeat news. The per-contributor reward distribution also ran twice.

The root was in [SqlSaveBackend.cs:4316](Scripts/Systems/SqlSaveBackend.cs#L4316) `RecordWorldBossDamage`. The function subtracted damage with `MAX(0, current_hp - @damage)`, then read the resulting HP, then returned it. The caller at [WorldBossSystem.cs:426](Scripts/Systems/WorldBossSystem.cs#L426) treated `remainingHp <= 0` as the "I delivered the killing blow" signal. That's actually only the "boss is dead (by somebody)" signal. When two players' transactions both land on a boss that's already at or near 0 HP, both see `remainingHp == 0` and both claim the kill.

**Fix.** Atomic single-winner kill claim.

1. `RecordWorldBossDamage` now returns `(long remainingHp, bool wasKillingBlow)`. When HP hits zero, it runs a conditional `UPDATE world_bosses SET status = 'defeated' WHERE id = @id AND status = 'active'` and checks affected rows. Exactly one concurrent caller gets `rowsAffected == 1` — that's the authoritative kill-credit signal. Every other caller whose round happens to land on already-dead HP gets `rowsAffected == 0`.

2. `WorldBossSystem` destructures the tuple. Branches:
   - `wasKillingBlow == true`: existing path. Killing-blow line, global broadcast, news post, `DistributeWorldBossRewards` (which iterates the full leaderboard and pays every contributor).
   - `wasKillingBlow == false && remainingHp <= 0`: boss died this round but someone else landed the killer. New message — "`{boss}` falls — another hero landed the killing blow." — no broadcast, no news, no duplicate reward distribution. Contributor's damage is already on the leaderboard, so the killer's `DistributeWorldBossRewards` call rewards them too.

No save schema change. New loc key `world_boss.already_defeated` in en/es/fr/hu/it.

## Team Corner stole the bug-report key

Confirmed. Every other location routes `!` through `TryProcessGlobalCommand` → open Bug Report. Team Corner intercepted it *before* the global handler to claim it for Resurrect Teammate — a deliberate choice the previous author made because Resurrect had no other obvious letter and `!` was available in that menu. The downside was that Team Corner became the one place you couldn't submit a bug report with the muscle-memory key everyone else taught you.

**Fix.** Resurrect moved to `U` (Undo death / "reUrrect"), a letter with no existing binding in Team Corner. The local `!` intercept is removed and the global command runs first, same as every other location. Three menu renderers updated — visual, BBS compact, screen-reader — and the `ProcessChoice` switch grew a `case "U"`.

No loc string changes. The existing `team.menu_resurrect`, `team.bbs_resurrect`, and `team_corner.resurrect` keys only hold the action label ("Resurrect Teammate"), not the hotkey letter, so they carry over unchanged.

## Companion equip printed contradictory displaced-item messages

`Character.EquipItem` returns an out-parameter `message` that reads "Moved {displacedItem} to inventory." whenever equipping a new weapon required unequipping previous gear. That string was accurate when the equipper was the player themselves — displaced items genuinely went to their own inventory. For companion equips, however, the outer loop at [CombatEngine.cs:7757-7774](Scripts/Systems/CombatEngine.cs#L7757-L7774) intercepts the companion's newly-populated bag, re-homes each displaced item to the real player's inventory (or drops it if full), and prints the accurate per-item outcome (`loot_displaced_dropped` or `loot_displaced_to_player`). Then at [line 7790](Scripts/Systems/CombatEngine.cs#L7790), the code *also* printed the raw `equipMsg` which contained the misleading "Moved X to inventory" text — now contradicted by the accurate line the loop just printed.

**Fix.** On companion equips, suppress `equipMsg` and print a dedicated `"Equipped {item} on {companion}."` line instead. The displaced-items loop's per-item outcome is the single source of truth; `equipMsg`'s stale internal bookkeeping no longer leaks through. New loc key `combat.loot_equipped_on_companion` in all 5 languages. Non-companion equip paths (player equipping their own items, grouped-player loot-chain paths) still print `equipMsg` since it's accurate for them.

## Ghost turf controller unchallengeable in Gang War

When a team holds the town turf (`CTurf = true`) but all its NPC members have died or been permadeathed, the team becomes invisible to Gang War. [AnchorRoadLocation.cs:541-552](Scripts/Locations/AnchorRoadLocation.cs#L541-L552) filters `allNPCs` with `IsAlive && !IsDead` before the `GroupBy`, so a team with zero surviving members never forms a group, never appears in the rival-teams list, and can't be selected. The player sees "Watchers control the town" on the main screen but the Gang War menu either shows Watchers missing or (if they were the only possible target) prints "No rival teams found to challenge" — which is what Coosh paraphrased as "not enough members."

Pascal's `GANGWARS.PAS` handled this with an `EasyTownTakeover` path; the C# inline port at AnchorRoad missed the case. (There's a dead `TeamSystem.GangWars` method that has the right logic but nothing calls it.)

**Fix.** Two changes:

1. After building the alive-member rival-team list, a second query finds teams that hold `CTurf` but weren't already included (zero alive members). Those are added to the list as "ghost" entries with `MemberCount = 0`, `TotalPower = 0`, `ControlsTurf = true` so the player can see and select them.

2. In the fight loop, a new short-circuit at the top checks `enemyTeamMembers.Count == 0 && targetTeam.ControlsTurf`. If the team is a ghost controller, skip the fight loop entirely, print an unopposed-takeover message, strip `CTurf` from every NPC on the ghost team (including dead ones — the flag was stuck on corpses), set `CTurf = true` on the player and their team, and post the news.

No fight, no XP/gold reward (there's nobody to defeat), but the turf transfers correctly and the previously-stuck controller is cleared. New loc key `anchor_road.ghost_takeover` in all 5 languages.

## Ravanella's enchant stats were too limited

The Minor / Standard / Greater stat-enchant tiers (+2, +4, +6 to one stat) at the Magic Shop only offered 5 stats: Strength, Defence, Dexterity, Wisdom, Attack (Weapon Power). A Magician with an Intelligence-scaling build had no way to enhance the stat her class actually cares about. Casters couldn't buff Mana or Intelligence, dex builds couldn't buff Agility, tanks couldn't buff Constitution or HP, Bards couldn't buff Charisma, etc.

**Fix.** Expanded the stat list from 5 to 13 options, covering every stat field the Item type actually carries plus Constitution and Intelligence (which live in `LootEffects`).

```
(1) Strength     (2) Defence      (3) Dexterity   (4) Wisdom    (5) Weapon Power
(6) Armor Power  (7) Hit Points   (8) Mana        (9) Agility  (10) Charisma
(11) Stamina    (12) Constitution                 (13) Intelligence
```

New helper `IncrementLootEffect` handles the two LootEffects-backed stats (Constitution, Intelligence) — existing tuple entries get their value incremented in place; new stats get appended. Tier costs / bonuses / localization flavor unchanged. Two new loc keys (`magic_shop.old_stat_options_2`, `magic_shop.old_stat_options_3`) in all 5 languages to hold the second and third lines of the expanded menu.

## Royal audience quest targeted floor beyond the dungeon cap

At Lv.94 with difficulty 4, `CreateRoyalAudienceQuest`'s target-floor formula `Math.Max(1, player.Level + difficulty * 3)` yielded 94 + 12 = 106. The dungeon only goes to floor 100. Quest was literally uncompletable.

The normal quest-board path has a `CapFloor` helper that clamps to `Math.Min(100, playerLevel + 10)` — the player's accessible dungeon range. The royal-audience path only applied a lower bound via `Math.Max(1, ...)` and no upper bound at all. Three of the five royal-quest branches (artifact, floor-clear, default-dungeon-investigation) had the same hole.

**Fix.** Added a local `ClampFloor` helper at the top of `CreateRoyalAudienceQuest` that applies both bounds — `[1, min(MaxDungeonLevel, player.Level + 10)]` — matching the board-quest ceiling. All three floor-targeting branches now use it. Lv.94 diff-4 caps at 100; Lv.50 diff-4 caps at 60 (proportionate to the player); Lv.100 diff-4 still caps at 100 (already at the cap). The monster-kill and criminal-hunt branches are unaffected — they don't target a floor.

## Feature-check stat bonus was capped too low for endgame specialists

Room-feature interactions (examine / search / unlock / etc.) in the dungeon use a D&D-style d20 roll with a stat bonus, compared against a DC that scales with the floor. The DC curve goes 8 (floor 1) → 33 (floor 100), the roll is 1d20, and the stat bonus was capped at 20 via `Math.Min(statValue / 10, 20)`.

The cap's comment claimed it was there to "keep checks meaningful at endgame." In practice it made checks *less* meaningful — every stat value from 200 upward produced the same +20, so a Magician with Intelligence 967 had exactly the same odds on an Int check as one with Intelligence 200. The player's specialization ceased to matter. On floor 94 (DC 31) the capped-out specialist needed to roll 11+ on the d20 — 50/50 — which for a committed caster feels terrible.

**Fix.** Raised the cap from 20 to 40. Stat 400+ now reaches the cap. At the maximum DC of 33, a capped specialist succeeds on any roll ≥ 0, effectively auto-passing — the reward for heavy investment in the check's governing stat. Mid-stat characters (100-300) still get a meaningful roll. Low-stat characters (<100) are still mostly at the mercy of the d20. The curve below the cap is unchanged (`statValue / 10`), so nothing changes for characters who hadn't maxed out before.

## Loot drop lied about required level

The loot-drop screen and the equip gate disagreed. A staff had WeaponPower 1089. The generator rolled `MinLevel = Math.Max(1, monsterLevel - 10)` which gave something like 80. The drop handler in `CombatEngine` at lines 7305 / 7325 / 7377 then *also* clamped MinLevel down to the player's current level — the comment called it "if you killed it, you earned it." The display read that clamped value and showed 80.

Meanwhile the equip path at [CombatEngine.cs:7615](Scripts/Systems/CombatEngine.cs#L7615) calls `Equipment.EnforceMinLevelFromPower()`, which recomputes MinLevel from the weapon's actual power tier: `Math.Min(100, power / 10)` = `Math.Min(100, 108)` = 100. So the Equipment's real MinLevel was 100, and the `CanEquip` check rejected Lumina at 95 < 100.

Two pieces of code decided MinLevel differently. The display picked the charitable number; the equip picked the honest one. Classic.

**Fix.** Make the display honest. Added `Item.EnforceMinLevelFromPower()` mirroring the Equipment-side helper — same power-tier formula (`max(Attack, Armor) / 10`, capped at 100, floor of 1). Drop handler now calls this instead of clamping down. Lumina's staff now shows "Requires Level: 100" on the drop screen, matching what the equip path will enforce. Lower-tier drops that were already in the player's accessible range are unchanged.

The "if you killed it, you earned it" intent is preserved in spirit via the monster-level-based MinLevel roll (`monsterLevel - 10`) in `LootGenerator`. It's just no longer amplified by a second hidden clamp that the equip path silently reverses.

## Stale grief for living party members

Two interlocking problems. The display side never asked "is the subject of this grief actually still dead?" — it just iterated `activeGrief` and `activeNpcGrief` filtered only on `IsComplete`. The write side had a path that revived the companion (cleared `IsDead`) but left the matching grief entry behind.

**Write side:** `OnlineAdminConsole`'s "Resurrect companion" already removed both `ActiveGriefs` and `GriefMemories` entries for the revived companion ([OnlineAdminConsole.cs:1066-1067](Scripts/Systems/OnlineAdminConsole.cs#L1066-L1067)). The local game editor's `ReviveCompanion` ([PlayerSaveEditor.cs:910](Scripts/Editor/PlayerSaveEditor.cs#L910)) and the bulk "mark every companion alive" option ([PlayerSaveEditor.cs:895](Scripts/Editor/PlayerSaveEditor.cs#L895)) cleared `IsDead` and `FallenCompanions` but missed the grief lists. Anyone who used those options got a save with `companion.IsDead = false` next to `ActiveGriefs[i].CompanionId == companion.Id` — internally inconsistent. Both editor paths now strip the matching grief entries on revive, mirroring the admin-console path.

**Read side (the real fix):** Even with the editor patched, future paths that bring a companion back from the dead would hit the same problem unless they remember to do the cleanup. Defense-in-depth filter added to `GriefSystem`: a new `IsGriefLive(GriefState)` helper checks the actual current state of the subject — for companion grief, the corresponding `Companion` must be either not-recruited or `IsDead`; for NPC grief, the corresponding NPC must be `IsDead || HP <= 0`. If the subject is currently alive and present, the grief entry is treated as stale and skipped. All read sites updated to use the new filter:

- `IsGrieving` (the master "should grief mechanics fire?" check)
- `CurrentStage` (`/health` display)
- `GetActiveGriefDetails` (`/health` per-companion list)
- `GetCurrentEffects` (combat damage/defense modifiers from grief)
- `GetCombatStartGriefMessage` (the per-fight "you remember Aldric falling..." flavor)
- `GetPostCombatFlashback` (25%-chance after-combat memory)

Existing saves with stale grief entries self-heal — the data still sits in the dictionary but never surfaces as long as the companion remains alive. If they perma-die again later, grief surfaces normally. `IsComplete` (acceptance-stage permanent wisdom bonus) still tracks completed grief cycles correctly because it's computed off the raw dictionary.

No save schema change. No localization change.

## Curse removal price display vs gold check

The cost displayed in the curse list was the *base* cost. The gold check at click-time used the *taxed* total (base + king's tax + city tax). With taxes around 15% under the current king, the listed 261,200 became ~300,400 at confirmation — so a player with 300,000 saw "you can afford it" prices but kept getting "you lack the gold" rejections with no explanation.

**Fix.** All three list-display sites in `RemoveCurse` (cursed backpack items, cursed equipped player gear, cursed team-member gear) now run `CityControlSystem.CalculateTaxedPrice(removalCost)` and show the tax-inclusive total — same number that gets compared against `player.Gold` at click time, same number that shows up in the confirmation prompt and the tax-breakdown block. No more silent surprise. The "you lack the gold" branch also now prints the actual shortfall (`"Total cost (with tax): X. You carry: Y. Short by: Z."`) so players can see exactly how much more is needed and decide whether to bank-withdraw or come back later. New loc key `magic_shop.curse_short_by` in all 5 languages.

## Royal Guard defense alert dead-ended

Spudman report: "joined the royal guards, had 2 separate events pop up to defend the castle. Once when leaving dungeon, and once when leaving castle. Both times it let me accept, then at the press any key to continue... I got the message 'You cannot go to Royal Castle from here'."

When a king's throne comes under attack and the player is on the royal guard roster, [BaseLocation.CheckGuardDefenseAlert](Scripts/Locations/BaseLocation.cs#L393) interrupts on the next location entry to prompt "rush to the castle? (Y/N)". On Y, the alert called `GameEngine.Instance.NavigateToLocation(GameLocation.Castle)` to teleport the player. That call routes through `LocationManager.NavigateTo` → `CanNavigateTo(currentLocationId, Castle)` → `navigationTable[from].Contains(Castle)`.

But `LocationManager.InitializeNavigationTable` has no entries for Castle as a destination from anywhere. The Castle is normally reached through `OutsideCastle` (which is itself reached from AnchorRoad), not via direct travel. So `CanNavigateTo(MainStreet, Castle)` returns false, the navigation prints `"You cannot go to Royal Castle from here"`, and the alert dead-ends — the guard's loyalty wasn't penalized (`PlayerResponded = true` was already set), but they also never participated in the defense.

This is an emergency teleport, not a walk through the city; it shouldn't be subject to the navigation-table walking-rules check.

**Fix.** Replaced the `NavigateToLocation` call with `throw new LocationExitException(GameLocation.Castle)`. `LocationManager.EnterLocation` already wraps the location body in a `try/catch (LocationExitException)` that calls `EnterLocation(ex.DestinationLocation, ...)` directly, bypassing the navigation table. Same pattern already used for the immortal-locked-to-Pantheon ([BaseLocation.cs:157](Scripts/Locations/BaseLocation.cs#L157)) and royal-decree-establishment-closed ([BaseLocation.cs:172](Scripts/Locations/BaseLocation.cs#L172)) flows. Edge case: if the alert fires when the player enters the Castle itself (the second case spudman reported — "leaving castle" likely means accept the alert as the second location-entry chain triggers on Castle's own entry), the throw is skipped — the player is already where they need to be, and re-entering Castle would just re-render the menu. The `PlayerNotified` flag set at line 409 already prevents the alert from firing twice on the same `ActiveDefenseEvent`.

No save schema change. No localization change.

## New preference: Hide Character/Monster Art

Player request: a way to skip the ASCII portraits and monster silhouettes without having to enable Screen Reader mode (which strips a lot more — borders, status bars, color-bracketed menus) or Compact Mode (which is for small terminals, not art-haters).

**New preference `[P] Hide Character/Monster Art`** in the preferences menu's Display section, between Compact Mode and Date Format. Per-character (saved on the Character + persisted in the save file), per-session in MUD mode (lives on `SessionContext` like `CompactMode` and `Language` already do), defaults to off. When toggled on:

- Race / class portraits at character creation fall back to the original card layout (same fallback that already runs when no portrait exists for a race / class).
- NPC portraits during `[T] Talk` dialogue are skipped.
- Monster silhouettes in single-monster, multi-monster, and "first monster of 3-or-fewer" combat displays are skipped.
- Old God boss reveal art (the animated portrait that plays before the boss intro) is skipped.

Everything else stays untouched: borders and status bars still render, color-bracket menus still render, dungeon-entrance / treasure / level-up / death / boss-victory event art all still play (those are tied to the existing screen-reader gate, not character/monster art). The toggle is independent of `ScreenReaderMode` and `CompactMode` — turning it on doesn't affect either; turning either of those on already skipped art via their own gates and continues to.

Save format: one new bool `DisableCharacterMonsterArt` in `PlayerData`. Pre-v0.57.9 saves load with the field defaulting to `false` (art shown — same as current behavior).

- `Scripts/Core/GameConfig.cs` — Version 0.57.9.
- `Scripts/Systems/InventorySystem.cs` — `GetHandedness` fallback branch now calls `ShopItemGenerator.InferWeaponType(item.Name)` to populate `weaponType`, instead of leaving it at `WeaponType.None`. Fixes Magician/Sage spell casting with procedurally-named staves, and every other inventory-equip path that cared about weapon type.
- `Scripts/Systems/SqlSaveBackend.cs` — `RecordWorldBossDamage` signature changed to return `(long remainingHp, bool wasKillingBlow)`. Uses conditional status flip (`UPDATE ... WHERE status = 'active'`) with row-count check as the atomic kill-claim primitive.
- `Scripts/Systems/WorldBossSystem.cs` — Caller destructures the tuple, branches on `wasKillingBlow`. Only the single killer prints the killing-blow line, broadcasts the defeat, posts the news, and calls `DistributeWorldBossRewards`. Other concurrent zero-damage landers print the "already defeated" line and exit cleanly.
- `Scripts/Systems/BugReportSystem.cs` — Removed the `<@owner>` prefix from forwarded Discord content.
- `web/ssh-proxy.js` — `handleBugReport` strips Discord mention syntax from incoming content and sets `allowed_mentions: { parse: [] }` on the webhook payload as a belt-and-suspenders check.
- `Scripts/Locations/TeamCornerLocation.cs` — Resurrect Teammate hotkey changed from `!` to `U` across visual / BBS compact / screen-reader menu renderers. Local `!` intercept removed so `TryProcessGlobalCommand` runs first and `!` stays bound to Report Bug globally. `ProcessChoice` switch grew `case "U"` for `ResurrectTeammate`.
- `Scripts/Systems/CombatEngine.cs` — On companion equip success (line 7790), suppress the raw `equipMsg` out-parameter from `EquipItem` (which leaks "Moved X to inventory" text for displaced items) and print a dedicated `loot_equipped_on_companion` line instead. Accurate per-item outcome is still printed by the displaced-items loop at ~7757.
- `Scripts/Locations/AnchorRoadLocation.cs` — `StartGangWar` now includes "ghost controller" teams (hold CTurf, zero alive members) in the rival-teams list, and the fight loop short-circuits to an unopposed-takeover flow when such a team is selected. Strips CTurf from all NPCs on the ghost team (even dead ones) and transfers turf cleanly.
- `Scripts/Locations/MagicShopLocation.cs` — Ravanella's stat-enchant now offers 13 options (was 5): adds Armor Power, HP, Mana, Agility, Charisma, Stamina, Constitution, Intelligence. `ApplyStatEnchant` extended with cases 6-13. New `IncrementLootEffect` helper handles CON / INT via `LootEffects` list (existing entries are summed in place, new entries are appended).
- `Scripts/Systems/QuestSystem.cs` — `CreateRoyalAudienceQuest` now clamps target floor to `[1, min(MaxDungeonLevel, player.Level + 10)]` via a local `ClampFloor` helper. Matches the board-quest `CapFloor` ceiling. Three floor-targeting branches (artifact, floor-clear, default-dungeon-investigation) switched from `Math.Max(1, ...)` (no upper bound) to the clamp.
- `Scripts/Systems/FeatureInteractionSystem.cs` — Room-feature stat-check cap raised from 20 to 40. Stat investment now matters past 200; committed specialists (stat 400+) auto-pass floor-100 DC 33 checks. Mid- and low-stat characters unaffected (curve below the cap is unchanged).
- `Scripts/Core/Items.cs` — New `EnforceMinLevelFromPower()` method on `Item` mirroring the Equipment-side helper: computes `power = max(Attack, Armor)`, bails for trinkets (power ≤ 15), else sets `MinLevel = clamp(power / 10, 1, 100)` if the current MinLevel is lower. Makes the drop display agree with the equip gate.
- `Scripts/Systems/CombatEngine.cs` (separate from the companion-equip fix above) — Three downward-clamp sites in the loot-drop handlers (lines 7305 / 7325 / 7377) replaced. Old code did `if (loot.MinLevel > result.Player.Level) loot.MinLevel = result.Player.Level` under the "if you killed it, you earned it" comment. New code calls `loot.EnforceMinLevelFromPower()` so the displayed MinLevel matches the value the equip path will re-enforce from power-tier.
- `Scripts/Systems/GriefSystem.cs` — New `IsGriefLive(GriefState)` private helper: a grief entry is only "live" when the subject is actually still dead. Companion grief checks `CompanionSystem.GetCompanion(g.CompanionId)` for `IsRecruited && !IsDead` (alive in party → stale). NPC grief checks `NPCSpawnSystem.ActiveNPCs` for the matching NpcId with `!IsDead && HP > 0`. All read sites (`IsGrieving`, `CurrentStage`, `GetActiveGriefDetails`, `GetCurrentEffects`, `GetCombatStartGriefMessage`, `GetPostCombatFlashback`) now filter through this helper instead of bare `!IsComplete`. `HasCompletedGriefCycle` and the permanent Wisdom bonus stay on raw `IsComplete` since the acceptance-stage reward is permanent regardless of subject state.
- `Scripts/Editor/PlayerSaveEditor.cs` — `ReviveCompanion` and the "mark every companion alive" bulk option now strip matching entries from `ActiveGriefs` and `GriefMemories` after clearing `IsDead`, matching the existing `OnlineAdminConsole` revive flow. Without this, the editor produced internally-inconsistent saves where the companion was alive but the grief entry kept firing.
- `Scripts/Locations/MagicShopLocation.cs` (separate from the Ravanella stat-enchant fix above) — Curse removal list now displays the tax-inclusive total via `CityControlSystem.CalculateTaxedPrice(removalCost)` instead of the pre-tax base. Both `RemoveCurseFromPlayerItem` and `RemoveCurseFromTeamEquipment` "no gold" branches now print the actual shortfall (`magic_shop.curse_short_by`) so the player sees exactly how much more is needed.
- `Scripts/Locations/BaseLocation.cs` — `CheckGuardDefenseAlert` now throws `LocationExitException(GameLocation.Castle)` to teleport the responding guard, instead of calling `GameEngine.Instance.NavigateToLocation(GameLocation.Castle)` which always failed because the navigation table has no entries for Castle as a destination. Skip the throw when already at the Castle (alert fired on Castle entry — player is already in position). Also adds `[P] Hide Character/Monster Art` in the preferences menu (visual + SR), a `case "P"` toggle handler, and the NPC-portrait gate in `[T] Talk` dialogue.
- `Scripts/Core/GameConfig.cs` (separate from version bump) — New `DisableCharacterMonsterArt` static property mirroring `CompactMode`'s SessionContext-aware getter/setter pattern.
- `Scripts/Server/SessionContext.cs` — New `DisableCharacterMonsterArt` field for per-session storage in MUD mode.
- `Scripts/Core/Character.cs` — New `DisableCharacterMonsterArt` property for per-character persistence.
- `Scripts/Systems/SaveDataStructures.cs` — New `DisableCharacterMonsterArt` field on `PlayerData`.
- `Scripts/Systems/SaveSystem.cs` — Persist `DisableCharacterMonsterArt` in player save.
- `Scripts/Core/GameEngine.cs` (separate from earlier entries) — Restore `DisableCharacterMonsterArt` on save load and on new-character creation; sync `Character → GameConfig` after load.
- `Scripts/Systems/CombatEngine.cs` (separate from earlier entries) — Three monster-silhouette display sites (single-monster, multi-monster ≤3, single-monster post-init) gated on `!GameConfig.DisableCharacterMonsterArt` alongside the existing SR / BBS / compact gates.
- `Scripts/Systems/OldGodBossSystem.cs` — Old God boss-reveal animated art gated on the new toggle.
- `Scripts/Systems/CharacterCreationSystem.cs` — Race and class preview short-circuit the portrait lookup when the toggle is on, falling through to the existing card layout used when no portrait exists.
- `README.md` — Version badge.
- 5 localization files (en/es/fr/hu/it) — New `world_boss.already_defeated`, `combat.loot_equipped_on_companion`, `anchor_road.ghost_takeover`, `magic_shop.curse_short_by`, `prefs.disable_char_monster_art`, `base.pref_char_monster_art_enabled` (+_desc), `base.pref_char_monster_art_disabled` (+_desc) keys. Updated `magic_shop.old_stat_options` and added `magic_shop.old_stat_options_2` / `_3` for the expanded Ravanella menu.
- Tests: 596 / 596 passing.
