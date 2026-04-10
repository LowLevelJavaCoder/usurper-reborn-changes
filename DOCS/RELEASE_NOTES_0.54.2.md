# v0.54.2 - Bug Fixes & Server Stability

## NPC World Reset Prevention

The online server's NPC population was periodically resetting — all NPCs dropped to level 5-10, player team assignments were lost, and the world had to rebuild from scratch. Root cause: when a MysticShaman NPC existed in the database (from children coming of age as Troll/Orc/Gnoll), deserializing their class enum triggered a `KeyNotFoundException` during world state loading. The catch block called `ForceReinitializeNPCs()`, wiping the entire NPC population.

- **LoadWorldState catch block no longer wipes NPCs** — if NPCs already exist in memory, they are kept despite the load error. Fresh initialization only happens as a last resort when zero NPCs exist.
- **Per-NPC error handling in RestoreNPCsFromData** — one bad NPC is now skipped with a detailed error log (including stack trace) instead of killing the entire 120+ NPC restore. The skipped count is logged.
- **TolerantEnumReadOnlyConverterFactory** — new JSON converter that reads enums tolerantly (handles both string and numeric values without throwing) but writes as numeric values for dashboard/API compatibility. Applied to both WorldSimService and OnlineStateManager serializers.
- **Online mode NPC level diversity** — if NPCs are ever regenerated fresh in online mode, they now span levels 1-80 instead of all spawning at template defaults (level 5-10). Previously, the level diversity randomization only ran in single-player mode.

## Companion & Party Equipment Persistence

Companion equipment (Lyris, Aldric, Mira, Vex) and NPC party member equipment kept disappearing after logout or disconnect. Four missing save points were identified and fixed:

- **InnLocation.ManageCompanionEquipment** — had `AutoSave` but was missing `SaveAllSharedState` for online mode, so companion equipment changes at the Inn were not persisted to shared world state.
- **InnLocation.CompanionEquipBestGear** — missing both `ResetAutoSaveThrottle` (rapid equips got throttled and skipped) and `SaveAllSharedState`.
- **CombatEngine companion loot auto-pickup (2 paths)** — when a companion/NPC auto-picks up loot that the player passed on, `SyncCompanionEquipment` was called but no save was triggered. Epic loot picked up by companions was lost on disconnect. Both the player-pass and follower-pass code paths now fire an immediate background save.

## Arena Dungeon Event XP Reset Fix

The random arena portal encounter in dungeons created a new CombatEngine and ran solo combat (no teammates). The `HandleVictory` XP distribution logic detected "no teammates" and reset `TeamXPPercent[0]` to 100% while zeroing all teammate slots. When the player returned to dungeon combat with their actual party, all XP distribution settings were wiped. Fix: `TeamXPPercent` is now saved and restored around the arena solo fight.

## Duplicate Ring Equip Fix

Buying two identical rings from Ravanella's Magic Shop and equipping both caused one to disappear. Both rings shared the same equipment database ID, and the duplicate-ID guard in `EquipItem`/`RecalculateStats` removed the second one. Fix: when equipping an item whose ID is already equipped in another slot, a clone with a fresh dynamic ID is created via `Equipment.Clone()` + `EquipmentDatabase.RegisterDynamic()`.

## Dashboard NPC Class/Race Display Fix

The admin dashboard NPC directory showed `?` for all NPC class and race fields. The SSE snapshot format (used for real-time dashboard updates) was missing `class` and `race` fields — it had the mapping tables (`CLASS_NAMES`, `RACE_NAMES`) but never included the data to map. Added to both the periodic snapshot and initial SSE connection snapshot.

## Quick Commands Help Fix

The `/stats` alias was shown as `/s` and `/inventory` as `/i` in the quick commands help menu. In online mode, `/s` is intercepted by the `/say` chat command, so typing `/s` opened chat instead of stats. Help now shows `%` and `*` (the single-key shortcuts that always work) as the aliases instead.

## Team Quit / Dissolution Fix

