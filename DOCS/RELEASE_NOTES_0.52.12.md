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

## Old God Boss Rebalance

All seven Old God boss fights rebalanced to be genuinely challenging endgame encounters. Player damage scales multiplicatively through levels (STR growth + weapon power + abilities + crits), but boss HP/STR were scaling linearly — by level 85+, bosses melted in under 10 rounds with no real threat to survival.

**HP increases** (matched to player DPS at each tier):
- Maelketh (Fl.25): 15,000 → 25,000
- Veloura (Fl.40): 25,000 → 50,000
- Thorgrim (Fl.55): 40,000 → 100,000
- Noctura (Fl.70): 50,000 → 150,000
- Aurelion (Fl.85): 75,000 → 250,000
- Terravok (Fl.95): 100,000 → 350,000
- Manwe (Fl.100): 150,000 → 500,000

**STR increases** (boss attacks should threaten player HP pools):
- Maelketh: 120→150, Veloura: 90→140, Thorgrim: 140→200, Noctura: 130→220, Aurelion: 160→280, Terravok: 200→350, Manwe: 220→400

**Attacks/round**: Aurelion 2→3, Terravok 1→2

**Enrage timers tightened** 15-20% across all bosses (Maelketh 30→25, Veloura 28→22, Thorgrim 25→20, Noctura 22→18, Aurelion 20→16, Terravok 18→14, Manwe 15→12). Enrage damage multiplier increased 2.0x→2.5x with +3 extra attacks (was +2).

**AoE/Channel damage doubled** to match player HP pools at each tier — Veloura AoE 150→300, Thorgrim channel 600→1200, Noctura channel 800→1800, Aurelion channel 1000→2500, Terravok channel 1200→3000, Manwe channel 1500→4000.

**Corruption damage per stack** increased: Noctura 20→35, Aurelion 25→45, Terravok 30→55, Manwe 40→70.

---

## Old God Boss System Hardening

Four fixes to the Old God boss encounter system addressing crash risks, state corruption, and story progression edge cases.

**Divine armor null reference fix** — `GetDivineArmorReduction()` checked if the player's weapon was null but not if `weapon.Name` was null before calling `.Contains()`. Now uses `weapon?.Name == null` guard to prevent crash with unnamed weapons.

**Combat modifier cleanup fix** — `ClearPlayerModifiers()` only cleared `HasBloodlust` and `DodgeNextAttack` after boss fights but left `TempAttackBonus`/`TempDefenseBonus` (set with duration 999) intact. If a player fought multiple bosses in one session, dialogue-granted bonuses from the first boss would carry over. Now clears all four temp bonus fields.

**MUD mode concurrent boss encounter fix** — `OldGodBossSystem` is a singleton with class-level `currentBoss`, `bossDefeated`, `dungeonTeammates`, and `activeCombatModifiers` fields. If two MUD players fought Old God bosses simultaneously, they would overwrite each other's state. `StartBossEncounter()` now serialized with `SemaphoreSlim` to prevent concurrent corruption.

**Awakened state recovery for non-saveable gods** — If a non-saveable god (Maelketh, Thorgrim) somehow reached `Awakened` status (no artifact exists to complete the save quest), `CanEncounterBoss()` would return false permanently, blocking floor progression. Now auto-recovers by setting status to `Defeated` when a non-saveable god is found in `Awakened` state.

---

## Old God State Deserialization Safety

`SaveSystem` deserialization of `OldGodStates` had two issues: it would overwrite meaningful initial god states (Maelketh starts as `Corrupted`, Veloura as `Dying`) with `Unknown` (0) if the save data contained default values, and it silently discarded states for god types not found in the initialized dictionary. Now skips `Unknown` status during restore and logs a warning for unrecognized god types.

---

## Quest Abandon Persistence Fix

Abandoning a quest showed "Quest abandoned" but the quest could reappear in the quest log after save/load cycles. Three issues: `AbandonQuest()` cleared the quest's `Occupier` field, causing it to fall out of the player's serialization scope entirely (silently dropped from saves instead of saved as abandoned); `SerializeQuestList()` mapped all deleted quests to `QuestStatus.Completed` regardless of how they were deleted; and `RestoreFromSaveData()` / `MergePlayerQuests()` only checked for `Completed` or `Failed` status when restoring the `Deleted` flag, not `Abandoned`. Added `IsAbandoned` property to Quest, `AbandonQuest()` now preserves occupier and marks all matching quests (defense against duplicates), serialization maps abandoned quests to `QuestStatus.Abandoned`, and all three deserialization paths restore abandoned quests as deleted.

