# v0.57.12 - Alignment System Audit + Bank Guard Wage + Gauntlet Kill-Tracking + Prison Chat

## Prison Chat (PR #84 + Follow-up Hardening)

Community PR #84 (LowLevelJavaCoder) added slash-command handling to `PrisonLocation.ShowPrisonInterface` so imprisoned players can chat instead of being fully cut off from the online world. The base change — swapping `GetCharAsync` (single-key) for `ReadLineAsync` + routing `/`-prefixed input through `MudChatSystem.TryProcessCommand` — was merged as-is. Follow-up tightening in the same release:

- **Slash-command whitelist.** `MudChatSystem.TryProcessCommand` routes every command the chat system knows about — including group management (`/group`, `/leave`, `/disband`), guild admin (`/gcreate`, `/ginvite`, `/gkick`, `/gleave`, `/gtransfer`, `/grank`), and guild banking (`/gbank`, `/gwithdraw`, `/gdeposit`). A locked-in-cell prisoner recruiting dungeon parties or wiring guild gold doesn't make in-world sense and is an exploit surface. New `PrisonLocation.IsPrisonAllowedSlashCommand` gates the entry point on a communication-only allowlist (`say`, `s`, `shout`, `tell`, `t`, `emote`, `me`, `gossip`, `gos`, `who`, `w`, `title`, `guild`, `ginfo`, `gc`). Non-whitelisted commands show a gray "From this cell you can only speak — not act." line and swallow the input.
- **`MudChatSystem.GetChatDisplayName` reverted to `private`.** PR #84 widened its visibility to `public` but added no new caller. The helper is still used internally by room broadcast paths; no external code needs it. Reverted to narrow the API surface back to what's actually consumed.

## Zero-Reward Combat Victory (Anchor Road Gauntlet)

Player report from an Anchor Road Gauntlet run: main attack critted Prime Phoenix for 14,476 damage, Phoenix Fire and Frostbite and Siphon procs all fired after the hit, but the victory banner showed "Defeated 0 monster(s)! Experience gained: 0 Gold gained: 0." No wave reward, no XP, no gold. The boss fight later in the same gauntlet run worked fine, so the bug was intermittent.

