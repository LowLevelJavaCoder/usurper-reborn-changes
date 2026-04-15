# v0.56.1 - Difficulty Tuning

v0.56.0 closed the class-completeness gaps; this release addresses "the game is a breeze and very easy." Champions feel like mini-bosses, floor bosses survive past round 1, Old Gods scale with your gear, and stamina actually matters.

## Champions 

Solo champions used to have 1.5x everything — the feedback said they felt like trash mobs with better loot. Now they're a real mini-boss encounter.

- **Solo champion stats**: **2.2x HP** (was 1.5x), **+30% damage** (was +50% — was overtuning because the old 1.5x multiplier applied to damage too), **+20% defense**. Separated HP from damage/defense so they're tanky without one-shotting.
- **Champion loot guaranteed 2 items** (was 60% chance for 1). If you survive a real mini-boss fight, you get real mini-boss loot.

## Floor Bosses 

Feedback said floor bosses die to a single crit or full-party burst. Now they're boss-tier.

- **Floor boss HP 2.0x → 2.8x**, **damage 1.25x** (was also 2.0x — damage scales less aggressively now), **defense 1.2x**. Multipliers are separate so HP can grow without turning damage into a one-shot cannon.
- **First-3-rounds damage cap**: during the first 3 rounds of a boss fight, incoming hits are capped at 15% MaxHP per hit (regular cap is 85% MaxHP for bosses, 75% for regulars). Prevents one-shot crits in round 1 while letting bosses ramp up.
- **Boss rewards bumped +40%**: XP multiplier 3x → 4.2x, gold multiplier 3x → 4.2x. Matches the difficulty increase so bosses remain worth fighting.
- **Champion rewards bumped +20%**: XP/gold 1.5x → 1.8x. Matches the champion difficulty bump.

## Old Gods

Feedback: "once you get your gear/stats going, Old Gods become easy. Veloura onward trivial with tank+healer." Most loved fight was 1v1 Aurelion where stamina actually ran out. Two mechanics preserve that:

- **Divine Scaling**: every Old God artifact you've collected makes **remaining** Old Gods harder. +10% MaxHP and +5% damage per artifact, capped at +40% HP / +20% damage (hit after 4 artifacts). Prevents gear-scaling trivialization.
- **Solo Old God adjustment**: when you fight an Old God alone (no teammates, no companions), the god hits **+15% harder** but you take **-20% damage**. Net result: solo fights stay tense and the stamina/mana pressure the stays intact; with a party, the god hits normally but its raw output is enough without the solo buff.

## Resource Management

Feedback: "I have been out of mana/stamina exactly once." Now stamina is a real constraint.

- **Stamina regen reduced**: was `5 + Stamina/10 + armor`, now `3 + Stamina/15 + armor`. Abilities feel like a real resource during extended fights.
- **Ability tier cost scaling**: level 50+ abilities cost **+25% stamina**, level 75+ cost **+40%**. Your signature high-level abilities now carry weight. Applied via a new `ClassAbilitySystem.GetEffectiveStaminaCost()` helper so all three ability paths (single-monster, multi-monster, PvP) share the same rule.
- **Potion prices doubled**: healing potion base 50 → 100 (+5 → +10 per level); mana potion base 75 → 150 (+5 → +10 per level). At level 100 a healing potion now costs ~1050g instead of 550g — meaningful at endgame when previously trivial.

## Bugfixes