Quitting a team as the sole member left a ghost team with 1 member in the database. Root cause: `UpdatePlayerTeamMemberCount` counted players by querying `player_data` in the database, but the quitting player's save data hadn't been written yet — so the SQL query still found them in the team. Fix: save player data to DB before counting, then explicitly check for zero players AND zero NPCs and delete the team record if empty.

## Old God Boss Balance Pass

All 7 Old God bosses retuned for a challenging but survivable experience with a full party. Boss defense values were too high for players to deal meaningful damage, and enrage mechanics were overly punishing.

**Boss stat changes (HP / STR / DEF):**
- Maelketh (Floor 25): 100K/600/320 → **55K/420/180**
- Veloura (Floor 40): 200K/560/400 → **120K/400/220**
- Thorgrim (Floor 55): 400K/1200/800 → **250K/850/450**
- Noctura (Floor 70): 600K/1400/560 → **380K/1000/320**
- Aurelion (Floor 85): 800K/1600/500 → **500K/1150/300**
- Terravok (Floor 95): 1M/1800/600 → **650K/1300/380**
- Manwe (Floor 100): 1.5M/2400/800 → **900K/1700/500** (attacks 4→3)

**Global boss mechanic changes:**
- Potion cooldown: 2 rounds → **1 round**
- Enrage damage multiplier: 2.5x → **2.0x**
- Enrage defense multiplier: 1.5x → **1.3x**
- Enrage extra attacks: +3 → **+2**
- Corruption damage: 15/stack → **10/stack**
- Corruption max stacks: 10 → **8**
- Doom timer: 3 rounds → **4 rounds**

## NPC Teammate XP / Stats Mismatch Fix

NPC teammates were essentially unable to level up. A level 73 NPC would show `157,693/6,891,200 XP` — needing millions of XP to level up despite being high level. Root cause: `GenerateNPCStats()` used `template.StartLevel` (typically 5-10) for all calculations including Experience and combat stats, but the NPC's actual `Level` was randomly set to 1-80 by the level diversity system (added in v0.53.12). This meant a level 73 NPC would get Experience and stats appropriate for level 5.

- **GenerateNPCStats now uses `npc.Level`** instead of `template.StartLevel` — new NPCs get correct stats and XP for their actual level.
- **Migration fix for existing NPCs** — on load, if an NPC's Experience is below `GetExperienceForLevel(npc.Level)`, it is auto-corrected to the minimum. Applied to both online mode (WorldSimService) and single-player (GameEngine). All existing NPCs on the server were fixed on deploy.

**Inventory Equip Enchantment Loss** — Equipping items from inventory (BaseLocation, HomeLocation) only transferred 5 of 18+ LootEffect types (CON, INT, AllStats, BossSlayer, TitanResolve). All 13 missing types now transferred: fire/frost/lightning/poison/holy/shadow enchants, lifesteal, mana steal, crit chance/damage, armor piercing, thorns, HP/mana regen, magic resist. StaminaBonus was also missing from both equip paths.

**Equipment IsIdentified Not Serialized** — `DynamicEquipmentData` was missing `IsIdentified`, causing unidentified equipped items to silently become identified on save/load. Added to serialization, deserialization, and data structure.

**Session XP Diminishing Returns Bypass** — Players could log out and back in to reset `SessionXPEarned`, bypassing the online XP throttle. Now reset during daily reset instead of only on session start.

**Combat Buff Leak After Multi-Monster Combat** — TempAttackBonus, TempDefenseBonus, MagicACBonus, Blessed, Haste, Reflecting, and other temporary combat buffs were not cleaned up after multi-monster combat (the most common type). They carried over into the next fight. Added full cleanup matching the single-monster/PvP paths.

**Target Index Out of Bounds** — Multi-monster player attack path at `monsters[action.TargetIndex.Value]` had no bounds check, causing potential crash if target index was stale. Added bounds validation with fallback to random target.

**Boss Teammate AI Missing from Single-Monster Path** — Teammates in single-monster Old God boss fights never tried to dispel Doom or interrupt channeling (this logic only existed in the multi-monster path). Ported boss priority actions to single-monster teammate AI.

**Dead Companions in GetActiveCompanions** — `GetActiveCompanions()` returned dead companions since it had no `IsDead` filter. Callers had to check individually. Added filter at source.

