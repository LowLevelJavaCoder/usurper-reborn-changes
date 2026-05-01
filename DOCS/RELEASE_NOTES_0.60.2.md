# v0.60.2 -- Beta

Bug-fix and polish release on top of v0.60.0 covering early-beta playtester reports. Largest items: a full rewrite of the online-mode death flow (3 free resurrections then permadeath, no menu prompts, no "use a resurrection?" stutter), non-lethal arrest combat so getting subdued by Royal Guards no longer eats a resurrection, and a half-dozen smaller bugs that surfaced once players started murdering each other in earnest. Plus the Rage event scaffolding -- an admin-triggered server-wide cinematic wipe that's used when nuking the live database between beta playtests.

---

## Death system simplification (online mode only)

Pre-v0.60.2 online death dropped the player into the same penalty-choice menu single-player has used since v0.53.5: Temple resurrection (50% gold, 3 uses), Deal with Death (10,000 Darkness + permanent stat loss), or Accept Fate (-5 levels, 75% gold, random item). All three options exist in single-player and are staying there. In online mode they don't fit -- "use one of three free resurrections" was already meant to be the default, and the penalty menu confused testers into thinking they could skip a resurrection by paying gold instead.

Online-mode death is now: each character starts with 3 free resurrections. Each death decrements the counter and full-heals to 50% MaxHP. When the counter hits 0, the next death is permanent -- the character file is deleted, a server-wide red broadcast goes out, and a news entry is posted. No menu, no prompts, no save scumming.

New `Scripts/Systems/PermadeathHelper.cs` consolidates the logic across all three death entry points (`CombatEngine.HandlePlayerDeath`, `LocationManager.HandlePlayerDeath`, `GameEngine.HandleDeath`) so the same flow runs whether you die in combat, in a non-combat location event, or via a system-initiated death. Pre-v0.60.2 each path had its own slightly-different copy and the duplication caused the v0.60.1 "broadcast prints twice" bug.

### Permadeath broadcast and durability

Three bugs surfaced in the first 48 hours of beta when players actually started hitting permadeath:

**1. Broadcast rendered as literal `[1;31m` text.** The ANSI escape byte (0x1B) wasn't surviving Edit/Write tool roundtrips in the source files for the new permadeath code. Players saw `[1;31m  *** Mr. Potato Head the Lv.1 Barbarian has been erased forever, slain by Sir Galahad. *** [0m` in their scroll buffer instead of a red highlighted line. Fixed by ensuring `[1;31m` and `[0m` made it into the source unmodified, verified post-build with `cat -v` on the binary.

**2. Permadeath broadcast fired twice.** `CombatEngine.HandlePlayerDeath` ran the permadeath path, which set `IsIntentionalExit = true` and deleted the save. Control then returned to the caller, which checked `player.HP <= 0` and fired `LocationManager.HandlePlayerDeath` -- which ran the permadeath path again. Fixed with explicit short-circuits at the top of `LocationManager.HandlePlayerDeath` and `GameEngine.HandleDeath`: if `SessionContext.IsIntentionalExit == true`, return without doing anything else. The first death handler already finished the work.

**3. Deletion didn't stick.** Players who hit permadeath could log straight back in. The `DeleteGameData` call did its job at the moment of permadeath, but `PlayerSession.RunAsync`'s emergency-save-on-disconnect path then wrote a fresh row back into the `players` table on the way out, restoring the character file with current state. Two-layer fix: (a) new `PlayerSession.SuppressDisconnectSave` flag set to `true` before the delete so the disconnect path skips the save entirely, (b) new `RageEventErasedUsernames` ConcurrentDictionary blacklist that `WriteGameData` checks at the top of every save call, refusing writes to blacklisted usernames regardless of which code path called it. The blacklist clears when the player creates a fresh character (via new `SqlSaveBackend.ClearErasedMark`), so the same SSH account can re-roll without being permanently locked out.

Reporter's words: "Ted and pot both could log straight back into their characters." Now they can't.

