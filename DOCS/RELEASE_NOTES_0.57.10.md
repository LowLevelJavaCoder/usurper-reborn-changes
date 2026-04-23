# v0.57.10 - NFU + Dungeon Respawn + Vex Quest + Weekly Rank + Turf Control Audit

Five shipsets. The NFU / stdio exit regression from issue #75, a latent dungeon-respawn bug unmasked by v0.57.6, Vex's personal-quest trigger that never fired for endgame players, a stuck weekly-rank login message, and a deeper pass across the team city-control system from a player report and follow-on audit.

## Root cause

A regression introduced by the v0.54.7 native-Winsock fix for Mystic / EleBBS.

**What v0.54.7 did (correctly).** Mystic and EleBBS hand the door a live TCP socket handle via DOOR32.SYS — our process inherits the raw SOCKET. On exit, .NET's `Socket` finalizers would call `closesocket()` / `Shutdown()` on that inherited handle, which closes the BBS-owned socket, sends a TCP shutdown signal to the remote user, and prevents the door from being relaunched without the user fully reconnecting to the BBS. The fix: raw Winsock P/Invoke `send()`/`recv()` for I/O plus `ExitProcess()` on shutdown to skip .NET finalizers entirely. The OS then closes handles cleanly without emitting TCP shutdown.