Root cause: `PlayerVsMonster` (the single-monster entry point) is a legacy wrapper at [CombatEngine.cs:174](Scripts/Systems/CombatEngine.cs#L174) that redirects to the multi-monster engine `PlayerVsMonsters` (`new List<Monster> { monster }`). Multi-monster's victory path at [CombatEngine.cs:1402](Scripts/Systems/CombatEngine.cs#L1402) renders rewards from `result.DefeatedMonsters.Count` — but `ExecuteSingleAttack` (which applies main attack damage at `target.HP = Math.Max(0, target.HP - actualDamage)`) and `CheckElementalEnchantProcs` (which deals proc damage) both lack a `result.DefeatedMonsters.Add(target)` call after their kill-damage. Abilities, DoT ticks, and several other damage paths do register kills correctly — but the vanilla basic attack does not. The single-monster `HandleVictory` has a defensive catch-up at [CombatEngine.cs:6238](Scripts/Systems/CombatEngine.cs#L6238) (`if (result.DefeatedMonsters == null || result.DefeatedMonsters.Count == 0) result.DefeatedMonsters = new List<Monster> { result.Monster };`) but `HandleVictoryMultiMonster` has no such safety net. A one-shot basic attack on a single-monster `PlayerVsMonsters` call therefore killed the monster, the combat loop broke out at `!monsters.Any(m => m.IsAlive)`, and the victory handler ran with an empty list → zero kills, zero rewards.

Fix: add the safety-net sweep at both `HandleVictoryMultiMonster` entry points (normal + wizard godmode) just before calling the victory handler. Any monster with `!m.IsAlive` that isn't already in `DefeatedMonsters` gets credited. This closes every unknown kill-credit gap in the basic attack path, enchant procs, and any future damage site without requiring a visit to each.

## Bank Guard Wage Frozen at Hire-Time Level

Player report: "I noticed payment for bank guards does not adjust with player level. I thought it was supposed to change automatically. I resigned and applied again to see the changed payment."

The bank-guard hire flow at [BankLocation.cs:986](Scripts/Locations/BankLocation.cs#L986) computes the daily wage as `1000 + (Level * GameConfig.GuardSalaryPerLevel)` (150 gold per level) and stores it in `Character.BankWage` at hire time. The daily payout path at [BankLocation.cs:1434](Scripts/Locations/BankLocation.cs#L1434) paid `player.BankWage` directly — but nothing ever recomputed the field on level-up. A player hired at level 50 (wage 8,500g) stayed stuck at 8,500g forever, even after hitting level 100 (where the correct wage is 16,000g). Only workaround was to resign and re-apply — which the player shouldn't have to discover.

Fix: new `BankLocation.CalculateGuardWage(Character)` static helper as the single source of truth for the hire formula. Called from three places: (a) the hire prompt path (consistent with before), (b) the daily payout in `ProcessDailyMaintenance` so the paid amount always matches the player's current level, and (c) `BankLocation.DisplayLocation` so the bank UI shows the live current-level wage on entry even before the next daily tick fires. Pre-v0.57.12 guard characters with frozen wages will auto-correct to the level-appropriate wage on next bank visit.

## The 15,000 Chivalry Bug

Multiple players had accumulated Chivalry values well past the 1000 cap — one reported at 15,000. The cap was supposed to be enforced at 1000 on each side (Chivalry, Darkness) by `AlignmentSystem.ModifyAlignment`, and v0.57.0's paired-movement system (`ChangeAlignment`) was supposed to apply both sides of the ledger on every good/evil deed so neither scale grew unchecked. In practice, neither was happening.

## Root Cause

A comprehensive audit of the alignment system found **43 mutation sites across the codebase. Only 8 were compliant.** 35+ sites mutated `Character.Chivalry` and `Character.Darkness` directly with raw `+=` / `-=` / `=` statements that never touched `AlignmentSystem.ModifyAlignment` (which clamps) or `AlignmentSystem.ChangeAlignment` (which applies paired movement). Over many sessions, these bypass sites accumulated unbounded — Church donations, Dark Alley evil deeds, quest rewards, dungeon lore fragments, dungeon soul-path choices, prison escapes, stage rewards, honor duels, pickpocket, fencing stolen goods, steroid/drug use, alchemist failures, pit fights, loan repayments. Every one of them had the same shape: `currentPlayer.Chivalry += 5` or `currentPlayer.Darkness += 3` with no cap check, no paired reduction.

The audit also surfaced that `Character.Chivalry` and `Character.Darkness` were plain auto-properties — no setter validation, so callers could overflow freely. Save/load paths deserialized whatever was in the JSON without validation, so a save containing `"Chivalry": 15000` loaded as 15000. And the single hardcoded `1000` literal in `ModifyAlignment` was the only cap in the entire codebase — no `GameConfig` constant.

## Fix (Three Layers of Defense)

**Layer 1: `GameConfig.AlignmentCap` constant.** Replaces the hardcoded `1000` literal in `ModifyAlignment`. Single source of truth for the cap going forward.

**Layer 2: Character setter clamps.** `Character.Chivalry` and `Character.Darkness` converted from auto-props to backing-field properties with `Math.Clamp(value, 0L, GameConfig.AlignmentCap)` in the setter. Every future mutation site, compliant or not, is now automatically bounded. This is the ultimate safety net — a contributor three years from now who writes `player.Chivalry += 500` without thinking can't overflow the cap.

**Layer 3: Retroactive paired-movement heal on load.** New static `AlignmentSystem.HealOverflow(long rawChivalry, long rawDarkness)` method. If a pre-v0.57.12 save loads with Chivalry > cap, the method reduces Darkness by `(excess / 2)` (simulating what paired movement would have done at mutation time), then clamps Chivalry to the cap. Mirror for Darkness overflow. Inputs floored at zero for safety. Wired into three load sites: `GameEngine.LoadSaveByFileName` (player), `GameEngine` NPC restore from SaveSystem, and `WorldSimService.LoadNPCs` (online-mode shared state). A player with 15,000 Chivalry and 0 Darkness loads with 1000 Chivalry and 0 Darkness (Darkness floored). A player with 1500 Chivalry and 600 Darkness loads with 1000 / 350 (600 - 500/2 = 350).

## Second Audit Pass — 50 More Missed Sites

A fresh pass through the codebase after Phase 2 turned up roughly **50 additional bypass sites** the first audit missed — spread across DungeonLocation (22 sites), CastleLocation (15), InnLocation (3), ChurchLocation (3), TempleLocation (2), PrisonWalkLocation (2), MainStreetLocation (2), LoveStreetLocation (2), BetrayalSystem (3), DialogueSystem (2), and FamilySystem (2 player-facing + 4 NPC-init). Per-slot breakdown under Phase 3 in Files Changed. The three-layer defense from Phase 1 was already bounding all of these against overflow — the setter clamp is the ultimate backstop and runs whether or not a site routes through the helper. Phase 3 went through the additional one-sided sites and routed them through `ChangeAlignment` so v0.57.0's paired movement actually fires.

## Real Bugs Surfaced by the Audit Passes

**Unreachable thresholds found by grepping for numeric `Chivalry`/`Darkness` comparisons:**

- `BetrayalSystem.cs:536` — KingsAdvisor forgiveness gated on `player.Chivalry > 2000`. Fixed to `>= 800` (Holy-tier).
- `CombatEngine.cs:18460` and `:18668` — "Deal with Death" dark bargain required and cost **10,000 Darkness**. Unreachable with cap=1000. Scaled threshold and cost both down to **500** (half cap). Players who accumulate serious darkness can now access the feature; the description string and debug message both updated accordingly. The `>= 10000` threshold is extra evidence the cap was being violated when these were written.
- `DreamSystem.cs:666` — "The Dark Welcomes You" narrative dream gated on `MinDarkness = 3000`. Dream was unreachable. Scaled to 800 (Evil-tier).
- `DreamSystem.cs:681` — "The Light Remembers" narrative dream gated on `MinChivalry = 3000`. Also unreachable. Scaled to 800 (Holy-tier).

**Misleading display text fixed:**

- `OldGodsData.cs:211` — Veloura's `SaveRequirement` description claimed `"Chivalry >= 5000 AND completed a romance questline"`. The actual save check doesn't touch Chivalry — it checks artifact possession. Description rewritten to `"Possess the Soulweaver's Loom artifact AND completed a romance questline"` to match reality.
- `OldGodsData.cs:518` — Terravok's SaveRequirement description similarly claimed `"Chivalry >= 3000 AND no lies told in dialogue"`. Rewritten to reference the matching artifact.

**Dead / contradictory constants removed:**

- `GameConfig.cs:592-593` — `public const int MaxChivalry = 30000;` and `public const int MaxDarkness = 30000;`. No callers reference them (grep confirmed) but they contradict the authoritative `AlignmentCap = 1000`. They're exactly the kind of ghost-ceiling a future contributor would find and use, perpetuating the overflow class of bug. Removed, replaced with a comment pointing future readers to `AlignmentCap`.

## Phase 2: Routing Bypass Sites Through `ChangeAlignment`

Beyond the defense-in-depth setter clamp, the audit also surfaced that v0.57.0's paired-movement design was silently broken at most good/evil deed sites — a player who did 100 Dark Alley evil deeds gained 100 rounds of Darkness with zero Chivalry reduction, because every evil deed was a one-sided `Darkness +=` with no corresponding `Chivalry -=`. The v0.57.0 `ChangeAlignment` helper was only being called from 7 sites. Phase 2 routed 20+ paired-eligible bypass sites through it so the paired-movement design actually fires:

**Dark Alley (11 sites, all evil deeds):** drug pen-stat purchase, steroids, alchemist failures, pickpocket, pit fight (monster and NPC variants), fence stolen goods, evil deed failure (partial darkness), evil deed success (full darkness). Loan repayment's `+1 Chivalry` also routed (keeping your word to criminals now also reduces Darkness slightly).

**Church (1 site):** random post-healing Chivalry bonus now applies paired movement. (Explicit two-sided sites — donation, blessing, confession — already handle their own asymmetric Chivalry up + Darkness down, left as-is; the setter clamps catch any overflow.)

**Quest rewards (2 sites):** `QuestRewardType.Chivalry` and `QuestRewardType.Darkness` now apply paired movement. Completing a good-aligned quest chain no longer leaves a player with ever-accumulating Chivalry and untouched Darkness.

**Feature interaction system (4 sites):** lore fragment alignment shifts (light and dark) and soul-path choice alignment shifts in puzzle/feature rooms both route through `ChangeAlignment`.

**Anchor Road prison escape (2 sites):** successful escape (+50 Chivalry) and getting caught (+25 Darkness) both apply paired movement.

**BaseLocation potion stages (2 sites):** stage reward `ChivalryBonus` and post-duel honor +5 Chivalry both route through `ChangeAlignment`.

**Left as direct mutation (deliberately):** bank robbery's `Chivalry = 0` (punishment reset), royal pardon's `Darkness = 0` (mercy reset), execution penalty's `Chivalry -= 5000` and `Darkness += 500` (specialized one-shot with explicit both-sided values), dark bargain's `Darkness -= 10000` (nuke), daily royal loan penalty (already explicitly clamped), MoralParadox explicit `ChivalryChange` + `DarknessChange` from choice data (caller provides both sides), Church donation/blessing/confession two-sided blocks (already paired with custom-tuned amounts), FamilySystem family-bonus both-sided data values, MagicShop dark ritual (already manually paired), ArtifactSystem per-use artifact effects (per-combat bonuses, not player deeds), pardon partial-darkness-reduction decrement, drug combat bonus (transient, already clamped with `Min`). The setter clamp catches any overflow from these sites automatically — no behavior change needed.

## Phase 3: Second-Pass Routing (~40 additional sites)

**DungeonLocation (22 sites):** Old God defeat outcomes (killed/saved/allied/spared), scroll blessings, prayer for fallen, duelist interactions (victory/decline/insult/slay), damsel rescue/ruffian, wounded man (heal/bandage/rob), shrine desecration, merchant robbery (leader + group share), lost explorer (rob/guide), beggar (give/rob). All one-sided good/evil events.

**CastleLocation (14 sites, 1 left direct):** execute prisoner, wizard court magic, orphan commissions (loyalty/mercenary/NPC/adopt/gifts), knighthood, loan repayment, bounty placement (target), crime reporting, tax relief petition, treasury donation, royal guard join. Pardon partial-darkness-reduction left direct (legitimate decrement, not a new evil deed).

**InnLocation (3 sites):** Seth Able defeat, room invasion, attack online player.

**ChurchLocation (2 sites missed by first pass):** marriage bonus, bishop's rare 25% blessing reward. Combined with Phase 2's healing route, now 3 Church sites route through `ChangeAlignment`.

**TempleLocation (2 sites):** evil-god sacrifice, good-god sacrifice. Previously one-sided even though semantically a good/evil deed.

**PrisonWalkLocation (2 sites):** prisoner rescue (good), criminal activity (evil).

**MainStreetLocation (2 sites):** unprovoked street attack (evil), good deed menu action.

**LoveStreetLocation (2 sites):** seedy encounter darkness, plus the `GiveDarkness(Character, int)` helper itself was rewritten so any current or future caller of that helper gets paired movement automatically.

**DialogueSystem (2 sites):** `EffectType.AddChivalry` and `EffectType.AddDarkness` — data-driven dialogue-tree effects now apply paired movement on both directions.

**BetrayalSystem (3 edits):** `BetrayalType.Political` +100 Darkness, final Betrayal +200 Darkness (both major evil acts), plus the unreachable `Chivalry > 2000` → `Chivalry >= 800` threshold fix described above.

## Phase 4: Third Audit Pass (~20 more sites + 3 more unreachable thresholds)

A third pass with different grep patterns (numeric alignment comparisons, full `+=` listing without `-B 1` dedup) caught entire clusters the first two passes missed: **NPCPetitionSystem.cs (17 sites)**, **OldGodBossSystem.cs (2 sites)**, and **2 more TempleLocation sites** in a separate method from the Phase 3 route. It also surfaced the four additional unreachable-threshold bugs above (dark bargain 10,000 threshold + cost, two 3,000 narrative dreams, and the misleading OldGodsData description strings) and the two dead `MaxChivalry`/`MaxDarkness = 30000` constants.

**NPCPetitionSystem (17 sites):** save-marriage help, exploitative-affair success (scandal), exploitative-affair failure, wingman success, sabotage, custody mediation, and 11 royal-audience outcomes (tax grant/halve/deny, justice investigate, monster send/promise/dismiss, marriage bless/deny, dying elder forgive/protect).

**OldGodBossSystem (2 sites):** save-Old-God chivalry reward (fires in two different code paths for the save-quest resolution and the in-combat save-outcome path).

**TempleLocation +2 sites:** `GivePlayerAlignment` helper (separate from the Phase 3-routed sacrifice method) — evil-god devotion and good-god devotion both now apply paired movement.

## Phase 5: Fourth Audit Pass (Scaled Formulas + Data Values)

A fourth pass looking specifically at scaled formulas (`Chivalry / N`, `Darkness * N`) and canned data values turned up two more items worth fixing plus one adjacent bug not in scope.

**Numeric rebalance — `PrisonLocation.cs:511` pardon chance divisor.** `pardonChance = 10 + (int)(player.Chivalry / 500)` was scaled against the dead `MaxChivalry = 30000` constant — at the old ceiling it gave up to +60 bonus, but with `AlignmentCap = 1000` actually enforced, the max bonus is +2 (effectively inert). The outer `Math.Clamp(pardonChance, 5, 40)` still shapes the result. Divisor changed to `/50` so max Chivalry gives +20 bonus, preserving the intended spread within the existing clamp.

**Data value cleanup — `MoralParadoxSystem.cs:506`.** `DarknessChange = 5000` (with comment "Take on the darkness") was scaled against the same dead constant. With the setter clamp at 1000, the player always landed at max darkness anyway — behavior was correct but the literal was misleading. Reduced to 1000 to match the cap; the narrative intent ("absorb the world's darkness until you max out") is preserved.

## Adjacent Bugs Discovered (Not Fixed — Not Alignment Regressions)

**`TownNPCStorySystem.cs` — `NPCReward.ChivalryBonus` field is dead code.** The field is populated at two sites (line 103 with `ChivalryBonus = 50`, line 438 with `ChivalryBonus = 100`) but `NPCReward` has no consumer anywhere in the codebase. Neither `reward.ChivalryBonus` nor the sibling fields (`ItemId`, `Wisdom`, `Dexterity`, `WaveFragment`, `AwakeningMoment`) are ever READ. Six NPC story stages define rewards that players never actually receive. Pre-existing bug, surfaced during alignment audit — fixing it means wiring a `GrantReward(NPCReward)` method through TownNPCStorySystem's stage-completion flow, which covers 6 data types (inventory item, 2 stat bumps, Wave Fragment, Awakening Moment, chivalry), and belongs in its own release. Not a v0.57.12 regression.

## Formula Drift (Left As-Is — Intentional Scaling Decision)

Several scaled-divisor formulas were designed against the old pre-cap assumption (`MaxChivalry = 30000`) and now give smaller bonuses with `AlignmentCap = 1000` actually enforced. These are left as-is because they still produce meaningful bonuses and changing them is a balance decision, not a bug fix:

- `CombatEngine.cs:3706` — `soulPower = (player.Chivalry / 10) + (player.Level * 5)` — max +100 from Chivalry at cap. At L100 player: 100 + 500 + 10-30 = ~630 soul damage. Still meaningful.
- `CombatEngine.cs:11700` — Same formula in a second holy-damage code path. Same analysis.
- `CastleLocation.cs:4110` — `acceptChance = 50 + (int)(currentPlayer.Chivalry / 10) + ...` — max +100 chivalry bonus. Audience acceptance cap still reachable with level/chivalry combined.
- `CastleLocation.cs:6492` — `pardonCost = currentPlayer.Darkness * 50 * ...` — at cap, max pardon cost = ~550,000g at level 100. Reasonable penalty.
- `WorldSimulator.cs:1876` / `:3879` — NPC simulation weights already `Math.Min`-capped (`0.10f`, `0.20f` ceilings) — formulas hit their caps well before alignment saturates.

## Numbers

- **~110 alignment mutation sites** audited across the codebase (43 + 50 + 21 across four passes)
- **~80 bypass sites routed** through `AlignmentSystem.ChangeAlignment` across Phase 2 + Phase 3 + Phase 4
- **6 real bugs fixed**: `BetrayalSystem.cs:536` unreachable `Chivalry > 2000` (→ `>= 800`), `CombatEngine.cs:18460/18668` dark bargain 10,000 Darkness threshold and cost (→ 500), `DreamSystem.cs:666/681` two narrative dreams gated on 3,000 alignment (→ 800), 2 misleading `SaveRequirement` description strings in `OldGodsData.cs`, 2 dead `MaxChivalry`/`MaxDarkness = 30000` constants removed from `GameConfig.cs`, `PrisonLocation.cs:511` pardon chance divisor (/500 → /50) un-inerted
- **1 data-value cleanup**: `MoralParadoxSystem.cs:506` `DarknessChange = 5000` → `1000` (cosmetic — setter was already clamping)
- **1 adjacent bug flagged**: `TownNPCStorySystem.NPCReward` is declared-but-never-read; 6 stage rewards defined but never granted. Pre-existing, out-of-scope for alignment audit.
- **15** new unit tests in `AlignmentSystemTests` covering setter clamp (both scales, negative inputs, overflow `+=`) and `HealOverflow` (both directions, excess/2 reduction, double overflow, negative inputs, chivalry-only and darkness-only accessors)
- **641/641** tests passing (was 627 — 14 new)
- **No save format change.** Pre-v0.57.12 saves with out-of-range alignment self-heal on next login with retroactive paired movement applied.

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.57.12; new `AlignmentCap = 1000` constant with comment explaining the defense-in-depth layers
- `Scripts/Core/Character.cs` — `Chivalry` and `Darkness` converted from auto-props to backing-field properties with `Math.Clamp(value, 0L, GameConfig.AlignmentCap)` setters
- `Scripts/Systems/AlignmentSystem.cs` — `ModifyAlignment` now uses `GameConfig.AlignmentCap` instead of hardcoded 1000; new `HealOverflow(long, long) → (long, long)` static method with paired-movement retroactive heal; new `HealOverflowChivalry` and `HealOverflowDarkness` convenience accessors for object-initializer syntax at load sites
- `Scripts/Core/GameEngine.cs` — Player load (line ~4085) and NPC restore (line ~5141) now route `Chivalry` / `Darkness` through `AlignmentSystem.HealOverflowChivalry` / `HealOverflowDarkness`
- `Scripts/Systems/WorldSimService.cs` — Online-mode NPC load (line ~1319) also routes through `HealOverflow` accessors
- `Scripts/Locations/DarkAlleyLocation.cs` — 11 bypass sites routed through `AlignmentSystem.Instance.ChangeAlignment` (drug pen, steroids, alchemist failure, pickpocket, pit fight ×2, loan paid ×2, fence, evil deed partial, evil deed success)
- `Scripts/Locations/ChurchLocation.cs` — post-healing Chivalry bonus routed through `ChangeAlignment`
- `Scripts/Systems/QuestSystem.cs` — `QuestRewardType.Chivalry` and `QuestRewardType.Darkness` reward paths routed through `ChangeAlignment`
- `Scripts/Systems/FeatureInteractionSystem.cs` — lore alignment shifts (line ~167) and soul-path choice alignment shifts (line ~880) routed through `ChangeAlignment`
- `Scripts/Locations/AnchorRoadLocation.cs` — prison escape +50 Chivalry and escape-caught +25 Darkness routed through `ChangeAlignment`
- `Scripts/Locations/BaseLocation.cs` — stage reward `ChivalryBonus` and post-duel honor +5 Chivalry routed through `ChangeAlignment`
- `Scripts/Locations/DungeonLocation.cs` (Phase 3) — 22 bypass sites routed (Old God outcomes, scroll blessings, prayer, duelist 4 outcomes, damsel 2, wounded man 3, shrine desecrate, merchant rob leader + per-member, explorer rob/guide, beggar give/rob)
- `Scripts/Locations/CastleLocation.cs` (Phase 3) — 14 sites routed (execute, wizard court, orphan 5 flows, knighthood, loan, bounty, report, tax relief, treasury donation, royal guard)
- `Scripts/Locations/InnLocation.cs` (Phase 3) — 3 sites routed (Seth defeat, room invasion, PvP attack)
- `Scripts/Locations/ChurchLocation.cs` (Phase 3) — 2 additional sites routed (marriage, bishop blessing reward)
- `Scripts/Locations/TempleLocation.cs` (Phase 3) — 2 sites routed (evil-god + good-god sacrifice)
- `Scripts/Locations/PrisonWalkLocation.cs` (Phase 3) — 2 sites routed (rescue, crime)
- `Scripts/Locations/MainStreetLocation.cs` (Phase 3) — 2 sites routed (street attack, good deed menu)
- `Scripts/Locations/LoveStreetLocation.cs` (Phase 3) — 2 sites routed including the `GiveDarkness` helper (pairs all current + future callers)
- `Scripts/Systems/DialogueSystem.cs` (Phase 3) — `EffectType.AddChivalry` and `EffectType.AddDarkness` both route through `ChangeAlignment`
- `Scripts/Systems/BetrayalSystem.cs` (Phase 3) — `KingsAdvisor` Chivalry threshold `> 2000` → `>= 800` (fix unreachable check), political betrayal +100 Darkness and final betrayal +200 Darkness both route through `ChangeAlignment`
- `Scripts/Systems/CombatEngine.cs` (Phase 4) — "Deal with Death" dark bargain unlock threshold `Darkness >= 10000` → `>= 500`; cost `Darkness -= 10000` → `-= 500`; description string and localization updated
- `Scripts/Systems/DreamSystem.cs` (Phase 4) — "The Dark Welcomes You" (`MinDarkness 3000→800`) and "The Light Remembers" (`MinChivalry 3000→800`) narrative dreams now reachable
- `Scripts/Data/OldGodsData.cs` (Phase 4) — Veloura and Terravok `SaveRequirement` description strings rewritten to reference actual artifact requirements (no logic change, display text was misleading — actual save-eligibility was always artifact-based)
- `Scripts/Core/GameConfig.cs` (Phase 4) — Removed dead `MaxChivalry = 30000` and `MaxDarkness = 30000` constants (no callers, contradicted authoritative `AlignmentCap = 1000`)
- `Scripts/Systems/NPCPetitionSystem.cs` (Phase 4) — 17 one-sided bypass sites routed (save-marriage, exploit affair ×2, wingman, sabotage, custody mediation, 11 royal-audience outcomes)
- `Scripts/Systems/OldGodBossSystem.cs` (Phase 4) — save-Old-God chivalry reward routed through `ChangeAlignment` in both resolution paths
- `Scripts/Locations/TempleLocation.cs` (Phase 4) — 2 additional sites in `GivePlayerAlignment` helper (evil-god + good-god devotion) routed through `ChangeAlignment`
- `Scripts/Locations/PrisonLocation.cs` (Phase 5) — NPC-king pardon chance divisor `/500` → `/50` (was inert with enforced cap; max chivalry bonus restored from +2 to +20 within existing `Clamp(5, 40)`)
- `Scripts/Systems/MoralParadoxSystem.cs` (Phase 5) — "Take on the darkness" choice `DarknessChange = 5000` → `1000` (matches cap; setter was already clamping)
- `Scripts/Locations/BankLocation.cs` (separate bug fix) — new `CalculateGuardWage(Character)` static helper; `ProcessDailyMaintenance` recomputes `BankWage` from current level before paying so it scales automatically with level-ups; `DisplayLocation` refreshes the displayed wage on bank entry so the UI reflects the live current-level value; hire prompt uses the same helper for consistency
- `Scripts/Systems/CombatEngine.cs` (separate bug fix) — kill-tracking safety net added before both `HandleVictoryMultiMonster` call sites; any monster dead but not in `DefeatedMonsters` gets swept in. Closes the "0 monsters slain, 0 XP, 0 gold" victory bug when a basic attack or enchant proc delivered the killing blow.
- `Tests/AlignmentSystemTests.cs` — 15 new tests in a v0.57.12 Setter Clamp & HealOverflow region

## Deliberately Not Changed

- NPC alignment mutations in `WorldSimulator.cs` and `NPCSpawnSystem.cs` — the setter clamp from Phase 1 now catches overflow there automatically; routing NPC-side sites through `ChangeAlignment` would have changed NPC-behavior tuning with no corresponding payoff for the player-facing 15k bug.
- `BankLocation.cs:1243` `Chivalry = 0` (bank robbery punishment), `CastleLocation.cs:6554` `Darkness = 0` (royal pardon), `CastleLocation.cs:1943-1944` execution penalty, `CombatEngine.cs:18668` dark bargain, `DailySystemManager.cs:926,936,952` royal loan penalty, `MoralParadoxSystem.cs:820,824` paradox choice effects — all left as explicit direct mutations with setter clamp as backstop. These are either hard resets, specialized one-offs, or data-driven both-sided choices where routing through `ChangeAlignment` would break the explicit amounts the designer encoded.