- **Tank buffs leaked between combats**: new tank ability properties (TempDamageReduction, TempThornReflect, TempPercentRegen) weren't reset at combat start. Now reset in all three combat init paths (PvP, multi-monster, end-of-fight) and for teammates.
- **Monster ability damage bypassed tank buffs**: Shield Wall Formation / Divine Mandate were useless against boss abilities because the ability damage path didn't apply damage reduction or thorn reflect. Fixed in all three monster-ability damage branches (DirectDamage, DamageMultiplier life-steal, DamageMultiplier non-lifesteal).
- **First-3-rounds damage cap missing from boss abilities and companion damage**: the round-gated cap only applied to basic boss attacks. Now applies to boss abilities AND companion damage intake too — companions get the same early-round protection as the player.
- **Healer spec bonus didn't apply to spell healing**: the +20% bonus only worked on class ability heals. Now also applies to self-cast healing spells, ally-targeted heal spells, multi-target healing spells, and Bard party songs.
- **NPC teammates used base stamina cost**: the tier-scaled cost was only applied for the player. NPCs could cast level-50+ abilities without paying the +25/+40% cost. Now `CanUseAbility`, all NPC ability filters/spends, PvP computer AI, shaman abilities, and UI displays all go through `GetEffectiveStaminaCost`.
- **Noctura (betrayal fight) missing Divine Scaling**: the Noctura boss is created through a separate code path that didn't apply the artifact-based scaling. Now scales just like the main Old Gods.
- **NG+ cycle scaling missed WeapPow/ArmPow**: monster HP/Str/Def/Punch scaled per NG+ cycle but weapon power and armor power didn't. NG+ monsters dealt less weapon damage and had less armor than intended. Fixed in both single-monster and group-monster paths.

- **Multi-monster Backstab still at 2.0x**: the v0.56.0 Backstab double-crit fix reduced the multiplier from 2.0x to 1.75x in the single-monster path but missed the multi-monster path. Assassins in group fights were still dealing the overtuned damage. Now 1.75x in both paths.
- **Divine Mandate thorn reflect didn't credit kills**: if the reflected damage killed a monster, the kill wasn't added to `result.DefeatedMonsters`. Player lost XP, gold, and quest kill counts on reflect-kills. Fixed in all 4 reflect sites (player basic attack, player boss-ability, player ability-multiplier path, companion basic attack).
- **Deluge of Sanctity could fizzle despite healing component**: v0.56.0's heal-spells-never-fizzle only protected `SpellType == "Heal"` spells, but Deluge is typed as "Attack" and provides a 100 HP self-heal. Players relying on Deluge for clutch healing could eat a fizzle. Now also protects Deluge, Prison Siphon, Devour Essence, Consume the Fallen, and Cycle Rewind — all hybrid attack+heal spells where reliable healing is the design intent.

- **PvP Backstab still at 1.5x**: both v0.56.0 and the first two audits missed the PvP path. The single-monster and multi-monster paths were corrected to 1.75x, but arena/faction-ambush combat was still using the pre-fix 1.5x value. Now 1.75x everywhere.
- **Steal Life (Sage L11) could fizzle despite healing half**: the hybrid-spell exemption list added to prevent Deluge from fizzling missed Steal Life — same pattern (Attack-typed spell with heal component). Added to the exemption list.
- **Tank buff recast wasted the duration refresh**: Shield Wall Formation / Divine Mandate / Rage Challenge used `Math.Max` on duration when reapplied mid-buff, so a recast with the same duration as remaining would not refresh the timer. Now always writes fresh duration on recast.
- **Mending Meditation description lied**: claimed "Scales with WIS+INT" but the underlying heal formula uses CON+WIS like every other heal ability. Description corrected.

