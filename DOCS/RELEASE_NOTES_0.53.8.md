# Usurper Reborn v0.53.8 Release Notes

**Version Name:** Ancestral Spirits

## AoE Ability Skip List Fix (Critical)

The v0.53.7 AoE double-damage fix broke multiple AoE abilities by adding them to a skip list without verifying they had dedicated damage handlers. Abilities on the skip list had their base damage suppressed, but if they had no external handler, they dealt zero damage.

**Abilities broken in v0.53.7, now fixed:**
- **Whirlwind** (Warrior/Barbarian) — no dedicated handler, relies on base damage
- **Volley / Arrow Storm** (Ranger) — uses `"aoe"` effect whose handler was inside the skipped block
- **Chain Lightning** (Mystic Shaman) — no dedicated handler
- **Corrosive Cloud** (Alchemist) — no dedicated handler
- **Harmonic Crescendo** (Wavecaller) — no dedicated handler

The skip list now only contains effects with verified external damage loops: `crescendo_aoe`, `aoe_holy`, `fire`, `void_rupture`, `dissonant_wave`, `aoe_taunt`, `grand_finale_jester`, `execute_all`, `shaman_chain_lightning`.

## Harmonic Shield Party Fix

Harmonic Shield (Wavecaller ability) had two bugs:
- **Player didn't receive +40 DEF** — the comment said "handled" by the generic ability handler but it wasn't actually applied
- **Damage reflection only on caster** — teammates received the DEF bonus but not the `Reflecting` status effect

Now properly applies +40 DEF AND damage reflection to the entire party (caster + all living teammates) in both single-monster and multi-monster combat paths.

## Two-Handed Weapon Shield Loot Fix

Companions using two-handed weapons (Lyris with a bow) could auto-pick up shields from loot, which unequipped their two-handed weapon and left them weaponless. Shield/off-hand loot is now skipped for teammates who are two-handing.

## ATK/DEF Buff Overwrite Fix

The single-monster `ApplyAbilityEffects` path used `=` (overwrite) for attack and defense buffs instead of the "keep higher buff" pattern already used in the multi-monster path. A weaker buff (e.g., Battle Cry +40 ATK) would overwrite a stronger one (e.g., Berserker Rage +60 ATK). Now both paths use `Math.Max` — a weaker buff refreshes duration but never reduces the bonus.

## Barbarian Ability Audit

**Primal Scream differentiation**: Base damage increased from 45 to 90 (was nearly identical to Whirlwind at 40). Now adds 25% confusion chance on surviving targets for 2 rounds. Properly distinct from Whirlwind as a higher-level AoE with CC.

## Jester Ability Audit (5 bugs fixed)

- **Vicious Mockery** — Distraction penalty was flat -5 to hit regardless of level. Now scales: `5 + level/5 + CHA/10`. Companion miss chance scales from 27% to 60% (capped). Hardcoded English localized.
- **Charming Performance** — Description said "confuse" but effect is "charm" (different mechanic). Description corrected. Hardcoded English in single-monster path localized.
- **Deadly Joke** — Hardcoded English in single-monster path ("bewildered by the joke" / "doesn't get the joke") localized.
- **Grand Finale** — 60 base damage at level 72 was weaker than Whirlwind (40 at level 55) despite being a capstone. Buffed to 120 base with new dedicated `"grand_finale_jester"` handler for AoE diminishing damage + party inspire (+15 ATK for 2 rounds).
- **Carnival of Chaos** — Confusion effect was missing in single-monster combat path. AoE confusion now applied in both paths.

## Cleric Spell Audit (25 spells)

All 25 Cleric spells audited. Every spell had an inaccurate description (original v1.0 values never updated when spells were rebalanced) and hardcoded English combat messages. All 25 descriptions corrected to show actual base values and scaling. All 25 combat messages localized with `Loc.Get()`. 15 new localization keys added to all 5 languages.

Notable description corrections:
- Cure Light: 4-7 → 12-22 hp
- Cure Wounds: 15-25 → 25-40 hp
- Cure Critical: 40-55 → 50-75 hp
- Holy Smite: 35-50 → 45-65
- Armor of Faith: +25 → +28
- Divine Intervention: +80 → +85
- God's Finger: 300-400 → 320-450

## Assassin Ability Audit (8 bugs fixed)