**Child-to-NPC Conversion Not Idempotent** — Across save/load boundaries, a child reaching adulthood could be converted to an NPC twice, creating duplicate NPCs. Added idempotency check (skip if already converted or if matching adult NPC exists).

**Child Deserialization Duplicate Prevention** — `DeserializeChildren()` bypassed the duplicate check in `RegisterChild()` by directly adding to the list. Added inline duplicate prevention.

**ReleaseWorldSimLock Race Condition** — Check-then-delete without transaction could allow two world sims to start simultaneously. Wrapped in SQLite transaction for atomicity.

**SQLite Connection Pooling** — Added `Pooling=true` to connection string for better performance under concurrent MUD load.

**HomeLocation WeaponType** — Items equipped via HomeLocation didn't set WeaponType (Magician staves defaulted to None). Added `InferWeaponType` call.

## Team Rankings Average Level Fix

Team Rankings showed inflated "Avg Lvl" values (e.g., 703 instead of ~40). The calculation divided total power (Level + STR + DEF) by member count instead of total levels by member count.

## Team Corner Localization Fix

Waist and Face equipment slots in Team Corner showed raw localization keys (`team.slot_waist`, `team.slot_face`) instead of "Waist" and "Face". Added missing keys to en.json.

## Lyris Companion Ranger Overhaul

Lyris's backstory, quest, weapon, and dialogue have been reworked to be consistent with her Ranger class. Previously her identity was "former priestess of Aurelion" with divine/clerical themes despite being classified as a Ranger.

- **New backstory:** Former warden of the Deepwood, an ancient forest destroyed by Manwe's corruption. She tracked the corruption underground into the dungeon.
- **New title:** "The Silent Arrow" (was "The Wandering Star")
- **New quest:** "The Deepwood's Heart" — recover the mother-tree's last seed buried deep in the dungeon (replaces "The Light That Was" divine artifact quest)
- **Quest rewards:** ATK +20, Speed +15, Healing +10 (was MagicPower +25, HealingPower +15)
- **Weapon:** Bow (was Sword)
- **Updated content:** All quest dialogue, dungeon idle comments, dreams, teaser sighting, and sacrifice dialogue rewritten with ranger/nature themes
- **Sacrifice line:** "Plant the seed for me... promise me..." (was "The stars... they're so beautiful from here...")

## Weapon Enchant Proc on Spell/Companion Fix

Weapon enchantments (Lifedrinker, elemental procs, poison coating) incorrectly triggered on AoE spell damage and companion AoE abilities. A Magician's Ice Storm would proc their staff's Lifedrinker, and a companion's Volley would proc the PLAYER's weapon enchants (because `ApplyAoEDamage` always used `result.Player` as the attacker). Fix: `ApplyPostHitEnchantments` now accepts `isSpellDamage` flag to skip weapon-based effects on spells, and `ApplyAoEDamage` passes the correct attacker instead of always using the player.

## Home Chest Item Loss Fix (Online Mode)

Items in the home chest disappeared between sessions in online MUD mode. Root cause: `Player.RealName` was serialized to save data but **never restored on load**, defaulting to `""`. Since the chest is stored in a static dictionary keyed by `RealName`, ALL online players shared the same key `""` — when another player logged in, their chest data overwrote the previous player's. Fix: `RealName` is now restored from save data during `RestorePlayerFromSaveData()`.

## Home Children Display Mismatch Fix

Home location description said children were present but `[C] Spend Time with Child` said "no children at home." The description showed ALL children (including adults who turned 18, kidnapped, orphanage), while the interaction filtered properly. Now both the description and menu use the same filter: under 18, at home, not deleted, not kidnapped.

## System Message Infinite Loop Fix

System messages (pardons, executions, trade returns) sent to a player's **display name** were never marked as read, causing them to re-appear every 5 seconds indefinitely. Root cause: `GetUnreadMessages` matched messages by both username AND display_name, but `MarkMessagesRead` only matched by username. Messages sent to the display name were fetched but never cleared. Fix: `MarkMessagesRead` now uses the same dual-match query. Also added `MarkMessagesRead` call to the "While You Were Gone" login screen so messages don't double-display.