- **Solo Old God +15% damage missing from boss abilities**: the solo-fight adjustment (Old God hits +15% harder, player takes -20% less) was only applied to basic monster attacks — boss abilities (DirectDamage, life-steal, non-lifesteal multiplier) bypassed it entirely. Solo runs against Aurelion etc. had abilities that ignored the tension-preservation tuning. Now applied to all 3 boss ability damage paths consistently.
- **PvP AI ability selection used base stamina cost**: `MapCombatActionToAbility` checked `HasEnoughStamina(a.StaminaCost)` against the pre-scaling value, so a tier-50+/75+ ability could be selected when the player didn't actually have enough stamina to pay the effective cost. Now checks `GetEffectiveStaminaCost`.
- **PvP "not enough stamina" message showed base cost**: the error toast reported `selectedAbility.StaminaCost` instead of the effective cost, so players saw "need 20" when the real tier-scaled requirement was 25 or 28. Now shows effective cost.
- **Inn ability-equip menu showed base stamina cost**: the quickbar display at the Inn listed each ability's base `StaminaCost` — so players setting up a level-50+ ability saw a lower cost than they'd actually pay in combat. Now shows effective cost.
- **Healer Location and Dungeon Merchant used hardcoded old potion prices**: the v0.56.1 potion price doubling landed on `GameConfig.HealingPotion*` but Healer had local constants (`HealingPotionBaseCost = 50`, `HealingPotionPerLevel = 5`) and the dungeon merchant hardcoded `40 + floor * 5`. Healer and merchant were selling at roughly half the shop price — an economy exploit. Both now read from `GameConfig.HealingPotion*`; the dungeon merchant keeps a small floor-deep discount.

---

### Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.56.1; `OldGodDivineScalingHPPerArtifact/DamagePerArtifact`, `OldGodSoloDamageBonus/PlayerDamageReduction`, `BossFirstRoundsDamageCapPercent/Rounds` constants; `HealingPotionBaseCost` 50 → 100, `HealingPotionLevelMultiplier` 5 → 10; `ManaPotionBaseCost` 75 → 150, `ManaPotionLevelMultiplier` 5 → 10
- `Scripts/Core/Character.cs` — `RegenerateCombatStamina` formula changed from `5 + Stamina/10 + armor` to `3 + Stamina/15 + armor`
- `Scripts/Core/Monster.cs` — Boss XP/gold multiplier 3x → 4.2x; mini-boss 1.5x → 1.8x
- `Scripts/Systems/MonsterGenerator.cs` — `CalculateMonsterStats` now uses separate `hpMultiplier` / `damageMultiplier` / `defenseMultiplier` values; bosses 2.8x HP / 1.25x damage / 1.2x defense; champions 2.2x HP / 1.3x damage / 1.2x defense
- `Scripts/Systems/OldGodBossSystem.cs` — `CreateBossMonster` applies Divine Scaling based on `ArtifactSystem.GetCollectedCount()`
- `Scripts/Systems/ClassAbilitySystem.cs` — New `GetEffectiveStaminaCost()` helper: level 50+ cost +25%, level 75+ cost +40%
- `Scripts/Systems/CombatEngine.cs` — Boss first-3-rounds 15% MaxHP damage cap; solo Old God +15% damage / -20% player damage taken (now applied to all 3 boss ability damage paths, not just basic attacks); champion loot guaranteed 2 items (was 60% for 1); ability stamina cost tier scaling wired through single-monster and multi-monster ability paths; PvP Backstab 1.5x → 1.75x; tank buff duration always refreshes on recast (Shield Wall Formation / Divine Mandate / Rage Challenge); PvP AI ability selection and error message use `GetEffectiveStaminaCost` instead of base `StaminaCost`
- `Scripts/Systems/SpellSystem.cs` — Steal Life added to hybrid-spell fizzle exemption list
- `Scripts/Systems/ClassAbilitySystem.cs` — Mending Meditation description corrected from "WIS+INT" to "CON+WIS"
- `Scripts/Locations/InnLocation.cs` — Ability quickbar display uses `GetEffectiveStaminaCost` (shows tier-scaled cost, not base)
- `Scripts/Locations/HealerLocation.cs` — Removed local `HealingPotionBaseCost`/`HealingPotionPerLevel` constants; now reads `GameConfig.HealingPotionBaseCost`/`LevelMultiplier` so Healer stays in sync with shops after the v0.56.1 price doubling
- `Scripts/Locations/DungeonLocation.cs` — Dungeon merchant potion price now derived from `GameConfig.HealingPotionBaseCost`/`LevelMultiplier` with a small floor-deep discount instead of the hardcoded `40 + floor * 5`
- `Tests/MonsterTests.cs` — Updated boss/mini-boss XP multiplier tests for new 4.2x / 1.8x values