- **Backstab** — `SpecialEffect` was `"critical"` (prints text only) instead of `"backstab"` (actual damage multiplier). Never dealt bonus damage despite "Guaranteed critical hit" description. Fixed: now uses `"backstab"` effect with 2x guaranteed crit damage in both combat paths.
- **Poison Blade** — Hardcoded English in single-monster path localized.
- **Shadow Step** — Description claimed CON scaling but DEF bonus was flat 50. Added CON scaling: `50 + CON/5`. Hardcoded English localized.
- **Death Mark** — Hardcoded English in single-monster path localized.
- **Assassinate** — Description said "below 15% HP" but code checks 25%. Hidden 50% success roll not documented. Description corrected. Hardcoded English in single-monster path localized. Single-monster path now applies full damage above threshold too (was doing nothing).
- **Vanish** — Description promised "next attack from stealth crits" but Hidden status had no crit mechanic. Added: Hidden status now guarantees auto-crit on next basic attack (consumed on use). CON scaling added: `80 + CON/4`. Hardcoded English localized.
- **Noctura's Embrace** — Description claimed CHA scaling but bonuses are flat. Description corrected.
- **Blade Dance** — 38 base damage at level 78 was weaker than Whirlwind (40 at level 55). Buffed to 110 base.
- **Death Blossom** — Multiple critical bugs: damage was SPLIT among targets (not per-target), was in skip list causing double-damage, description said 15% execute threshold but code uses 30%, single-monster path only worked below 30% (did nothing above). All fixed: per-target damage with diminishing, correct skip list, single-monster always applies damage, 5 hardcoded strings localized.

## Mystic Shaman Ability Audit (1 bug fixed)

- **Chain Lightning** — Primary target took double damage (base damage + handler both applied). Added to AoE skip list so only the chain handler deals damage. Hardcoded English chain message localized.

All other 11 Shaman abilities (4 enchants, 5 totems, Lightning Bolt, Ancestral Guidance) verified working correctly.

## Hidden Status Stealth Crit