## Guild Bank Item Stats Display

`/gbank items` now shows item stats (ATK, AP, STR, DEF, DEX, AGI, WIS, CHA, HP, MP) underneath each item entry. Previously items only showed name and depositor — players had to withdraw items just to see their stats.

## Inventory Full Loot Loss Fix

Picking up loot with a full inventory (50 items) silently discarded the item with no warning. All loot-to-inventory paths in CombatEngine (Take choice, equip-failed fallback, unidentified equip redirect, classic weapon/armor grab) now check `IsInventoryFull` before adding. When full: the loot prompt shows "INVENTORY FULL" in red on the Take option, and attempting to take shows "Inventory full — item dropped." instead of silently losing the item.

## Multi-Monster Loot Weapon Type Fix

Weapons equipped from multi-monster combat loot (the most common dungeon encounter type) had their weapon type hardcoded to `Sword` regardless of actual weapon name. This broke spell casting for Magicians/Sages who picked up staves (needed `WeaponType.Staff`), and ability weapon requirements for Assassins (daggers), Rangers (bows), and Bards (instruments). The single-monster loot path correctly called `InferWeaponType` — the multi-monster path was missing it. Handedness was also hardcoded to `OneHanded`, causing staves and two-handed weapons to not properly occupy both hand slots.

- **Multi-monster equip path** now uses `InferWeaponType` and `InferHandedness` (matching the single-monster path)
- **Migration fix on load** — all equipped weapons now re-infer type from name, fixing existing saves with wrong weapon types

## World Boss Mana Potion Fix

Mana potions were completely unavailable during world boss fights. The `[I]tem` action only offered HP potions — spellcasters (Magician, Cleric, Sage, etc.) had to retreat and re-enter to restore mana. Now pressing `[I]` in world boss combat shows a choice between healing and mana potions (same as regular combat), or auto-uses the available type if only one applies.

## False Error Log Fix