### `/restore` is admin-only

Pre-v0.60.2 the permadeath broadcast included "type `/restore` within 7 days to bring your character back." Three problems: (a) `/restore` predates v0.60.0 and was never meant to be in regular players' hands -- it was an admin tool routed through `MudChatSystem` for sysop testing, (b) it would let a player undo their own permadeath, defeating the point, and (c) the message used the word "sysop" which is unfamiliar to non-BBS players. Fix: `/restore` is now Wizard-tier in `WizardCommandSystem` only; the player-side handler in `MudChatSystem` returns a "Contact an admin" hint instead. Permadeath broadcast text updated from "type `/restore` within 7 days" to "Contact an admin if you believe this was in error."

The 7-day archive in `deleted_characters` (introduced in v0.60.0 for the Tier 1 char-deletion safety net) is unchanged -- admins can still restore from archive. Players just can't do it themselves.

---

## Non-lethal arrest combat

Pre-v0.60.2 flow when you tried to murder someone and lost the murder check: alignment penalty applied, `DaysInPrison` set, "you are arrested!" message printed -- and that was it. No combat, no consequence, just a debuff and a teleport. The murder wasn't actually attempted from a fiction standpoint; the system just decided you got caught thinking about it.

Beta playtesting surfaced two complaints: (a) the "phantom arrest" with no combat felt cheap, (b) the *successful* murder branch correctly summons 5 Royal Guards for combat, and there was no parallel "guards beat you up" outcome on the loss side. Players wanted the full guard fight either way.

New flow: failed-murder branch is removed entirely -- if you start the murder, the murder happens, and the consequence is the guard fight that follows the kill. That's it. No alignment penalty, no `DaysInPrison`, no arrest message on the no-combat path because there is no no-combat path anymore.

The guard fight itself was also broken: losing to the guards triggered `HandlePlayerDeath`, which in turn triggered the new permadeath system, which consumed a resurrection (and at counter 0, deleted the character) for what was supposed to be a "haul you to prison" sequence. Combat-loss to Royal Guards is supposed to be a *non-lethal subdual*, not a death. Fix: new transient `Character.IsArrestCombat` flag (`JsonIgnored`) wraps the guard `PlayerVsMonsters` call. `CombatEngine.HandlePlayerDeath` short-circuits at the top: if `IsArrestCombat == true`, set HP to 1, set `Outcome = PlayerEscaped`, and return. No resurrection consumed, no permadeath check, no broadcast.

After sentencing, the player is moved to prison via `throw new LocationExitException(GameLocation.Prison)` instead of falling through to the normal location loop. Pre-fix the fall-through caused a second arrest broadcast (because the location loop re-entered `BaseLocation` which re-checked the arrest state) and sometimes a session disconnect.

Files: `Scripts/Core/Character.cs`, `Scripts/Systems/CombatEngine.cs`, `Scripts/Locations/BaseLocation.cs`.

---

## Vex prison crash fix

Player report: "(W)ho else is here ... Royal Prison ... :v ... Error loading save: Object reference not set to an instance of an object." Pressing `[V]` in prison to talk to Vex (the recruitable thief companion) crashed and disconnected the session.

Root cause: `PrisonLocation.HandleVexEncounter` and its two helpers (`VexHelpsEscape`, `TalkToVex`) dereferenced `vex.DialogueHints[0..2]`, `vex.Title`, `vex.CombatRole`, `vex.Abilities`, `vex.BackstoryBrief`, `vex.Description`, `vex.PersonalQuestName`, and `vex.Name` directly. On a fresh-character context (no recruited companions, default companion data) one or more of those fields were null. The error message was the bubbled-up generic exception text from `LoadSaveByFileName`'s outer catch block -- the actual exception was `NullReferenceException` somewhere in the Vex cinematic.