New combat mechanic: the `StatusEffect.Hidden` status (granted by Vanish, Noctura's Embrace, Shadow abilities) now guarantees a critical hit on the next basic attack. The Hidden status is consumed when the attack lands. This makes stealth-based abilities genuinely rewarding — use Vanish, then follow up with a guaranteed crit next round.

## Magician Spell Audit (25 spells, 5 bugs fixed)

- **Spark / Lightning Bolt / Chain Lightning** — All three lightning damage spells had `SpecialEffect = "lightning"`, which shares a handler with the `"stun"` effect. Every cast auto-stunned the target (or ALL targets for Chain Lightning AoE) for free, making dedicated CC spells (Sleep, Web, Power Word: Stun) completely redundant. Removed the stun side-effect from damage-focused lightning spells. Spark description updated to remove "stuns" claim.
- **Arcane Immunity** — `SpecialEffect = "immunity"` had no handler in either the single-monster or PvP spell paths (only existed in the ability handler). The spell's status immunity never applied — players only got the protection AC bonus. Added `"immunity"` handler to both paths granting `HasStatusImmunity` for rest of combat.
- **Manwe's Creation** — `SpecialEffect = "creation"` had no handler anywhere. The effect was silently dropped. Added handler: reduces target defense by 30% and heals caster for 20% of damage dealt.
- **Pillar of Fire** — Description said "penetrates all armor" but used the generic `"fire"` effect (burn DoT only). Changed to new `"piercing_fire"` effect that deals bonus damage equal to target's armor value (compensating for defense subtraction) plus burn DoT.
- **Time Stop** — Double-buff bug. The spell set `AttackBonus`/`ProtectionBonus` (applied by `ApplySpellEffects`), then the `"timestop"` handler added ANOTHER +35 ATK/+35 DEF on top. Removed redundant handler bonuses; handler now only provides DodgeNextAttack.
- **Wish** — Double-buff bug. The spell set `AttackBonus = (100 + Level) * profMult` and scaled `ProtectionBonus` (applied by `ApplySpellEffects`), then the `"wish"` handler ALSO added Strength to ATK and Defense to DEF. At level 100 this effectively tripled stats instead of doubling. Removed spell result bonuses; handler's stat-doubling is now the sole source (matching "All stats doubled" description).

## Bard Ability Audit (3 bugs fixed)

- **Party Song buff overwrite** — `ApplyBardSongToParty` used `=` (assignment) for `TempAttackBonus`/`TempDefenseBonus` on teammates instead of `+=`. Any existing buff (e.g., from Bardic Inspiration +20 ATK) was overwritten by the song's 60% share (e.g., +15 ATK from Inspiring Tune). Changed to `+=` with `Math.Max` for duration. Affects all 5 party_song abilities: Inspiring Tune, Song of Rest, War Drummer's Cadence, Veloura's Serenade, Legend Incarnate.
- **Grand Finale teammate buff missing** — Single-monster combat path only buffed the player with +15 ATK inspire. Multi-monster path correctly buffed all teammates. Added teammate loop to single-monster path.
- **Cutting Words description** — Said "strips 25% of the target's defense" but actually applies -30% ATK and -20% DEF (the weaken effect). Description corrected.

## Wavecaller Resonance Cascade Fallthrough Fix

Resonance Cascade (Wavecaller ability) had no proper `case` label in single-monster combat — it fell through to `grand_finale_jester`, executing Grand Finale's code instead (wrong damage, wrong inspire buff, wrong message). The actual Resonance Cascade handler was in an orphaned code block after the `break` and was completely unreachable (this was the `CS0162: Unreachable code` build warning). Separated the cases so each ability has its own handler.

## Sage Spell Audit (25 spells, 4 bugs fixed)

- **Giant Form** — `SpecialEffect = "giant"` had no handler anywhere. The attack bonus was applied via `ApplySpellEffects` but the "giant" special effect was silently dropped. Added handler: grants DEF bonus (`20 + Level/3`) and temporary HP (`Level * 3`).
- **Soul Rend** — `SpecialEffect = "soul"` had no handler anywhere. Effect silently dropped. Added handler: reduces target defense by 25% and applies fear for 2 rounds.
- **Temporal Paradox** — `SpecialEffect = "temporal"` had no handler anywhere. Effect silently dropped. Added handler: stuns target for 2 rounds (trapped in time loop). Respects stun immunity.
- **Steal Life double-heal** — Set `result.Healing = result.Damage / 2` AND used `"drain"` special effect which also heals 50% of damage. In single-monster combat, `ApplySpellEffects` applied both healing sources, doubling the heal. Removed `result.Healing` — the `"drain"` handler is now the sole healing source.
- **Roast description** — Claimed "Hellfire pierces all armor" but used generic `"fire"` effect (burn DoT only). Description corrected to "Hellfire scorches the target."

All 3 new handlers added to multi-monster, single-monster, and PvP combat paths.

## Mystic Shaman Audit (3 bugs fixed)

- **Weapon enchant rounds never decrement in PvP** — `ShamanEnchantRounds--` only existed in `ProcessEndOfRoundAbilityEffects`, which was only called from the multi-monster loop. PvP combat (`PlayerVsPlayer`) never called it, so weapon enchants lasted forever in PvP fights. Added enchant round decrement for both combatants in the PvP end-of-round block.
- **Ancestral Guidance heals only player, not party** — Description says "25% of damage dealt is converted to healing for the party" but all 4 heal locations (2 per combat path) capped healing at `player.MaxHP - player.HP` and only healed the player. Extracted `ApplyAncestralGuidanceHealing` helper that heals the player AND all living teammates.
- **No HP per level growth** — Mystic Shaman was the only class with zero `BaseMaxHP` increase per level (every other class gets 5-13). Added +6 BaseMaxHP per level, consistent with other caster-hybrid classes.

## Wavecaller Spell Audit (1 bug fixed)

- **Symphony of the Depths permanent +999 ATK** — The capstone spell set `TempAttackBonus += 999` with `TempAttackBonusDuration = 2` (intended 2-round crit window), but also set `result.AttackBonus` with `result.Duration = 999`. `ApplySpellEffects` overwrote the duration to `Math.Max(2, 999) = 999`, making the +999 ATK permanent for the rest of combat. Replaced the +999 ATK hack with `StatusEffect.Hidden` (auto-crit on next attack), matching the description "guaranteed crit on next hit."

## Cyclebreaker Spell Audit (1 missing feature implemented)

- **Paradox Collapse fight damage bonus** — Description said "+10% of all damage dealt this fight" but the bonus was never implemented. Added `"paradox_collapse"` handler that reads `result.TotalDamageDealt` and applies 10% as bonus damage to the target. The longer the fight, the more devastating the capstone spell becomes.

## Abysswarden Spell Audit (1 structural bug fixed)

- **Attack spells with healing silently dropped in PvE** — The single-target attack spell path in multi-monster combat applied damage and special effects but never checked `spellResult.Healing`. Attack spells that set self-healing (Abysswarden's Prison Siphon heal 50%, Devour Essence heal 75%) had their heals silently dropped. Added healing check after damage application in the single-target attack spell path. This structural fix covers all current and future attack spells with lifesteal.

## Voidreaver Spell Audit (1 bug fixed)

- **Blood Pact permanent +999 ATK** — Identical pattern to the Wavecaller Symphony bug. `TempAttackBonus += 999` with 2-round duration was overwritten to permanent by `result.Duration = 999`. Replaced with `StatusEffect.Hidden` for a clean one-time guaranteed crit.

## Classes audited with no bugs found

- **Alchemist** (19 abilities) — All party effects use `+=` correctly, Potion Mastery consistently applied, armor pierce handled inline. Cleanest class in the codebase.
- **Ranger** (9 abilities) — All handlers present in both paths, weapon requirements correct, Hunter's Mark dual benefit (player buff + target debuff) working.
- **Warrior** (11 abilities) — All handlers present, Execute tiered damage correct, Thundering Roar AoE taunt works in both paths.
- **Tidesworn** (11 abilities + 5 spells) — All handlers present, every mechanic works as described (taunts, weakens, invulnerability, instant kill, lifesteal, party heals, mana restore).

---

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.53.8
- `Scripts/Core/Monster.cs` — `DistractedPenalty` property for scaled Vicious Mockery penalty
- `Scripts/Systems/CombatEngine.cs` — AoE skip list corrected; Harmonic Shield party fix; two-handed shield loot skip; ATK/DEF buff overwrite fix (single-monster path); Vicious Mockery scaled penalty; Charming Performance localized; Deadly Joke localized; Grand Finale Jester handler; Carnival of Chaos single-monster confusion; Backstab guaranteed 2x crit; Poison Blade localized; Shadow Step CON scaling + localized; Death Mark localized; Assassinate description + localized; Vanish CON scaling + stealth crit + localized; Death Blossom complete rewrite (per-target + skip list + localized); Chain Lightning skip list + localized; Hidden status auto-crit on basic attacks; Magician `"creation"` handler (defense reduction + lifetap); `"piercing_fire"` handler (armor bypass + burn); `"immunity"` handler in single-monster and PvP paths; Time Stop handler redundant +35 ATK/DEF removed; Wish handler redundant +35 ATK/DEF removed; Bard party song `+=` fix; Grand Finale single-monster teammate buff; Resonance Cascade fallthrough fix; Sage `"giant"`, `"soul"`, `"temporal"` handlers added (all 3 paths); Shaman enchant decrement in PvP; `ApplyAncestralGuidanceHealing` party heal helper; Cyclebreaker `"paradox_collapse"` handler; Abysswarden attack spell healing fix in single-target path; Wavecaller Symphony +999 ATK → Hidden status; Voidreaver Blood Pact +999 ATK → Hidden status
- `Scripts/Systems/ClassAbilitySystem.cs` — Primal Scream base 45→90 + confusion; Grand Finale base 60→120 + new effect; Blade Dance base 38→110; Death Blossom description corrected; Assassinate description corrected; Vanish description updated; Noctura's Embrace description corrected; Backstab effect "critical"→"backstab"; Charming Performance description corrected; Cutting Words description corrected
- `Scripts/Systems/SpellSystem.cs` — All 25 Cleric spell descriptions corrected; all 25 combat messages localized; Magician Spark/Lightning Bolt/Chain Lightning `"lightning"` SpecialEffect removed; Pillar of Fire effect `"fire"`→`"piercing_fire"`; Wish spell result bonuses removed (handler-only); Spark description updated; Sage Steal Life `result.Healing` removed (drain handler is sole source); Roast description corrected; Wavecaller Symphony `TempAttackBonus += 999` → `StatusEffect.Hidden`; Cyclebreaker Paradox Collapse `"paradox_collapse"` effect added; Voidreaver Blood Pact `TempAttackBonus += 999` → `StatusEffect.Hidden`
- `Scripts/Locations/LevelMasterLocation.cs` — Mystic Shaman +6 BaseMaxHP per level
- `Localization/en.json` — 20+ new combat localization keys (spell messages, ability messages, distraction, stealth crit)
- `Localization/es.json` — All new keys synced
- `Localization/hu.json` — All new keys synced
- `Localization/it.json` — All new keys synced
- `Localization/fr.json` — All new keys synced
