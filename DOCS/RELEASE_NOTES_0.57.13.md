# v0.57.13 - Discord Bridge + Companion Loot Sync + Website i18n Race

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

## Mystic Shaman Weapon-Enchant Damage Cap

Community report (Rozro, Lv 71 MysticShaman): endgame Shamans were one-shotting Old Gods. Ordinary basic attacks were proc'ing elemental rider damage of 400-800k per hit. Zengazu and spudman chimed in to say the scaling was obvious enough that they were considering re-rolling just to abuse it.

Root cause: the weapon-enchant rider at [CombatEngine.cs:3301](Scripts/Systems/CombatEngine.cs#L3301) (and twin at [:11335](Scripts/Systems/CombatEngine.cs#L11335)) computed as `actualDamage * ShamanEnchantPower / 100.0`. `ShamanEnchantPower = 20 + INT*3` (from `ShamanElementalMastery = 0.03` at [GameConfig.cs:1014](Scripts/Core/GameConfig.cs#L1014)). So at INT 100 the enchant adds 320% of `actualDamage`, at INT 500 it's 1520%, at Rozro's INT 966 it's 2920% — i.e. every hit auto-adds 29x the already-multiplied damage as an elemental proc. Worse, because `actualDamage` is the post-crit, post-passive, post-buff final number, crits DOUBLE-compounded: a 3x crit on the main hit became a 29 * 3 = 87x elemental proc on top.

The intended design of "+3% elemental damage per Intelligence point" was a rider on weapon power, not a multiplier on the already-amplified attack total. Fixed by switching the rider base from `actualDamage` to raw `WeaponPower` of the hitting hand: `shamanWeapon.WeaponPower * ShamanEnchantPower / 100.0`. Dual-wielders correctly scale each swing off that hand's weapon (`isOffHandAttack ? OffHand : MainHand`). INT scaling preserved at 3% per point — a max-DEX max-INT Shaman still gets a massive rider, just proportional to the weapon they're actually swinging.

Rozro's projected numbers post-fix with WeapPow 1242 / INT 966: roughly 36k per hit rider (down from 400-800k). Dual-wielding ~72k per round. Still a dominant class mechanic; no longer breaks boss fights. Crits now amplify the weapon hit only — the elemental rider stays at its steady per-hit value, which is the more sensible game design anyway.

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
- `Scripts/Systems/CombatEngine.cs` — combat-loot `[E]` equip-on-companion path now calls `CompanionSystem.Instance?.SyncCompanionEquipment(player)` after successful equip (gated on `isCompanionEquip && player.IsCompanion`) so wrapper changes persist to the underlying `Companion`. Also: Mystic Shaman weapon-enchant rider at both combat paths (single-monster `~3299` and multi-monster `~11333`) changed from `actualDamage * ShamanEnchantPower` to `WeaponPower * ShamanEnchantPower`, closing the endgame 400-800k-per-hit exploit.
- `web/ssh-proxy.js` — new Discord bridge section: `startDiscordBridge()` function called from `httpServer.listen` callback; conditional `discord.js` client connection; `messageCreate` handler with rate limit + sanitization; outbound poller with atomic claim + re-entrant guard + graceful failure handling; cleanup task pruning processed rows older than 7 days.
- `web/package.json` — added `"discord.js": "^14.16.0"` dependency.
- `web/index.html` — `_lastStatsData` cache + re-render hook on language load to fix the i18n race on the stats feed.
- `Scripts/Systems/UsurperHistorySystem.cs` — removed 5 hardcoded `[Press Enter to continue]` lines; `WaitForKey()` (which already renders "Press any key to continue...") is now the single prompt.
- `Localization/en.json`, `es.json`, `fr.json`, `it.json`, `hu.json` — `engine.alpha_compact` / `alpha_sr` / `alpha_wipe` / `alpha_box_title` / `alpha_box_wipe` updated with Beta-launch announcement. Box title padded to 71 chars, wipe to 72 chars for clean English box alignment.

## Deploy Notes

**Game side:** standard linux-x64 publish + tarball + extract pattern; both `usurper-mud` and `sshd-usurper` need a restart for the `DiscordBridge.Initialize` + poller to pick up. The new `discord_gossip` table is created idempotently on first game startup after the binary upgrade.

**Node side:** install `discord.js` in `/opt/usurper/web` (`sudo -u usurper npm install discord.js`), deploy updated `ssh-proxy.js`, create the systemd override at `/etc/systemd/system/usurper-web.service.d/discord.conf` with the bot token and channel ID as `Environment=` directives (chmod 600 — don't want the token readable to other users), then `systemctl daemon-reload && systemctl restart usurper-web`. Bot gateway login takes ~30s to complete; grep the journal for `[Discord] Bridge logged in as` and `[Discord] Watching channel` to confirm.

**Website:** standalone scp of `web/index.html` to `/opt/usurper/web/index.html`; nginx serves directly, no restart needed.

## Operational Notes

- Discord bot token should be rotated any time it appears in chat scrollback, commit history, or anywhere it might be observed by a third party. Rotate via Discord Developer Portal → Bot → Reset Token → update `/etc/systemd/system/usurper-web.service.d/discord.conf` → `systemctl daemon-reload && systemctl restart usurper-web`.
- Bridge can be disabled at runtime by clearing either env var in the override file and restarting `usurper-web`. The game side's outbound queue will accumulate rows but no harm (cleanup task prunes after 7 days regardless).
- Discord API rate limits are per-bot, not per-user. If the bridge ever hits Discord's global rate limit, outbound rows stay queued and retry on the next poll tick.