`RestoreNPCs` logged `[ERR] No NPC data in save` on every online player login — this is expected behavior (player saves don't store NPCs in online mode; the world sim manages them). Downgraded to `[DBG]` to stop false Discord alerts.

## Security & Thread Safety

- **SQL injection fix** — 2 interpolated SQL values in SqlSaveBackend parameterized: `PruneCombatEvents` days parameter and `UpdateTeamWarScore` column selection (now uses two hardcoded query strings instead of string-interpolated column name).
- **Thread-safe Random** — `NPCSpawnSystem.random` changed from `new Random()` to `Random.Shared` for safe use in the multithreaded MUD server context.

## Server Log Watcher

New persistent log watcher agent (`usurper-log-watcher.service`) monitors `debug.log` for `[ERR]` level entries and sends instant Discord notifications with color-coded embeds. Features 5-minute dedup cooldown per unique error signature, service crash detection, and automatic log rotation handling.

---

### Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.54.2; boss balance constants (potion cooldown, enrage multipliers, corruption, doom)
- `Scripts/Core/GameEngine.cs` — RestoreNPCs empty-list log downgraded from ERR to DBG; NPC Experience migration fix (corrects XP below level minimum); weapon type re-inference on load for MainHand/OffHand (both equipment load paths)
- `Scripts/Data/OldGodsData.cs` — All 7 Old God boss stats retuned (HP, STR, DEF); Manwe attacks 4→3
- `Scripts/Systems/WorldSimService.cs` — LoadWorldState catch block no longer wipes NPCs; per-NPC error handling with skip+log in RestoreNPCsFromData; TolerantEnumReadOnlyConverterFactory in jsonOptions; NPC Experience migration fix (corrects XP below level minimum)
- `Scripts/Systems/OnlineStateManager.cs` — TolerantEnumReadOnlyConverterFactory in jsonOptions
- `Scripts/Utils/TolerantEnumConverter.cs` — New TolerantEnumReadOnlyConverterFactory, TolerantEnumNumericConverter, NullableTolerantEnumNumericConverter (reads tolerantly, writes as numbers)
- `Scripts/Systems/NPCSpawnSystem.cs` — Level diversity randomization now applies to online mode (removed `!IsOnlineMode` guard); `GenerateNPCStats` uses `npc.Level` instead of `template.StartLevel`
- `Scripts/Locations/InnLocation.cs` — SaveAllSharedState after ManageCompanionEquipment and CompanionEquipBestGear; ResetAutoSaveThrottle before EquipBest save
- `Scripts/Core/Character.cs` — `IsInventoryFull` computed property
- `Scripts/Systems/CombatEngine.cs` — Background save after companion loot auto-pickup (2 code paths); multi-monster equip path uses InferWeaponType/InferHandedness instead of Sword/OneHanded defaults; inventory capacity checks on all loot-to-inventory paths (Take, equip-failed, unidentified, classic grab)
- `Scripts/Systems/RareEncounters.cs` — Arena portal encounter saves/restores TeamXPPercent around solo combat
- `Scripts/Locations/MagicShopLocation.cs` — Duplicate ring fix: clone + RegisterDynamic when equipping item already in another slot
- `web/ssh-proxy.js` — Added class and race fields to both SSE NPC snapshot locations
- `Scripts/Locations/BaseLocation.cs` — Quick commands help shows `%`/`*` instead of conflicting `/s`/`/i` aliases (both visual and SR versions)
- `Scripts/Systems/SqlSaveBackend.cs` — Parameterized 2 SQL injection sites (PruneCombatEvents days, UpdateTeamWarScore column)
- `Scripts/Systems/NPCSpawnSystem.cs` — `new Random()` → `Random.Shared` for thread safety
- `Scripts/Systems/WorldBossSystem.cs` — ProcessUseItem now supports mana potions with H/M choice menu; new UseManaPotion helper
- `Scripts/Systems/SqlSaveBackend.cs` — `MarkMessagesRead` now matches by both username and display_name (matching `GetUnreadMessages` query)
- `Scripts/Server/MudChatSystem.cs` — `/gbank items` shows item stats from stored JSON (ATK, AP, STR, DEF, DEX, AGI, WIS, CHA, HP, MP)
- `Scripts/Systems/CompanionSystem.cs` — Lyris backstory, title, quest, weapon (Bow), and dungeon idle comments rewritten for Ranger identity
- `Scripts/Locations/DungeonLocation.cs` — Lyris quest comment and stat bonuses updated (ATK/Speed/Healing instead of MagicPower/HealingPower)
- `Scripts/Systems/DreamSystem.cs` — Lyris grief and campfire dreams rewritten with ranger/Deepwood themes
- `Scripts/Locations/TeamCornerLocation.cs` — Team rankings average level uses actual levels instead of total power; removed fallback args from Waist/Face Loc.Get calls
- `Scripts/Systems/SaveDataStructures.cs` — Added IsIdentified to DynamicEquipmentData
- `Scripts/Systems/DailySystemManager.cs` — Reset SessionXPEarned on daily reset (prevents diminishing returns bypass)
- `Scripts/Systems/FamilySystem.cs` — Child-to-NPC conversion idempotency check; DeserializeChildren duplicate prevention
- `Scripts/Systems/CompanionSystem.cs` — Lyris ranger overhaul; GetActiveCompanions filters dead companions
- `Scripts/Systems/SqlSaveBackend.cs` — ReleaseWorldSimLock wrapped in transaction; connection pooling enabled; MarkMessagesRead matches both username and display_name
- `Scripts/Locations/BankLocation.cs` — Fixed stale comment about BankRobberyAttempts serialization
- `Scripts/Locations/HomeLocation.cs` — Children display filter matches interaction filter (age < 18, at home, not deleted/kidnapped) in both visual and BBS descriptions; menu [C] key adds missing !Kidnapped check
- `Scripts/Locations/TeamCornerLocation.cs` — Save player data before UpdatePlayerTeamMemberCount; delete team when 0 players + 0 NPCs remain
- `scripts-server/log-watcher.sh` — **NEW** — Log watcher agent with Discord webhook notifications
- `scripts-server/usurper-log-watcher.service` — **NEW** — Systemd service for log watcher
