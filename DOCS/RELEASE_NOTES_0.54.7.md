# v0.54.7 - BBS Native Winsock I/O

## BBS Socket Relaunch Fix (Final)

Long-standing bug affecting EleBBS and Mystic BBS: after exiting the game, players could not relaunch the door without disconnecting from the BBS entirely. Multiple fix attempts in v0.54.4-v0.54.6 failed because the root cause was deeper than handle management.

**Root cause:** .NET's `Socket` class, `NetworkStream`, `FileStream`, and their finalizers all modify the inherited socket handle state in ways that corrupt the connection for subsequent door launches. Even with `ownsHandle: false`, `GC.SuppressFinalize`, and native `ExitProcess`, the .NET runtime's internal Winsock infrastructure interfered with the socket. Traditional C/C++ door programs don't have this problem because they use raw Winsock API calls directly.

**Fix:** Complete bypass of all .NET socket/stream wrappers for BBS door mode. The game now uses raw Winsock2 P/Invoke calls (`send()`, `recv()`, `WSAStartup()`) on the inherited socket handle, matching how traditional C door programs work:

- **`WSAStartup(2.2)`** initializes Winsock before any socket operations
- **`send()`** replaces `NetworkStream.WriteAsync` for all output (text, ANSI color codes, cursor control)
- **`recv()`** replaces `StreamReader.ReadAsync` for all input
- **`MSG_PEEK`** used to drain buffered `\r\n` bytes between input calls (telnet line mode sends `r\r\n` for a single keypress)
- **`WSAEWOULDBLOCK` (10035)** handled correctly — the socket is in non-blocking mode, so "no data yet" is retried with 50ms delay instead of being treated as a disconnect
- **No .NET Socket, NetworkStream, FileStream, or StreamWriter objects created** — nothing for finalizers to corrupt
- **ANSI emulation forced** for native I/O path (DOOR32.SYS emulation field may be wrong if BBS terminal detection timed out)

**Input handling for telnet line mode:**
- Single-key input (`GetKeyInputAsync`): reads one printable character, skips all `\r`/`\n`/IAC control bytes
- Line input (`GetInputAsync`): reads until `\r` or `\n`, echoes characters back to client, handles backspace
- `DrainNativeInputBuffer()`: called at the start of every input method using `MSG_PEEK` to flush leftover control bytes from previous input

**Tested on:** Mystic BBS 1.12 A48 (Windows, telnet, D3 door type). First launch, quit, second launch, quit, third launch — all work without disconnecting from the BBS.

## Screen Reader / Language Settings Bleeding Between Players

Screen reader mode and language preferences were being set on the global `GameConfig` fallback during authentication — before `SessionContext` (per-session AsyncLocal) was created. Once any screen reader user logged in, the global was set to `true` and never reset, causing all subsequent sessions to inherit screen reader mode.

- **Preferences now loaded after SessionContext is created** — `PlayerSession.RunAsync()` reads `screen_reader` and `language` directly from the `players` table via a new `GetAccountPreferences()` query, then sets them on the per-session AsyncLocal. No globals touched.
- **Removed all global-level preference setting from auth paths** — MudServer trusted auth, interactive auth, and OnlineAuthScreen no longer set `GameConfig.ScreenReaderMode` or `GameConfig.Language` during authentication

## Old God Divine Armor Enchantment Detection Fix

Old God divine armor (Aurelion's Divine Shield, Terravok's Stone Skin, Manwe's Creator's Ward) warned players their weapon was "unenchanted" even when it had Magic Shop enchantments like Phoenix Fire or Frostbite. The check only looked at an `[E:N]` description tag that was never actually written by the enchanting system. Also only checked the main hand, ignoring off-hand enchantments.

- **Now checks all 6 elemental enchant flags** (HasFireEnchant, HasFrostEnchant, HasLightningEnchant, HasPoisonEnchant, HasHolyEnchant, HasShadowEnchant) — set by both Magic Shop enchantments and loot drops
- **Checks both main hand and off-hand** — either weapon having an enchantment triggers the partial bypass
- **Artifact weapon check also covers both hands**