**What v0.54.7 broke.** The `NativeExitProcess(0)` guard in [Console/Bootstrap/Program.cs:442](Console/Bootstrap/Program.cs#L442) fired for every Windows BBS exit, whether we were in native-socket mode or stdio mode. In stdio mode, we don't own any socket — `stdin` and `stdout` are pipes owned by the parent process (NFU, Synchronet under stdio, the MUD relay, etc.), and they need a normal EOF so the parent knows the child finished.

`NativeExitProcess` terminates the child before .NET flushes stdout. The parent sees a truncated stream instead of a clean EOF. For NFU specifically — which sits between the child door and the DOS BBS's FOSSIL driver — an abrupt pipe teardown with unflushed data leaves the FOSSIL emulation in an error state. NTVDM locks up. The BBS hangs waiting on NFU. Node becomes unusable until the host reboots. Matches the symptoms exactly.

## Fix

New `DoorMode.IsNativeSocketMode` property at [Scripts/BBS/DoorMode.cs](Scripts/BBS/DoorMode.cs): true only when we're in door mode AND we have a valid inherited socket handle AND stdio wasn't forced. Everything else (stdio mode, non-door, non-Windows, or no socket handle in the drop file) goes through the normal `Environment.Exit(0)` path with an explicit `Console.Out.Flush()` first.

```csharp
if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows) && DoorMode.IsNativeSocketMode)
{
    NativeExitProcess(0);
}
else
{
    try { Console.Out.Flush(); } catch { }
    try { Console.Error.Flush(); } catch { }
    Environment.Exit(0);
}
```

Mystic and EleBBS still get the native exit (they actually own a socket). NFU + Renegade, stdio-mode Synchronet, the MUD relay, Electron, and `--local` all get a clean flush + normal exit. No change in behavior for any path that was already working.

## Why this wasn't caught in the v0.54.7 Mystic fix

Mystic and EleBBS both exercise the same code path (inherited socket handle, native Winsock). Both confirmed working after v0.54.7. NFU sits in a different topology — the socket is owned by NFU, not by the DOS BBS and not by our child process — so it never looked like "the same bug" as Mystic on initial triage. The symptom ("BBS dies, node stuck until reboot") superficially matches "BBS can't relaunch the door," but the mechanism is different: one was us closing the BBS's socket, the other is us not closing our own stdout.

## Phantom uncleared rooms on respawned floors

Player report: "While checking dungeon guide, it says this: 25/25 explored, 24/25 cleared. The game says there are no known destinations. But what happened to the missing room?"

Floor 95 (Terravok). Nav guide header says one room is uncleared, but the menu below says no known destinations. No room to navigate toward — the missing room is a phantom.

**Root cause.** Latent bug in the hourly floor-respawn code at [DungeonLocation.cs:5584-5592](Scripts/Locations/DungeonLocation.cs#L5584-L5592), exposed by v0.57.6's fix that made the hourly respawn actually fire (before v0.57.6 it never did, because `ShouldRespawn()` keyed on `LastClearedAt` which was only set on full-floor clears).

The respawn code blanks `IsCleared = false` on every room whenever the 1-hour respawn timer elapses:

```csharp
if (shouldRespawn && !savedState.IsPermanentlyClear)
{
    room.IsCleared = false;
}
```

That's the right behavior for monster rooms — the respawned monsters make the clear meaningless. But it also fires on rooms with `HasMonsters = false`: settlements, meditation chambers, puzzle rooms, riddle gates, trap gauntlets, memory fragments, lore libraries, treasure-chest rooms (former merchant dens). Those rooms have nothing to re-clear; their `IsCleared` comes from the auto-clear in `MoveToRoom` on first entry ([line 4257-4260](Scripts/Locations/DungeonLocation.cs#L4257-L4260)), not from combat.

After respawn fires, a settlement / meditation chamber / puzzle room that the player had already visited sits at `IsExplored=true, IsCleared=false, HasMonsters=false`. If the player doesn't physically walk back into it, it stays that way forever. The floor counter reads "N-1 / N cleared" and there's a ghost room eating the missing count.

The nav guide then hides the room from the destination list because its uncleared-room filter ([line 11936](Scripts/Locations/DungeonLocation.cs#L11936)) explicitly requires `HasMonsters`:

```csharp
if (nearestUnclearedId == null && room.IsExplored && !room.IsCleared && room.HasMonsters)
    nearestUnclearedId = roomId;
```

That filter is correct for its purpose (it's trying to guide the player to the next monster to kill, not the next bench to sit on). The broken part is upstream — `IsCleared` shouldn't have been blanked on a no-monster room in the first place.

This isn't specific to the safe-haven removal from v0.57.8 — safe-haven rooms were one subset of the broader `HasMonsters=false` class that was affected. Removing the safe-haven flag didn't create the bug; it just happened to be the most visible symptom to the person reporting it.

**Fix.** One-line change to the respawn condition at [DungeonLocation.cs:5601](Scripts/Locations/DungeonLocation.cs#L5601): only un-clear rooms that actually have monsters. No-monster rooms keep their cleared state across respawns, matching the gameplay meaning.

```csharp
if (shouldRespawn && !savedState.IsPermanentlyClear && room.HasMonsters)
{
    room.IsCleared = false;
}
```

**Self-heal for existing saves.** The reporting player's save already had the bad state on floor 95's phantom room. A self-heal block added immediately after the room-state restore block catches any room loaded with `IsExplored=true, IsCleared=false, HasMonsters=false` and forces `IsCleared=true`. Those rooms were never genuinely uncleared — they were always cleared at first entry; the respawn just mangled the flag. Every affected save heals itself on the next floor load, no manual intervention required.

## Vex's personal quest never triggered

Player report: "I am wondering if Vex is bugged. I am relatively close to the end of the game and his quest still not triggered. Only his quest and Melodia's left."

Vex's quest at [DungeonLocation.cs:15162](Scripts/Locations/DungeonLocation.cs#L15162) (`CheckVexQuestEncounter`) uses a fundamentally different trigger from the other three companion quests:

| Companion | Trigger |
|-----------|---------|
| Mira | Floor 40-50 |
| Aldric | Floor 55-65 |
| Lyris | Floor 80-90 |
| Vex | Days-since-recruit ≥ 10 |

Vex's "days since recruit" calculation:

```csharp
int daysWithVex = vex.RecruitedDate != DateTime.MinValue
    ? (int)(DateTime.UtcNow - vex.RecruitedDate).TotalDays
    : StoryProgressionSystem.Instance.CurrentGameDay - vex.RecruitedDay;
```

Two things conspire to keep that counter near zero for online players:

1. **`CurrentGameDay` is the unreliable singleton** — same class of bug the v0.57.6 child-parenting fix already identified. It's process-wide, gets overwritten on each player's login, and doesn't advance cleanly per-player across sessions. A player can play long enough to hit level 100 and reach floor 100 while `CurrentGameDay` only reads 33 on their save — giving something like `33 - 27 = 6 days` with Vex, well below the 10-day gate.

2. **Legacy saves don't have `RecruitedDate`** — players who recruited Vex before the field existed (or before it was serialized correctly) have `save.RecruitedDate == DateTime.MinValue`. The heal at [CompanionSystem.cs:1643](Scripts/Systems/CompanionSystem.cs#L1643) sets it to `DateTime.UtcNow` on every load, which means the wall-clock path reads `UtcNow - UtcNow = 0 days` every single login — the counter resets forever.

Net effect: the reporting player had cleared Aldric's quest (passing through floor 55-65), Mira's (40-50), and Lyris's (80-90), but Vex's trigger stayed gated off the broken day counter. At floor 100 with both floor-window quests long past, the day gate was permanently stuck at 6.

**Fix.** Add a parallel floor gate: if the player is deep enough in the dungeon (floor 70+), Vex's quest is eligible regardless of the day count. He's dying anyway — the narrative still lands. The day gate still fires normally for players who hit it organically (short-session single-player, anyone whose `CurrentGameDay` advances cleanly).

```csharp
bool dayGateReady = daysWithVex >= 10;
bool floorGateReady = currentDungeonLevel >= 70;
if (!dayGateReady && !floorGateReady)
    return false;
```

Floor 70 sits between Lyris (80-90) and unconstrained endgame, so a player who reaches that depth without having triggered any of Vex's three bucket events still has 30 floors (plus back-tracking) for the 10%-per-room roll to catch them. A player already on floor 100 becomes eligible on their next room entry.

The underlying day-counter unreliability (both the singleton drift and the legacy-save heal bug) is left alone here — fixing it properly touches a lot of online-mode state and is out of scope for a hotfix. The floor gate makes the Vex quest reachable regardless.

## Weekly rank message stuck on repeat

Player report: "Every single time I have logged in recently, it says you have moved up 28 ranks and are now in 14th place. It is weird and unexpected because it always says the same place."

The login-display block at [GameEngine.cs:2411-2434](Scripts/Core/GameEngine.cs#L2411-L2434) prints the rank-change message whenever `WeeklyRank != PreviousWeeklyRank`. Nothing consumes the delta after the message fires — the only code path that touches `PreviousWeeklyRank` is the Monday daily-reset inside [DailySystemManager.UpdateWeeklyRankings](Scripts/Systems/DailySystemManager.cs#L476), which runs exactly once a week:

```csharp
player.PreviousWeeklyRank = player.WeeklyRank;  // snapshot current rank
// ...
player.WeeklyRank = sqlBackend.GetPlayerRank(playerKey);  // recompute
```

Between Mondays the gap stays frozen. Every login during the week re-renders the same delta with the same message. A player who moved up 28 ranks last Monday and then logged in three times during the week sees "moved up 28 ranks! Now #14" all three times — suggesting the game thought they were climbing every session when really it was just the one weekly update on loop.

**Fix.** Consume the delta after the message renders. Sync `PreviousWeeklyRank = WeeklyRank` and persist the change:

```csharp
currentPlayer.PreviousWeeklyRank = currentPlayer.WeeklyRank;
_ = SaveCurrentGame();
```

The week-over-week comparison is preserved because Monday's reset snapshots `PreviousWeeklyRank = player.WeeklyRank` as its first line — regardless of whether `PreviousWeeklyRank` was synced between logins or left stale, Monday's reset always rebases it before recomputing. The fix doesn't lose the weekly-delta signal, it just stops re-announcing the same snapshot.

Rival name display (`"Your rival Foo is Level 42."`) is unchanged — it prints inside the same block but doesn't depend on the delta.

## Turf control system audit

Player report: "When I challenge the turf, I win it. When I relog though it appears Watchers has taken back over with no notification?" That single bug kicked off a comprehensive audit of the team city-control system — persistence, transfer correctness, PvP engagement, and civic agency for a player who actually holds turf. What shipped in this release:

### Phase A — Persistence & transfer correctness

**Root cause of the reported bug.** When a player wins Gang War in online mode, the victory correctly sets `currentPlayer.CTurf = true` and stamps CTurf onto the player's team NPCs. That save propagates to `PlayerData` on the next auto-save throttle window (60 seconds). But the authoritative shared-state file (`world_state`) still holds the old losing team's NPC snapshot with `CTurf = true`. If the player logs out before the auto-save throttle fires, `OnlineStateManager.LoadSharedNPCs` on relog reloads the old NPC snapshot and the "who controls town" query returns the original controller. The player's victory looks undone.

Additional gap: the win-flow only stamped CTurf on *alive* NPCs (the fighters), so dead teammate NPCs that later respawn read as non-controllers and can flip the "who controls town" query back to their old team.

**A1 — `SaveAllSharedState` after every turf mutation.** New helper `PersistTurfTransfer()` in [AnchorRoadLocation.cs](Scripts/Locations/AnchorRoadLocation.cs) that calls `OnlineStateManager.Instance.SaveAllSharedState()` in online mode. Wired into all four mutation sites: Gang War victory, ghost-takeover, Claim Town (unopposed claim), Abandon Town. Now the world_state reflects the new controller before the player can log out.

**A2 — Login heal for pre-fix saves.** After `LoadSharedNPCs` runs on login in `GameEngine.LoadSaveByFileName`, check the authoritative answer: if the player's save says `CTurf=true` on team X but world_state has NPC team Y as the rival controller, the player save is stale (either a pre-v0.57.10 scenario where the win never persisted, or an online player-vs-player Gang War while the holder was offline). Conservative choice: trust world_state. Clear `player.CTurf`. Show a red "While you were gone, Y took control of the city. Visit Anchor Road to challenge for it back." banner so the state change isn't invisible. If world_state agrees with the player (or has no controller), rebase NPC flags to match the player's save so pre-v0.57.10 affected saves self-heal.

**A3 — CTurf applied to ALL winning-team NPCs, including dead ones.** The Gang War victory CTurf-setting loop now iterates `allPlayerTeamMembers` (every NPC on the player's team) instead of `playerTeamFighters` (alive-only). Same change on the losing side — strip CTurf from every NPC on the losing team. Ghost-takeover block already did this correctly; now the normal Gang War path matches. Prevents dead/permadead teammates from respawning as non-controllers.

**A4 — News visibility for offline turf changes.** Existing `NewsSystem` already posts "Team X took control" when world-sim claims turf, and that news entry surfaces in the "While You Were Gone" summary on the next login. No separate change needed. Combined with A2's red-banner notification for the specific "you used to hold turf, someone else holds it now" case, the state change is surfaced two ways: prominently as a dedicated login line, and in the world news feed.

### Phase B — Civic agency

The audit confirmed that tax revenue genuinely works — `CityControlSystem.ProcessSaleTax` routes the city-tax share to the team leader's `BankGold` at every shop sale. But the player has no in-game visibility into it. They have to notice their bank balance climbing to realize they're earning anything.

**B3 — Tax earning counters.** Two new `Character` properties: `CityTaxEarnedThisWeek` (resets every Monday alongside the weekly-rank update) and `CityTaxEarnedLifetime` (accumulates forever while the player holds turf). Incremented inside `CityControlSystem.ProcessSaleTax` alongside the existing `BankGold` deposit. Persisted through `PlayerData` → save/load roundtrip.

**B2 — Town Hall menu (`/town` slash command).** New menu accessible from any location via `/town` or `/townhall`. Reads the player's current turf state and shows:
- Ruling team name
- Team members (alive count)
- King-set city-tax rate + King's tax rate
- Tax income earned this week + lifetime
- A footer noting that earnings auto-deposit to the player's bank account

First iteration is read-only — adjusting the city-tax rate stays a King-only power (set via Castle). Keeping the Town Hall separate from the King's political levers avoids two masters fighting over the same toggles; the controller just collects whatever rate the King sets. Future iterations could add light civic powers (a decree line, closing an establishment) but that invites politics-vs-turf-control conflict that's out of scope for this pass.

**B1 — Deferred: Gang War team combat.** The audit noted that only the player fights in Gang War, even though their team NPCs inherit the turf. This was considered but set aside: the existing Gang War combat path is `CombatEngine.PlayerVsPlayer`, identical to the Arena PvP flow the player already knows. It IS "like PvP everywhere else." Adding teammate participation would require either bolting multi-party support onto `PlayerVsPlayer` or wrapping enemy NPCs as Monster objects for the multi-monster path — both are substantial combat-engine refactors that belong in a dedicated release. The core engagement problem (turf doesn't matter) is addressed by B2 + B3 giving the player in-game visibility into what they win.

### Phase C — Offline visibility

**C1 — Offline turf-change banner.** Implemented inline with A2. When the login heal detects that the player held turf but a rival now holds it in world_state, render a two-line banner (red `"While you were gone, X took control of the city."` + gray `"Visit Anchor Road to challenge for it back."`) before the normal Main Street entry. Paired with the existing "While You Were Gone" news feed which already shows turf-change news entries posted while the player was offline, the player now learns about the loss in at least two places.

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.57.10.
- `Scripts/BBS/DoorMode.cs` — New `IsNativeSocketMode` public property: true only when in door mode with a valid inherited socket handle and stdio not forced. Used as the guard for whether the process-exit path should skip .NET finalizers.
- `Console/Bootstrap/Program.cs` — BBS-mode exit path gated on `DoorMode.IsNativeSocketMode`. Socket-mode exits still use `NativeExitProcess(0)` (Mystic / EleBBS behavior unchanged). Stdio-mode exits now flush stdout/stderr and go through `Environment.Exit(0)` so parent processes (NFU, Synchronet stdio, MUD relay) get a clean EOF.
- `Scripts/Locations/DungeonLocation.cs` — Two changes. (1) Floor respawn at `LoadFloorState` now gates `IsCleared = false` on `room.HasMonsters`. No-monster rooms (settlements, meditation chambers, puzzles, riddles, trap gauntlets, memory fragments, lore libraries, treasure chests) keep their cleared state across respawns. Plus a self-heal block that patches any room loaded with `IsExplored=true, IsCleared=false, HasMonsters=false` — fixes existing affected saves on next floor load. (2) `CheckVexQuestEncounter` gate extended with a floor-70 parallel condition. Day-counter trigger still fires normally; floor-depth trigger catches endgame players whose day counter is stuck (online-mode singleton drift, legacy-save recruitedDate heal loop).
- `Scripts/Core/GameEngine.cs` — (1) After the weekly-rank message prints, sync `PreviousWeeklyRank = WeeklyRank` and fire `_ = SaveCurrentGame()` so the delta doesn't re-announce on every login. (2) Login heal block after the online `LoadSharedNPCs` call: detect stale CTurf (player vs world_state disagreement) and either clear player.CTurf (rival holds it in world_state) with a red "turf lost while offline" banner, or rebase NPC flags onto the player's team (pre-v0.57.10 save Coosh-scenario). (3) Restore `CityTaxEarnedThisWeek` / `CityTaxEarnedLifetime` from save.
- `Scripts/Core/Character.cs` — New `CityTaxEarnedThisWeek` and `CityTaxEarnedLifetime` properties alongside `CTurf`.
- `Scripts/Systems/CityControlSystem.cs` — `ProcessSaleTax` now increments `CityTaxEarnedThisWeek` and `CityTaxEarnedLifetime` when depositing the city-tax share to a player turf-controller's `BankGold`.
- `Scripts/Systems/DailySystemManager.cs` — Monday daily-reset now zeros `CityTaxEarnedThisWeek` alongside updating weekly rankings.
- `Scripts/Systems/SaveDataStructures.cs` + `Scripts/Systems/SaveSystem.cs` — Serialize the two new tax counters.
- `Scripts/Locations/AnchorRoadLocation.cs` — Four turf-mutation sites (Gang War victory, ghost-takeover, Claim Town, Abandon Town) now call a new `PersistTurfTransfer` helper that runs `OnlineStateManager.SaveAllSharedState()`. Gang War victory CTurf-setting loop expanded to stamp/strip CTurf on every team member (alive + dead) instead of alive-only.
- `Scripts/Locations/BaseLocation.cs` — New `/town` (alias `/townhall`) slash command + `ShowTownHall` method. Help menu entries for `/town` added to both visual and BBS-compact help screens.
- `Localization/en.json` + es/fr/hu/it — New `base.help_town`, `town_hall.title`, `town_hall.not_controller`, `town_hall.ruling_team`, `town_hall.team_members`, `town_hall.tax_rate`, `town_hall.king_rate`, `town_hall.earned_week`, `town_hall.earned_lifetime`, `town_hall.earnings_note`, `engine.turf_lost_offline`, `engine.turf_lost_offline_hint` keys translated across all 5 languages.

## Verification needed

- **NFU / Renegade:** can't reproduce locally. The reporter on issue #75 will need to confirm on their Renegade BBS setup. Change is narrow and Mystic / EleBBS paths are untouched, so regression risk on already-working setups is low.
- **Phantom rooms:** affected floors self-heal on the next dungeon-guide check. Any player with a similar "N-1 / N cleared, no destinations" state on any floor will heal the same way. Fresh-generated floors will never hit the bug again.
- **Vex quest:** any affected player's next dungeon room entry on floor 70+ has a 10% chance of triggering the first bucket-list event. Worst case needs a handful of rooms. Players who already triggered Vex's quest via the day-gate are unaffected.

Tests: 596 / 596 passing.