---

## NPC Activity Text Localization Fix

NPC location flavor text used a hardcoded English pattern: `"{name} is {activity}."` where activity was a gerund fragment like "nursing a drink at the bar". Hungarian has no equivalent "is" copula in present tense, making translations grammatically impossible — users reported seeing broken text like "Aldric Everhart van egy italt iszik". Changed to full self-contained sentences with `{0}` for the NPC name: `"{0} nurses a drink at the bar."` Each language can now structure the sentence naturally. Converted 59 keys (30 location activities + 29 personality/class shouts) from gerund fragments to active-voice sentences across all 5 languages (English, Spanish, Hungarian, Italian, French).

---

## Home Chest Item Loss Fix (Online Mode)

Items deposited into the home chest in online mode could disappear on disconnect. The 60-second auto-save throttle meant chest deposits/withdrawals within the throttle window were never persisted — if the player disconnected before the next save cycle, the items were lost. Chest operations now reset the auto-save throttle so the next location loop iteration saves immediately.

---

## Shop & Equipment Stat Display Consistency Fix

Weapon Shop and Armor Shop item listings were truncating stat bonuses to only 3 per item (e.g. showing "Str:+17, Dex:+17, Wis:+49" on an item that also has Agi:+17, Con:+93, Int:+17, Cha:+34). All stat bonuses now display in shop listings, matching the inventory and comparison views. Also fixed `WriteEquipmentStatSummary()` using hardcoded "DEF" instead of the localized stat label, and using `> 0` instead of `!= 0` for DefenceBonus/MaxHPBonus/MaxManaBonus (which would hide negative values on cursed items).

---

## Companion Lyris Class Display Fix

Lyris showed as "Paladin" class on the Inn companion management screens (equipment, abilities, ability toggle) despite being a Ranger with Ranger abilities. The canonical `CombatRole.Hybrid → CharacterClass.Ranger` mapping in CompanionSystem was updated in v0.52.3, but three copies of the mapping in InnLocation.cs were missed. All three now correctly map to Ranger.

---

## Localization Pass — Dialogue, Prison Walk, Street Encounters

Continued localization audit converting hardcoded English UI strings to `Loc.Get()` calls across three player-facing files.

**PrisonWalkLocation.cs** — 79 new localization keys. All menu text, status display, prisoner list, prison break narrative, guard combat messages, success/failure outcomes, and help commands converted. Full Spanish translations; Hungarian, Italian, French get English placeholders.

**StreetEncounterSystem.cs** — 5 new localization keys for the remaining hardcoded combat result messages (honor duel victory, brawl victory, defeated NPC, lost to NPC, bounty collected).

**VisualNovelDialogueSystem.cs** — 88 new localization keys covering all UI narration strings: charisma flavor text, conversation option labels, player status warnings, chat/flirt/compliment/confession/kiss/proposition/provocation narration, affair decision menu and outcomes, and the full wedding ceremony sequence. NPC dialogue responses (~220 strings) kept as game data — not localized.

---

## Main Street Menu Layout Fix

The Main Street menu used a fixed column width of 16 characters, which caused label overflow and broken alignment in non-English languages where translated labels exceeded the available space. The menu now computes column widths dynamically per-row based on the number of items displayed (e.g., 5-item rows get 15 chars each, 4-item rows get 19 chars). Combined with shortened translated labels across all languages, the menu now renders cleanly in English, Spanish, Hungarian, Italian, and French at all menu tiers.

---

## Calm Waters Redesign (Wavecaller)

Calm Waters has been redesigned from a one-time cleanse into a party-wide debuff resistance shield. Previously, the ability claimed to "Remove all negative effects from allies" but only cleansed the player who used it — teammates and companions were never affected. Worse, a one-time cleanse had limited value since monster debuffs are constantly reapplied.