## Lyris Assassin Abilities Fix

The v0.54.6 Lyris stats fix changed her `CombatRole` from `Hybrid` to `Damage` to give her Ranger-appropriate stat gains. But the character wrapper maps `CombatRole.Damage` to `CharacterClass.Assassin`, so Lyris was getting Assassin abilities (Backstab, Execute) instead of Ranger abilities (Precise Shot, Hunter's Mark). Now special-cased: Lyris always maps to `CharacterClass.Ranger` regardless of her CombatRole. Fixed in both the combat wrapper (CompanionSystem) and Inn wrapper (InnLocation).

## Session XP Diminishing Returns Removed

The session XP throttle (introduced in v0.54.0) reduced XP earned after a threshold, reaching a 25% floor. At high levels, players hit the floor within 10-15 minutes of play. Multiple tuning attempts (2x to 4x to 8x threshold, 0.2% to 0.05% decay rate) couldn't find a sweet spot. Removed entirely — players now earn full XP regardless of session length.

## Companion Ability Description Truncation Fix

Companion ability descriptions in the Inn ability toggle menu were truncated to 30 characters with "..." — losing important information. Screen reader users got the same truncation despite not needing column-width limits. Now: screen reader mode shows the full description on one line, visual mode wraps the overflow to a second indented line.

## Healer Antidote Menu Fix

`[N] Buy Antidotes` was missing from the visual and standard game menus at the Healer — it was only in the BBS compact menu. Added to both the visual menu (row 2 with Poison Cure, Disease Cure, Decurse) and BBS compact menu.

---

### Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.54.7
- `Scripts/BBS/SocketTerminal.cs` — Added Winsock2 P/Invoke (`send`, `recv`, `WSAStartup`, `WSACleanup`); `_usingNativeIO` flag; native I/O paths in `WriteAsync`, `WriteRawAsync`, `GetInputAsync`, `GetKeyInputAsync`; `DrainNativeInputBuffer()` with `MSG_PEEK`; force ANSI emulation for native path; `WSAEWOULDBLOCK` retry loop; skip telnet negotiation in door mode
- `Scripts/BBS/DoorMode.cs` — Socket init failure falls back to stdio with CP437 encoding; enhanced disconnect logging with stack trace
- `Scripts/Systems/OldGodBossSystem.cs` — Divine armor enchantment check: both hands, all 6 enchant flags, artifact check on both hands
- `Scripts/Systems/CompanionSystem.cs` — Lyris class mapping special-cased to Ranger (was Assassin due to CombatRole.Damage mapping)
- `Scripts/Locations/InnLocation.cs` — Same Lyris class mapping fix in Inn character wrapper
- `Scripts/Systems/SqlSaveBackend.cs` — New `GetAccountPreferences()` method reads screen_reader and language from players table
- `Scripts/Server/PlayerSession.cs` — Loads account preferences from DB after SessionContext is created (per-session AsyncLocal)
- `Scripts/Server/MudServer.cs` — Removed global GameConfig.ScreenReaderMode/Language setting from both auth paths
- `Scripts/Systems/OnlineAuthScreen.cs` — Removed global preference setting from auth
- `Scripts/Core/GameConfig.cs` — Session XP diminishing returns constants retained but unused; threshold/rate comments updated
- `Scripts/Systems/CombatEngine.cs` — Removed ApplySessionXPDiminishing calls from all 3 combat victory paths (single, multi, group); removed group combat diminishing message display
- `Scripts/Locations/InnLocation.cs` — Companion ability description: full text for SR, wrapped overflow for visual; Lyris class mapping fix
- `Scripts/Locations/HealerLocation.cs` — Added [N] Buy Antidotes to visual menu row 2 and BBS compact menu
- `Localization/*.json` — Added healer.menu_antidotes_suffix to all 5 languages
- `Console/Bootstrap/Program.cs` — Added `NativeExitProcess` P/Invoke (Win32 `ExitProcess`) to bypass .NET finalizer execution on process exit
