# v0.57.13 - Discord Bridge + Companion Loot Sync + Shaman Balance + Website i18n Race + Beta Banner

## Discord ↔ In-Game Gossip Bridge

`#in-game-gossip` in the official Usurper Reborn Discord now mirrors the in-game `/gos` channel in both directions, via a new bot (UsurperBot).

**Game → Discord:** any `/gos <message>` posted on the online server relays to the Discord channel as `**AuthorName** *(in-game)*: message`. Roughly 250-500ms latency (poll interval + Discord API send).

**Discord → Game:** any message posted in the designated Discord channel relays into the in-game `/gos` channel as `[Gossip] AuthorName (Discord): message`. Same latency budget.

**Architecture.** Bridge is layered on the existing shared SQLite database — no new services. A new `discord_gossip` table (direction / author / message / created_at / processed) is the queue. Game side writes to it from `MudChatSystem.HandleGossip` and polls it for inbound Discord messages. The Discord bot runs inside the existing `ssh-proxy.js` Node process — reads the channel via `discord.js` v14 gateway connection, enforces rate limit + sanitization + 200-char cap, and queues inbound rows for the game to pick up.

**Configuration.** Two env vars on the `usurper-web` systemd service: `DISCORD_BOT_TOKEN` and `DISCORD_GOSSIP_CHANNEL_ID`. Both live in `/etc/systemd/system/usurper-web.service.d/discord.conf` with 600 permissions — not in git, not in the binary. If either is missing at startup, the bridge logs once and skips silently; the rest of the web proxy runs normally.

**Safety.**
- Discord user identity prefixed with `(Discord)` in-game so source is never ambiguous.
- `@everyone` / `@here` neutered (zero-width space injected between `@` and keyword) so Discord users can't mass-ping from in-game relay, and `allowedMentions: { parse: [] }` on every outbound post blocks any ping attempts from in-game into Discord.
- Per-Discord-user rate limit: 1 message per 3 seconds, 200-character truncation. Hitting the limit gets an ⏳ reaction.
- Control chars stripped from message content before queue.
- Old processed rows auto-cleaned after 7 days.
- Bot permissions minimized: `View Channels`, `Send Messages`, `Read Message History` on the designated channel only. `Message Content Intent` (required to read text) is the only privileged intent. No admin, no mod, no manage-messages.

**Post-deploy overlap-timer bug (fixed in same release).** v0.57.13 initially shipped with the outbound poll running on a naive `setInterval(fn, 250)` and a sequential `await channel.send()` loop inside. Because each `channel.send()` takes 100-200ms, the next interval tick could fire before the previous tick finished marking rows processed — so the next tick read the same rows again and re-sent them. Observed symptom: a single `/gos` message posted to Discord 10-20 times within a second. Fixed by (1) a re-entrant `_discordPollInFlight` guard so overlapping ticks no-op, and (2) atomic claim — the SELECT and the "mark processed" UPDATE now share a single `dbWrite.transaction()`, so even if the guard were bypassed (or a process restart happened mid-poll), no two invocations can ever see the same unprocessed row.

## Mystic Shaman — Full Balance Pass

Community report from Rozro (Lv 71 MysticShaman, INT 966, WeapPow 1242): endgame Shamans were one-shotting Old Gods on basic attacks — elemental rider procs of 400-800k per swing. Zengazu and spudman chimed in noting the scaling was obvious enough they were considering re-rolling to abuse it. Three rounds of fixes landed in v0.57.13, all bundled here because they build on each other:

**Round 1 — Rider base off `WeaponPower` instead of `actualDamage`.** The enchant rider at [CombatEngine.cs:3301](Scripts/Systems/CombatEngine.cs#L3301) (and twin at [:11335](Scripts/Systems/CombatEngine.cs#L11335)) computed as `actualDamage * ShamanEnchantPower / 100.0` where `ShamanEnchantPower = 20 + INT*3`. At INT 500 that's +1520%; at Rozro's INT 966 it's +2920%. Because `actualDamage` is the post-crit, post-passive, post-buff final number, crits DOUBLE-compounded — a 3x crit on the main hit became a 29 * 3 = 87x elemental proc on top. Fixed by switching the rider base from `actualDamage` to raw `WeaponPower` of the hitting hand (`isOffHandAttack ? OffHand : MainHand`) so dual-wielders scale each swing off that hand's weapon.

**Round 2 — Windfury fixes.** Rozro separately: *"Does Wind Fury work? Doesn't look like it does much, not even an extra mainhand attack."* Two problems: (1) the 30% proc was silent — no terminal message when it fired, so players couldn't distinguish it from Agility/dual-wield/class extras, and (2) the bonus swing always landed on off-hand because `ExecuteAttack`'s split keys on `s >= baseSwings` and Shaman has zero class extras. `GetAttackCount` return type changed from `int` to `(int attacks, bool windfuryProcced)`; five call sites updated (player + teammates + rage) so `baseSwings` extends by +1 when procced, shifting the bonus into main-hand. Flavor line emits on proc for the current player (new loc key `combat.shaman_windfury_proc` in all 5 languages), suppressed for teammates to avoid spam.

**Round 3 — Comprehensive balance pass (Tier A + B + C).** Even after Round 1, Shaman was still 10-25× peer DPS at endgame because `ShamanElementalMastery` was unbounded in INT — the only uncapped class passive in the game. Every other passive (Magician spell cap 8×, crit cap 75%, tank damage reductions) is bounded. Audit across all 12 base classes confirmed this was the outlier:

- **A1 cap on `ShamanEnchantPower`.** New `GameConfig.ShamanEnchantPowerCap = 250` constant (max 2.5× weapon-power rider per hit) + new `GetShamanEnchantPower(long intelligence)` static helper as single source of truth for the formula. All 16 inline sites in `CombatEngine.cs` (8 set + 8 display) route through the helper.
- **A2 Healing Totem solo-vs-group split.** Was 10% MaxHP/round per ally regardless of party size — at a 4-member group that's 40% total group healing/round, trivializing group PvE. Now the tick reads `result.Teammates.Any(t => t.IsAlive)` to pick the rate: solo keeps the full 10% (`ShamanTotemHealPercent`), group drops to 5% (new `ShamanTotemHealPercentGroup`) symmetrically for caster and allies.
- **B1 `ShamanElementalMastery` 0.03 → 0.01 per INT.** Matches Sage's WIS scaling tier. Combined with A1 cap, the ceiling now reaches at INT ~230 instead of INT 77 — smoother mid-game curve while still rewarding INT investment up to the cap.
- **B2 `ShamanWindfuryProcChance` 30% → 40%.** New `GameConfig.ShamanWindfuryProcChance` constant. Compensates the A1 damage nerf, combined with Round 2's visibility + main-hand routing Windfury is both more common AND lands on the stronger weapon.
- **C combat modifier.** Shaman was the only class returning empty `GetClassCombatModifiers()` — the totem + enchant kit was treated as the substitute. Post-A nerfs the kit is proportional, so added `DamageReduction = 2` (matches Barbarian's value) for `MysticShaman`. Rewards the medium-armor tradeoff and the "spiritually warded warrior-shaman" archetype.

**Per-hit weapon-enchant rider progression at Rozro's stats:**

| Build state | Formula | Rider per hit |
|---|---|---|
| Pre-Round 1 | `actualDamage × (20+INT×3)/100` | ~400-800k |
| Round 1 | `WeaponPower × (20+INT×3)/100` | ~36k |
| Round 3 (A1+B1) | `WeaponPower × min(250, 20+INT×1)/100` | **~3.1k** |

Dual-wield round end-state: 2 × 3.1k rider + normal weapon hits (~3-5k × 2) + Windfury 40% proc ≈ **12-17k/round** (down from ~800k). Magician Disintegrate at comparable level is ~4.8k/cast — Shaman now roughly 3× Magician DPS, appropriate for a melee-hybrid with utility kit. Not trivializing bosses anymore.

## Companion Combat-Loot [E] Equip Sync

Player report (Usurper Reborn community): *"a companion gave me all their stuff back for some reason and I didn't notice til we got back to the dungeon and they had a bad default weapon again. I had originally handed her one from the weapon shop through equip party, but later I equipped her two or three times from drops in the dungeon that were better, using the equip direct from looting screen."*

Same class of bug as Hesperos's Lyris-reverting-to-starting-gear report (fixed in v0.57.7), but a different code path. The `[E]` equip-on-companion option on the combat loot prompt at `CombatEngine.cs:7524+` called `player.EquipItem(equipment, targetSlot, ...)` on the Character wrapper returned by `CompanionSystem.GetCompanionsAsCharacters`, but never invoked `CompanionSystem.Instance.SyncCompanionEquipment(wrapper)` after the successful equip. The wrapper's `EquippedItems` dictionary was updated; the underlying `Companion.EquippedItems` was not. On the next wrapper regeneration (re-entering the dungeon, save/load, another location change that builds fresh wrappers), the companion reverted to whatever their last-synced state was — which for this player was the original recruit-time starting gear from `EquipStartingGear`.

The sibling flows — combat-loot auto-equip via `TryTeammatePickupItem` ([CombatEngine.cs:7952](Scripts/Systems/CombatEngine.cs#L7952) and [CombatEngine.cs:8408](Scripts/Systems/CombatEngine.cs#L8408)), and the Home/Inn/TeamCorner manual equip menus — all call `SyncCompanionEquipment` after the equip. The combat-loot `[E]` manual path was the one that didn't, and it's the path this specific player was using.

Fix: one-line addition after the successful equip, gated on `isCompanionEquip && player.IsCompanion`, matches the pattern used by the four already-correct sibling paths. Pre-v0.57.13 save data with the original starting gear will remain as-is; the next time the player equips gear via combat-loot `[E]`, the sync fires correctly and the companion retains the upgrade.

## Beta Announcement Banner

The title-screen banner (shown below the ASCII art) has been updated to announce the official Beta transition. Replaces the generic *"ALPHA BUILD — Expect bugs... (full wipe planned at Beta)"* warning with dated, specific language:

```
╔══════════════════════════════════════════════════════════════════════════╗
║ [!] BETA LAUNCHES MAY 1, 2026 - ONLINE SERVER WIPE INCOMING [!]         ║
║ All characters on the online server will be wiped on May 1st.           ║
║ Report bugs via /bug in-game or join our Discord:                       ║
║ discord.gg/EZhwgDT6Ta                                                    ║
╚══════════════════════════════════════════════════════════════════════════╝
```

Five localization keys updated across all 5 languages (en/es/fr/it/hu): `engine.alpha_compact`, `engine.alpha_sr`, `engine.alpha_wipe`, `engine.alpha_box_title`, `engine.alpha_box_wipe`. Box title padded to exactly 71 chars and wipe line to exactly 72 chars in every language so the English box aligns cleanly; non-English translations run long and overflow the right edge (pre-existing behavior, not worsened by this change). The "Report bugs / join Discord" lines (`alpha_report` / `alpha_box_report`) and `GameConfig.DiscordInvite` URL row are deliberately kept unchanged.

## Kings Blocked from Joining Teams

Player report: a king who ascended while on a team was forced out on ascension (existing behavior) but could then just walk to Team Corner and re-join or form a new one, nullifying the whole eviction.

Root cause: `TeamCornerLocation.CreateTeam()` and `TeamCornerLocation.JoinTeam()` only checked `!string.IsNullOrEmpty(currentPlayer.Team)` as a gate — they didn't check `currentPlayer.King`. The "Apply" menu option at line 299 routes into `JoinTeam()` so it shared the same hole.

Fix: added an early-exit king check to both entry points, message *"A king cannot join or form a gang. The crown stands alone."* New loc key `team.king_cannot_join` in all 5 languages. NPC recruitment INTO the king's own team is still allowed — that's the king wielding power, not joining.

## Shield-Turned-Sword on Save Reload

Player-visible bug: equipping a shield and then reloading the save produced a dual-wield pattern — a normal main-hand swing followed by an "Off-hand strike" for ~50% damage, with the shield acting as the off-hand weapon.

Root cause: the save-load equipment migration at `GameEngine.cs:4320` was introduced to re-infer `WeaponType` and `Handedness` for legacy items whose fields had been written as `None` or defaulted to `Sword`. It ran on any item in `MainHand` or `OffHand`, called `ShopItemGenerator.InferWeaponType(name)`, and overwrote both fields with the inferred result. `InferWeaponType` has no shield keywords and falls through to `WeaponType.Sword`; `InferHandedness(Sword)` returns `OneHanded`. So on every reload a shield became `WeaponType = Sword, Handedness = OneHanded`. `HasShieldEquipped` (keyed on `WeaponType`) then returned false, `IsDualWielding` passed all four checks, and the combat loop fired off-hand strikes. Same migration duplicated in the `LoadSaveByFileName` online-mode branch at `GameEngine.cs:5510`.

Fix: migration now detects shields up front via `ShieldBonus > 0 || BlockChance > 0 || WeaponType ∈ {Shield, Buckler, TowerShield}` and skips the weapon-infer path for them. For shields that previously got mangled by a prior load, a heal branch resets `Handedness = OffHandOnly` and re-infers the shield sub-type via `InferShieldType`, so affected saves self-repair on next login. Both migration sites updated. Tests: 641/641 pass under invariant globalization (matches CI).

## Companion Quest Encounters Locked Out After First-Clearing the Floor Range

Lumina report (Lv.100 Elf Magician, online): visited floors 50 and 60 looking for Melodia's "The Lost Opus" quest encounter, saw "Fully Cleared" everywhere, couldn't interact with anything beyond examining scenery. *"Did I lock myself out from Melodia's quest?"*

Yes — and it wasn't just Melodia. All four floor-ranged companion quests (Aldric 55-65, Mira 40-50, Lyris 80-90, Melodia 50-60) had the same shape: `CheckCompanionQuestEncounters` was called inside the `if (!targetRoom.IsExplored)` block in `MoveToRoom`, so the per-room 15% chance only ever rolled on the room's FIRST visit. Once every room in the quest's floor range was explored, the trigger window was permanently gone. A player who cleared a range before recruiting the companion (or before loyalty hit the 50 threshold needed to start the quest at the Inn) was silently locked out with no signal. Vex is unaffected — his quest has no floor range and already got a parallel late-game gate in v0.57.10.

This stacks with how each companion is gated into the game: Melodia recruits at the Music Shop at Lv.20+, but her quest floor range is 50-60 — an end-game player who recruited her at Lv.20, played happily up through the dungeon, THEN hit the loyalty-50 threshold to start her quest, was past the window by the time they could activate it. Lumina's case exactly.

Fix: moved `CheckCompanionQuestEncounters` out of the first-visit-only block. It now fires on every room entry. Safe because each quest already has a one-shot story-flag guard (`melodia_quest_opus_found`, `lyris_quest_artifact_found`, `aldric_quest_demon_confronted`, `mira_quest_choice_made`) that bails out after the encounter has happened once, so re-visiting doesn't re-trigger.

For Lumina specifically: she can go back to floors 50-60 with Melodia active and the quest will now have a chance to trigger on each room she re-enters.

## Training-Points Respec Inflation (Latent)

Community bug report from Coosh flagged a correctness issue in the training-skill respec accounting. `CalculateTotalPointsInvested` computes the refund as *(completed tier costs) + (currentProgress × currentTier cost-per-point)*, but `AddTrainingProgress` on a level-up carries overflow (`currentProgress -= requiredPoints`) forward into the new tier. Because each tier has a higher training-point cost per progress point, the overflow would be refunded at the NEW tier's rate, even though those points were actually paid at the OLD tier's rate. Example with our rates: overflow 1 at Good→Skilled transition would be refunded at Skilled's 3 pts/progress instead of Good's 2 pts/progress — +1 training point gained per respec per overflow point.

In practice the bug is latent — none of the current callers produce overflow. `TrainSkill` caps `progressToAdd` at `progressToNextLevel` (exact) or `maxProgressAffordable` (always less), and `TryImproveFromUse` adds exactly 1 per combat use. So `currentProgress -= requiredPoints` always lands on 0 today. But the gap is real in code and a future caller, admin edit, or refactor could trigger it.

Fix: `AddTrainingProgress` now stores 0 instead of the overflow after a level-up. Observable game behavior is unchanged (no current caller produces overflow); the refund math is now provably exact. No save migration needed — existing saves with stored overflow are rare-to-zero, and on the next level-up they'll snap to 0 cleanly.

## CI Test Failures Under Invariant Globalization

CI run 24871997948 failed 48 of 641 tests with `ArgumentNullException: Value cannot be null. (Parameter 'key')` at `LocalizationSystem.cs:118`. Locally all tests passed. Reproducible locally under `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` (which matches CI's env).

Root cause: `Loc.Initialize()` was not thread-safe. xUnit runs test classes in parallel, so two test threads racing through `Loc.Get("item.foo")` could both pass the `if (_loaded) return;` guard. Thread A populated `_languages[langCode] = dict` while Thread B concurrently enumerated `_languages.Keys.OrderBy(k => k)` at line 116 — concurrent `Dictionary<TKey,TValue>` modification during enumeration is undefined behavior, and in this case the enumerator yielded a null `code` which then hit `KnownLanguageNames.TryGetValue(code, …)` and threw. Invariant mode exposed the race because it removes the one-time culture-data-loading delay that was incidentally serializing the first few `Loc.Get` calls on the normal path.

Fix: double-checked locking around `Initialize()`. Added `_initLock` and `volatile bool _loaded`, extracted the body to `InitializeLocked()`, and routed the public entry through `lock (_initLock) { if (_loaded) return; InitializeLocked(); _loaded = true; }`. Interior `_loaded = true` assignments removed (the lock block is now the only writer).

## History / Story Screens — Double "Press to continue" Prompt

`UsurperHistorySystem` was writing a hardcoded `[Press Enter to continue]` line in 5 places right before calling `terminal.WaitForKey()`, which itself renders `Press any key to continue...` — so the player saw both prompts stacked. Hardcoded lines removed; `WaitForKey` is the only prompt now.

## Website Landing Page i18n Race (shipped between v0.57.12 and v0.57.13)

The live stats feed on `usurper-reborn.net` would occasionally display raw localization keys (`stats.feed_news_title`, `stats.time_hours`, etc.) instead of translated strings. Root cause: `fetchStats()` and `loadLanguage()` fire in parallel at page load, both async. When the stats API resolved before the language JSON, `renderStats()` called `t('stats.feed_news_title')` against an empty `i18nStrings` dictionary, `t()` fell through to returning the key literal, and the feed rendered with raw keys baked into `innerHTML`. `applyTranslations()` only patches elements with `data-i18n` attributes, and the feed was injected as raw HTML without them — so when the language did finish loading, the already-rendered feed stayed frozen with raw keys until the next `setInterval` refresh cycle (up to 2 minutes later).

Fix: cache the most recent stats payload in a `_lastStatsData` variable, and re-render from cache whenever `loadLanguage()` completes (both the normal localized path and the English-fallback inline fetch). New `Last-Modified` on the deployed file forces a fresh fetch on browsers that cached the broken state.

Deployed Apr 24 01:19 UTC. No game restart required — nginx serves the static file directly.

## Files Changed

- `Scripts/Systems/DiscordBridge.cs` — **NEW** — static helper with `Initialize(databasePath)`, `QueueOutbound(author, message)`, and `DrainInbound()`. Creates the `discord_gossip` table if missing; no-op if `Initialize` hasn't been called.
- `Scripts/Server/MudServer.cs` — calls `DiscordBridge.Initialize(_databasePath)` during `RunAsync` startup; new `DiscordBridgePollerAsync` background task polls inbound Discord messages every 250ms and re-broadcasts each through `RoomRegistry.BroadcastGlobal` matching the `[92m [Gossip] {author}: {message}[0m` format used by `/gos`.
- `Scripts/Server/MudChatSystem.cs` — `HandleGossip` calls `DiscordBridge.QueueOutbound(displayName, message)` after the in-game broadcast. No-op when the bridge isn't initialized (single-player, missing DB).
- `Scripts/Systems/CombatEngine.cs` — combat-loot `[E]` equip-on-companion path now calls `CompanionSystem.Instance?.SyncCompanionEquipment(player)` after successful equip (gated on `isCompanionEquip && player.IsCompanion`) so wrapper changes persist to the underlying `Companion`. Shaman balance pass: weapon-enchant rider at both combat paths (single-monster `~3299` and multi-monster `~11333`) switched from `actualDamage` to `WeaponPower` of the hitting hand; all 16 inline `ShamanEnchantPower` computation sites (8 set + 8 display) replaced with `GameConfig.GetShamanEnchantPower(player.Intelligence)` helper call; Healing Totem tick (`ProcessShamanTotemEffects`) splits solo 10% vs group 5% via `result.Teammates.Any(t => t.IsAlive)` check; Windfury cast uses `GameConfig.ShamanWindfuryProcChance` (40%) instead of hardcoded 30; `GetAttackCount` returns tuple `(int attacks, bool windfuryProcced)` — 5 call sites updated so `baseSwings` extends by +1 on proc to route the bonus swing to main-hand; proc emits a flavor line on the current player.
- `Scripts/Core/GameConfig.cs` — Shaman balance constants: new `ShamanTotemHealPercentGroup = 0.05`, new `ShamanEnchantPowerCap = 250`, new `ShamanWindfuryProcChance = 40`; `ShamanElementalMastery` reduced `0.03 → 0.01`; new `GetShamanEnchantPower(long intelligence)` static helper as single source of truth for the capped enchant-power formula.
- `Scripts/Core/Character.cs` — `GetClassCombatModifiers()` now returns `DamageReduction = 2` for `CharacterClass.MysticShaman` (was the only class with an empty default).
- `Localization/en.json`, `es.json`, `fr.json`, `it.json`, `hu.json` — new loc key `combat.shaman_windfury_proc` in all 5 languages for the new Windfury-proc flavor line.
- `web/ssh-proxy.js` — new Discord bridge section: `startDiscordBridge()` function called from `httpServer.listen` callback; conditional `discord.js` client connection; `messageCreate` handler with rate limit + sanitization; outbound poller with atomic claim + re-entrant guard + graceful failure handling; cleanup task pruning processed rows older than 7 days.
- `web/package.json` — added `"discord.js": "^14.16.0"` dependency.
- `web/index.html` — `_lastStatsData` cache + re-render hook on language load to fix the i18n race on the stats feed.
- `Scripts/Systems/UsurperHistorySystem.cs` — removed 5 hardcoded `[Press Enter to continue]` lines; `WaitForKey()` (which already renders "Press any key to continue...") is now the single prompt.
- `Scripts/Locations/TeamCornerLocation.cs` — `CreateTeam()` and `JoinTeam()` now early-exit with a localized message when `currentPlayer.King == true`, closing the hole where an ascended king could walk back to Team Corner and re-join a gang after the ascension-eviction had already fired.
- `Localization/en.json`, `es.json`, `fr.json`, `it.json`, `hu.json` — new loc key `team.king_cannot_join` in all 5 languages.
- `Localization/en.json`, `es.json`, `fr.json`, `it.json`, `hu.json` — `engine.alpha_compact` / `alpha_sr` / `alpha_wipe` / `alpha_box_title` / `alpha_box_wipe` updated with Beta-launch announcement. Box title padded to 71 chars, wipe to 72 chars for clean English box alignment.

## Deploy Notes

**Game side:** standard linux-x64 publish + tarball + extract pattern; both `usurper-mud` and `sshd-usurper` need a restart for the `DiscordBridge.Initialize` + poller to pick up. The new `discord_gossip` table is created idempotently on first game startup after the binary upgrade.

**Node side:** install `discord.js` in `/opt/usurper/web` (`sudo -u usurper npm install discord.js`), deploy updated `ssh-proxy.js`, create the systemd override at `/etc/systemd/system/usurper-web.service.d/discord.conf` with the bot token and channel ID as `Environment=` directives (chmod 600 — don't want the token readable to other users), then `systemctl daemon-reload && systemctl restart usurper-web`. Bot gateway login takes ~30s to complete; grep the journal for `[Discord] Bridge logged in as` and `[Discord] Watching channel` to confirm.

**Website:** standalone scp of `web/index.html` to `/opt/usurper/web/index.html`; nginx serves directly, no restart needed.

## Operational Notes

- Discord bot token should be rotated any time it appears in chat scrollback, commit history, or anywhere it might be observed by a third party. Rotate via Discord Developer Portal → Bot → Reset Token → update `/etc/systemd/system/usurper-web.service.d/discord.conf` → `systemctl daemon-reload && systemctl restart usurper-web`.
- Bridge can be disabled at runtime by clearing either env var in the override file and restarting `usurper-web`. The game side's outbound queue will accumulate rows but no harm (cleanup task prunes after 7 days regardless).
- Discord API rate limits are per-bot, not per-user. If the bridge ever hits Discord's global rate limit, outbound rows stay queued and retry on the next poll tick.