Fix: defensive pre-extraction at the top of each Vex method with safe fallbacks (`vex.Name ?? "Vex"`, `vex.DialogueHints?[i] ?? "..."`, etc.), and a try/catch around the `[V]` dispatcher in `PrisonLocation.ProcessChoice` that logs the exception under the `PRISON` debug category and shows "There is no one unusual here" instead of crashing. Defense-in-depth so any future field added to `Companion` won't crash players who hit it before the field is populated.

Files: `Scripts/Locations/PrisonLocation.cs`.

---

## Prison menu color bleed

Player screenshot: prison menu rendered with red text inherited from the immediately-prior murder cinematic. Pre-v0.60.2 the prison menu used plain `terminal.WriteLineAsync` calls without setting an explicit color, so they picked up whatever color was last set -- and the murder cinematic ended on a `red` color set for the "you have committed murder" line. Fix: explicit `terminal.SetColor("white")` reset before each block of plain lines in `ShowPrisonMenuFull`.

Files: `Scripts/Locations/PrisonLocation.cs`.

---

## Companion equipment slot validation

Player screenshot: Vex (Assassin companion) had a Chain Shirt in his MainHand slot. The combat log was offering "Equip Mace? 1800% upgrade" because the comparison code was scoring a real weapon against the Chain Shirt-as-a-weapon and getting a huge delta.

Root cause: `Character.EquipItem` validated weapon `Handedness` (one-handed / two-handed / off-hand-only) but didn't validate the item's `Slot` matched the requested slot for non-weapon items. So Chain Shirt (Slot = Body) could be equipped to MainHand if some upstream code passed the wrong slot. Beta testing surfaced at least one path through `TryTeammatePickupItem` doing exactly that.

