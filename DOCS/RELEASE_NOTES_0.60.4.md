# v0.60.4 -- Beta

Hotfix release on top of v0.60.3. One stat-roll exploit fix and a long-overdue admin-dashboard surface for the bot detection system.

---

## Stat-roll free reroll on invalid input

Player report (Rage): "found a silly bug -- when you go to roll your stats, any input besides what is prompted of you re-rolls your stats again. You can do it forever. I dunno if this is actually a big deal since you can just not accept your character after 5 stat rerolls anyway, but I did it on accident then went 'wait a second...' and wound up with like two whole more CON than I had rolled previously after a few tries."

Confirmed and exactly as described. `CharacterCreationSystem.RollCharacterStats` had `RollStats(character)` at the top of its `while (true)` loop, and the invalid-input branch did `continue` -- which jumped back to the top of the loop, re-rolling the stats fresh without decrementing `rerollsRemaining`. So pressing anything other than `A` (accept) or `R` (reroll) silently rolled fresh stats and let the player keep rolling forever, bypassing the 5-reroll cap entirely.

The accept/reroll prompt itself was correct -- the bug was structural in the loop. Player rolls 5 times legitimately, hits the cap, then presses any wrong key and gets another fresh roll, gets a wrong key prompt, presses another wrong key, fresh roll again, etc.

Fix: gate the roll on a `shouldRoll` flag. Set true on initial entry and on legitimate `[R]eroll` (which still consumes the counter). Invalid input now re-prompts WITHOUT triggering a fresh roll. The displayed stats stay locked until the player picks A or R.

Files: `Scripts/Systems/CharacterCreationSystem.cs` (`RollCharacterStats` loop structure).

---

## Bot detection -- admin dashboard surface

`BotDetectionSystem` has been instrumenting per-player combat-input cadence since v0.60.0 (rolling 30-sample window, mean / stddev / consecutive-fast tracking) but the data was sealed inside the game process. The `Snapshot()` method existed and was documented as "for admin dashboard surfacing" but nothing called it. Sysops only saw flagged sessions via `BOT_SUSPECT` log entries -- which require crossing all three thresholds simultaneously, a high bar that nobody on the live server has hit.

Now the snapshot data is on the admin dashboard:

- **New SQLite table** `bot_detection_snapshot` (single row, id=1) holding the latest `Snapshot()` output as JSON plus the threshold values. Created via `CREATE TABLE IF NOT EXISTS` on first server startup post-deploy.
- **New 30s timer** in `MudServer` (`BotDetectionSnapshotLoopAsync`) that calls `BotDetectionSystem.WriteSnapshotToDb` every 30 seconds, UPSERTing the latest cadence data for every actively-tracked session.
- **New API endpoint** `GET /api/admin/bot-stats` (Node-side in `web/ssh-proxy.js`) reads the row and returns thresholds + sessions. Marks the response as `stale: true` if the snapshot is older than 90s (game process down or deadlocked).
- **New "Bot Detection" section** on the admin dashboard (`web/admin.html`). Renders a sortable table: player, mean interval, std dev, consecutive fast count, total flags this session. Suspect sessions float to the top in red; flagged-but-not-currently-suspect in amber; clean sessions in default. Each cell that's CURRENTLY meeting its individual flag threshold is highlighted red so a sysop can see "this player is X% of the way to a flag" without staring at the threshold table. Refreshes alongside the rest of the dashboard on the 30s `refreshAll` cycle.

This is read-only review -- no automated action is taken on flagged sessions. The intent is to give the sysop visibility into who's playing fast so thresholds can be tuned against real data before any throttling or kicking gets wired in.

Files: `Scripts/Server/BotDetectionSystem.cs` (new `WriteSnapshotToDb` method serializing thresholds + sessions), `Scripts/Systems/SqlSaveBackend.cs` (new `bot_detection_snapshot` table in the schema, new `UpsertBotDetectionSnapshot` method), `Scripts/Server/MudServer.cs` (new `BotDetectionSnapshotLoopAsync` 30s timer), `web/ssh-proxy.js` (new `/api/admin/bot-stats` endpoint), `web/admin.html` (new "Bot Detection" section + `refreshBotStats` renderer).

---

## Files Changed

- `Scripts/Core/GameConfig.cs` -- version bump to 0.60.4.
- `Scripts/Systems/CharacterCreationSystem.cs` -- `RollCharacterStats` gates `RollStats` on a `shouldRoll` flag so invalid input doesn't trigger a free reroll.
- `Scripts/Server/BotDetectionSystem.cs` -- new `WriteSnapshotToDb(SqlSaveBackend)` static method.
- `Scripts/Server/MudServer.cs` -- new `BotDetectionSnapshotLoopAsync` 30s timer; launched alongside the existing IdleWatchdog at MUD server startup.
- `Scripts/Systems/SqlSaveBackend.cs` -- new `bot_detection_snapshot` table; new `UpsertBotDetectionSnapshot(string)` method.
- `web/ssh-proxy.js` -- new `GET /api/admin/bot-stats` endpoint.
- `web/admin.html` -- new "Bot Detection" section with `refreshBotStats` async renderer.

---

## Deploy notes

- Standard recipe: publish linux-x64, tar, scp, restart `usurper-mud` and `sshd-usurper`.
- The `bot_detection_snapshot` SQLite table is created via `CREATE TABLE IF NOT EXISTS` on first MUD server startup post-deploy. No manual migration required.
- The web proxy (`usurper-web`) needs to be restarted to pick up the new `/api/admin/bot-stats` endpoint and updated `admin.html`.

For testing post-deploy:

- Start character creation, get to the stat roll screen, press `X` (or any non-A/non-R key). Confirm the displayed stats DON'T change and the "choose A or R" message appears. Press `R` (rerolls remaining counter ticks down by 1). Press `X` again -- stats stay the same, counter doesn't decrement.
- Wait 30+ seconds after a player connects and engages in combat. Open the admin dashboard, scroll to "Bot Detection" -- the section should populate with the player's username, mean interval, std dev, consecutive fast count, and flag count. With no players in combat, expect "No active combat sessions tracked."