**New behavior:** When used, Calm Waters grants all party members (player, companions, NPC teammates) a 50% chance to resist incoming debuffs for 5 rounds. When the shield blocks a debuff, a "Calm waters shield deflects X!" message appears in bright cyan. The shield works against all debuff sources:
- Standard monster ability debuffs (poison, stun, fear, bleed, etc.)
- Monster debuffs targeting companions
- Old God boss debuffs (curse, stun, fear, Time Stop)
- Manwe Phase 3 defense curse

This makes Calm Waters especially valuable in Old God boss fights where corruption, stuns, and curses are constantly applied — the original use case the player community identified.

---

## PostHog Telemetry Removed

The opt-in PostHog analytics system (`TelemetrySystem.cs`) has been completely removed. This was a feature that sent anonymous gameplay events (combat stats, shop transactions, level-ups, quest completions) to an external analytics service. All tracking calls removed from 14 source files, the telemetry opt-in prompt during character creation removed, the telemetry toggle removed from preferences, and 22 localization keys cleaned up. Steam achievements, the balance dashboard, player statistics, and debug logging are all unaffected — they use separate local systems.

---

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.52.12; boss enrage damage 2.0x→2.5x; enrage extra attacks 2→3; Calm Waters shield constants (`CalmWatersShieldDuration`, `CalmWatersResistChance`)
- `Scripts/Data/OldGodsData.cs` — All 7 Old God boss stats rebalanced (HP, STR, DEF, AGI, WIS, AttacksPerRound)
- `Scripts/Systems/OldGodBossSystem.cs` — All boss party mechanics retuned (enrage timers, AoE damage, channel damage, corruption per stack); `SemaphoreSlim` lock on `StartBossEncounter()`; `ClearPlayerModifiers()` clears all temp bonuses; `GetDivineArmorReduction()` null-safe weapon name check; `CanEncounterBoss()` auto-recovers non-saveable gods stuck in Awakened state
- `Scripts/Systems/SaveSystem.cs` — OldGodStates deserialization skips `Unknown` status; logs warning for unrecognized god types; `ResetAutoSaveThrottle()` method for critical state changes; removed telemetry serialization
- `Scripts/Systems/DailySystemManager.cs` — Online mode daily reset skips display banner and mode-specific processing; single-player path unchanged
- `Scripts/Systems/CompanionSystem.cs` — `GetCompanionMaxHP()` helper; fixed 7 `BaseStats.HP` references in `GetCompanionsAsCharacters()`, `DamageCompanion()`, `HealCompanion()`, `GetCompanionHP()`, `RestoreCompanionHP()`, and level-up
- `Scripts/Systems/TelemetrySystem.cs` — **DELETED** — PostHog analytics system removed
- `Scripts/Systems/CombatEngine.cs` — Calm Waters redesign: new `"debuff_shield"` effect handler in both combat paths applies party-wide shield; `DecrementCalmWatersShield()` helper; Calm Waters resist checks at 6 debuff application points (standard monster abilities, companion debuffs, boss curse/stun/fear, Manwe Time Stop, Manwe Phase 3 curse); multi-target spell skip target prompt; monster ability display fix; group loot NPC-first priority; cascade timeout 30s→10s; group follower XP multiplier parity (Blood Moon, Child, Study, Settlement, Guild, HQ Training); gold distribution uses post-multiplier amount; removed telemetry calls
- `Scripts/Systems/CombatMessages.cs` — Removed markup tags from `GetVictoryMessage()`
- `Scripts/Systems/TeamSystem.cs` — `new Random()` → `Random.Shared` (4 instances)
- `Scripts/Locations/TeamCornerLocation.cs` — `SaveAllSharedState()` after SackMember and ChangeTeamPassword; removed dead duplicate case "!"; `new Random()` → `Random.Shared`
- `Scripts/Locations/InnLocation.cs` — Companion summary uses `GetCompanionMaxHP()` for display; fixed 3 stale `CombatRole.Hybrid → Paladin` mappings to `Ranger` for Lyris class display
- `Scripts/Locations/HomeLocation.cs` — `ResetAutoSaveThrottle()` after chest deposit and withdraw to prevent item loss on disconnect
- `Scripts/Locations/ArmorShopLocation.cs` — `GetBonusDescription()` removed `.Take(3)` limit; shows all stat bonuses
- `Scripts/Locations/WeaponShopLocation.cs` — `GetBonusDescription()` removed `.Take(3)` limit; shows all stat bonuses
- `Scripts/Locations/BaseLocation.cs` — `WriteEquipmentStatSummary()`: DEF uses localized label; DefenceBonus/MaxHPBonus/MaxManaBonus use `!= 0` instead of `> 0` to show negative values; telemetry toggle removed from preferences
- `Scripts/Locations/DungeonLocation.cs` — Party HP readout uses `GetCompanionMaxHP()`; removed telemetry calls
- `Scripts/Locations/MainStreetLocation.cs` — Dynamic column width per-row in `ShowClassicMenu()` (replaces fixed `const int C = 16`); removed telemetry session end call
- `Scripts/Locations/MagicShopLocation.cs` — Removed 4 telemetry calls
- `Scripts/Locations/HealerLocation.cs` — Removed 3 telemetry calls
- `Scripts/Locations/LevelMasterLocation.cs` — Removed telemetry level-up and user property calls
- `Scripts/Systems/QuestSystem.cs` — Removed telemetry quest tracking calls
- `Scripts/Systems/AchievementSystem.cs` — Removed telemetry achievement call
- `Scripts/Systems/SaveDataStructures.cs` — Removed `Telemetry` property from SaveData
- `Scripts/Core/GameEngine.cs` — Removed telemetry opt-in prompt, session tracking, and serialization calls
- `Scripts/Core/Character.cs` — `CalmWatersRounds` property for debuff shield duration tracking
- `Scripts/Systems/ClassAbilitySystem.cs` — Calm Waters: description updated, SpecialEffect `"cleanse"` → `"debuff_shield"`
- `Scripts/Core/Quest.cs` — `IsAbandoned` property for tracking abandoned quest state
- `Scripts/Systems/QuestSystem.cs` — `AbandonQuest()` marks all matching quests with `IsAbandoned`, preserves occupier; `RestoreFromSaveData()`, `MergePlayerQuests()`, `MergeWorldQuests()` handle `QuestStatus.Abandoned` as `Deleted`
- `Scripts/Systems/SaveSystem.cs` — `SerializeQuestList()` maps `IsAbandoned` to `QuestStatus.Abandoned`; `SerializePlayerQuests()` includes abandoned quests in save data
- `Scripts/Locations/BaseLocation.cs` — Removed hardcoded ` is ` from NPC activity display; `GetLocationContextActivity()` and `GetNPCShout()` pass NPC name as `{0}` to all `Loc.Get()` calls
- `Localization/en.json` — `home.upgrades` shortened; Main Street menu labels shortened for column fit; 59 NPC activity/shout keys converted to active-voice sentences with `{0}`; 172 new keys (88 dialogue + 79 prison + 5 street)
- `Localization/es.json` — `home.upgrades` shortened; 59 NPC activity/shout keys updated with `{0}` and Spanish active voice; 172 new keys with full Spanish translations
- `Localization/it.json` — `home.upgrades` shortened; 59 NPC activity/shout keys updated with `{0}` and Italian active voice; 172 new keys (English placeholders)
- `Localization/hu.json` — 59 NPC activity/shout keys updated with `{0}` and Hungarian active voice; 172 new keys (English placeholders)
- `Localization/fr.json` — 59 NPC activity/shout keys updated with `{0}` and French active voice; 172 new dialogue/prison keys
- `Scripts/Locations/PrisonWalkLocation.cs` — All UI strings converted to `Loc.Get()` (79 keys: menus, status, prisoner list, prison break, guard combat, outcomes, help)
- `Scripts/Systems/StreetEncounterSystem.cs` — 5 combat result messages converted to `Loc.Get()` (honor duel, brawl, defeat, loss, bounty)
- `Scripts/Systems/VisualNovelDialogueSystem.cs` — 80 UI narration strings converted to `Loc.Get()` (charisma, options, warnings, flirt/compliment/confession/kiss/proposition/provocation narration, affair menu/outcomes, wedding ceremony)
- `tools/add_dialogue_keys.py` — Batch script adding 88 dialogue localization keys (en + es translations)
- `tools/add_prison_keys.py` — Batch script adding 79 prison walk localization keys (en + es translations)