Two-layer fix: (a) `Character.EquipItem` now rejects non-weapon items with `slot != item.Slot` and returns "This item belongs in the {item.Slot} slot, not {slot}." -- the equip fails cleanly instead of producing a phantom equipped state. (b) `CombatEngine.TryTeammatePickupItem` now skips comparison entirely when the held-slot item's type doesn't match the loot type (Chain Shirt in MainHand won't be compared against an incoming Mace).

User said "I'm wiping the server again soon" so the self-heal block that would have walked existing companion saves and relocated mis-slotted items was reverted -- the wipe handles existing bad data.

Files: `Scripts/Core/Character.cs`, `Scripts/Systems/CombatEngine.cs`.

---

## Guild commands accept multi-word display names

Player report (Xian Maximillion): "When doing a `/ginvite` you need to do account name not character name. You can't see account name in the `/who` though." Same issue as v0.57.21's `/tell` fix -- pre-v0.60.2 `/ginvite`, `/gkick`, `/gtransfer`, `/grank` looked up players by login username only, not by display name with spaces.

Fix: all four commands now use the same `FindSessionByNameOrUsername` resolver that `/tell` got in v0.57.21, with greedy longest-prefix matching for multi-word display names. `/ginvite Lumina Starbloom` now correctly resolves "Lumina Starbloom" as the target instead of trying to match login `Lumina` and treating `Starbloom` as a stray argument.

Files: `Scripts/Server/MudChatSystem.cs`.

---

## Dungeon level-change message correction

Player report: "It says 'your level +10' deepest accessible 17 but I'm level 12. That math ain't mathin." The dungeon level-restriction message hardcoded "+/- 10" in the localization string, but the actual allowance is set per-config and could differ from 10. Pre-v0.60.2 the displayed number was right (max accessible was correctly clamped) but the explanatory text was misleading.

Fix: `dungeon.deepest_accessible` now takes 2 args (`{0}` = max accessible floor, `{1}` = level allowance) so the message can read "deepest accessible: {0} (your level + {1})" without the hardcoded "10". Removed the stale "+/- 10" text from `dungeon.level_change`, `level_change_label`, and `dungeon.bbs_level_change` across all 5 languages (en/es/fr/hu/it).

Files: `Localization/{en,es,fr,hu,it}.json`, plus the call sites in `Scripts/Locations/DungeonLocation.cs`.

---

## Tank taunt: locked-on-for-the-fight bug + percentage-stick design

Two issues, fixed together. The first is the bug; the second is a design change to keep tanks from being an "invincible wall of flesh, win" button.

### The bug -- taunt duration only decremented when the player was the target

`Monster.TauntRoundsLeft` had exactly one decrement site: in `ProcessMonsterAction`, AFTER the `SelectMonsterTarget` -> branch-to-companion-attack early-return point. So the flow was:

```
SelectMonsterTarget returns the tank (TauntedBy match)
-> targetChoice != player
-> MonsterAttacksCompanion(...)
-> return     <-- never reaches the decrement below
```

When the taunter was the *player* (basic [T] action, or player casting an AoE taunt themselves), the player branch fell through to the decrement and it ticked normally -- which is why solo testing didn't catch it. The bug only triggered when an *NPC tank teammate* (Aldric Warrior with Thundering Roar / Shield Wall Formation, NPC Paladin with Divine Mandate, NPC Barbarian with Rage Challenge, NPC Tidesworn with Abyssal Anchor / Undertow Stance) was the taunter. In that case `TauntRoundsLeft` stayed at its initial value forever, `TauntedBy` never cleared, and the monster locked onto the NPC tank for the entire fight regardless of the configured duration.

This is why every tank-main playtester thought the AoE taunts felt overtuned -- a "3-round" taunt was effectively unlimited if cast by a teammate. Fix: extracted target selection from action dispatch in `ProcessMonsterAction`, decrement runs after `SelectMonsterTarget` returns but before either the companion-attack early-return or the player-attack continuation. Both branches now tick the duration correctly.

Files: `Scripts/Systems/CombatEngine.cs` (`ProcessMonsterAction`).

### The design change -- soft AoE taunt (75% stick per round)

Even with the duration bug fixed, a 100% guaranteed AoE taunt for 3 rounds combined with Shield Wall Formation's 30% damage reduction made the rest of the party untouchable for the duration. Keep stacking taunts on cooldown and the tank is essentially the only legal target for the whole fight -- "invincible wall of flesh, win." Same shape complaint as the original feedback that drove v0.56.0's tank rebalance.

New mechanic: per-round probabilistic taunt stick.

- New field `Monster.TauntStickChance` (0-100, default 100). Each round, `SelectMonsterTarget` rolls `random.Next(100) < TauntStickChance` -- if it passes, taunt forces the target; if it fails, the monster falls through to the normal weighted-target selection (which still favors the tank via threat weight, just not absolutely).
- New constant `GameConfig.SoftTauntStickChance = 75`. AoE class-ability taunts set the field to this value.
- **Soft taunts (75% stick, "threatened, not locked")**: Thundering Roar (`aoe_taunt`), Undertow Stance (`undertow`), Abyssal Anchor (`abyssal_anchor`), Shield Wall Formation / Divine Mandate / Rage Challenge (all routed through `ApplyTankTauntAndBuff`). Single-monster and multi-monster ability handlers both updated.
- **Hard taunts (100% stick, kept as-is)**: basic [T] action (1-2 round emergency lock), Eternal Vigil (Tidesworn invuln cooldown -- the entire point of that cooldown is absolute aggro on the invulnerable tank, leaving it at 100% preserves the design intent).
- Hard-taunt sites also explicitly write `TauntStickChance = 100` so a previously-soft-taunted monster getting hard-taunted resets correctly. The decrement-to-zero path also resets `TauntStickChance` to 100 default to keep monster state consistent.

Effective new behavior with Shield Wall Formation against 5 monsters for 3 rounds: ~75% of monster-rounds attack the tank, ~25% slip through to the rest of the party. Tank still bears the bulk of damage and remains the threatening target, but the rest of the party is no longer in safe-pause for the duration. Healers and DPS have to actually pay attention.

Tunable from one site -- if 75% feels too sticky raise to 85, too leaky drop to 60. The field is per-monster so individual taunts can override the default if a future ability wants stronger or weaker stick.

Files: `Scripts/Core/Monster.cs` (new `TauntStickChance` field), `Scripts/Core/GameConfig.cs` (new `SoftTauntStickChance` constant), `Scripts/Systems/CombatEngine.cs` (`SelectMonsterTarget` roll, plus `aoe_taunt` / `undertow` / `abyssal_anchor` / `ApplyTankTauntAndBuff` / hard-taunt sites in both single-monster and multi-monster paths).

---

## Shutdown signal handling

Committed in 32ed2a4. The MUD server's SIGTERM/SIGINT handler occasionally threw `ObjectDisposedException` during graceful shutdown when player sessions were torn down concurrently with the main loop's cancellation. Fix: defensive null-check on `_shutdownCts` plus `try/catch (ObjectDisposedException)` around the cancel call. Shutdown is now silent and clean.

Files: `Scripts/Server/MudServer.cs`.

---

## Files Changed (cumulative, all v0.60.x patches between v0.60.0 and v0.60.2)

### New Files
- `Scripts/Systems/PermadeathHelper.cs` -- consolidated online-mode death/permadeath logic
- `scripts-server/nuke-server.sh` -- admin wipe script (predates v0.60.2 but shipped in this window)

### Modified Files
- `Scripts/Core/Character.cs` -- `IsArrestCombat` flag, EquipItem slot-type validation
- `Scripts/Core/Monster.cs` -- new `TauntStickChance` field for soft-taunt design
- `Scripts/Core/GameConfig.cs` -- version bump to 0.60.2, new `SoftTauntStickChance` constant
- `Scripts/Core/GameEngine.cs` -- `HandleDeath` IsIntentionalExit short-circuit, PermadeathHelper routing, CreateNewGame clears erasure marks and re-enables disconnect-save
- `Scripts/Systems/CombatEngine.cs` -- `HandlePlayerDeath` rewrite for online auto-revive, IsArrestCombat short-circuit, `HandleExcessiveDeathsPermadeath` delegates to PermadeathHelper, `TryTeammatePickupItem` cross-type slot defense, `ProcessMonsterAction` taunt-decrement-before-branch fix, `SelectMonsterTarget` per-round soft-taunt roll, soft-taunt application at all AoE class-ability sites (`aoe_taunt` / `undertow` / `abyssal_anchor` / `ApplyTankTauntAndBuff` in both single-monster and multi-monster paths), explicit hard-taunt resets at basic-[T] and Eternal Vigil sites
- `Scripts/Systems/LocationManager.cs` -- `HandlePlayerDeath` IsIntentionalExit short-circuit + PermadeathHelper routing
- `Scripts/Systems/SqlSaveBackend.cs` -- `MarkUsernameErased`, `ClearErasedMark`, `RageEventErasedUsernames` blacklist consulted in `WriteGameData`
- `Scripts/Server/PlayerSession.cs` -- `SuppressDisconnectSave` flag respected in disconnect cleanup
- `Scripts/Server/SessionContext.cs` -- `IsRageKilled`, `IsIntentionalExit` flags
- `Scripts/Server/MudServer.cs` -- shutdown signal handling
- `Scripts/Server/MudChatSystem.cs` -- `/restore` player-side disabled, guild commands use `FindSessionByNameOrUsername`
- `Scripts/Server/WizardCommandSystem.cs` -- `/pardon` command, `/restore` repurposed for archive-restore, multi-word target resolver, ESC byte fixes in notifications
- `Scripts/Locations/BaseLocation.cs` -- `ApplyMurderConsequences` IsArrestCombat wrap with try/finally cleanup, `LocationExitException(Prison)` for navigation, `AttackNPC` failed-murder consequences removed, "contact an admin" message
- `Scripts/Locations/PrisonLocation.cs` -- defensive null guards on Vex sub-fields, try/catch around `[V]` dispatcher, color resets in `ShowPrisonMenuFull`
- `Scripts/Locations/MainStreetLocation.cs` -- "contact an admin" instead of "contact a sysop"
- `Localization/{en,es,fr,hu,it}.json` -- level-change message format fix, LowLevelJavaCoder credit