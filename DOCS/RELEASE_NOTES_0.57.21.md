# v0.57.21 - GMCP (Generic MUD Communication Protocol) Support

Adds GMCP out-of-band event support to the MUD server so Mudlet, MUSHclient, TinTin++, and other modern MUD clients can render player vitals, status, room info, and chat messages in dedicated UI panes (gauges, status bars, split windows, chat capture) instead of dumping everything into the scroll buffer.

Player request from a TinTin++ user pointed out that the split-screen status pane in TT++ has nothing to feed it without GMCP — the client sees only one stream of ANSI text and can't separate narrative output from status updates. With this version, those split panes work.

## What Players Get

If you connect to the MUD with a GMCP-capable client:

- **Char.Vitals** — live HP / MaxHP / MP / MaxMP / SP delta-pushed every prompt cycle. Mudlet renders this as a graphical health bar; TT++ scripts can wire it to a status pane; MUSHclient has a built-in mapper.
- **Char.Status** — name, class, level, race, gold, bank, xp, location. Pushed on every location change.
- **Room.Info** — room number + name on every location change. Future iterations will add the exit list (current shape just emits placeholder).
- **Comm.Channel.Text** — every `/gossip`, `/shout`, `/tell`, and `/gc` message goes out as a structured `{channel, talker, text}` payload to recipients. Chat capture scripts work without text-pattern triggers.

GMCP is a strict opt-in via telnet negotiation. SSH-relayed sessions, web terminal users, BBS terminals, and the local Electron client never see a single GMCP byte — they get the same plain-ANSI experience they always have.

## Wire Format

Standard GMCP framing per the [official spec](https://www.ironrealms.com/gmcp-doc):

```
IAC (0xFF) SB (0xFA) GMCP (0xC9) "Package.Message" SP "{json}" IAC (0xFF) SE (0xF0)
```

Two implementation details that matter:

1. **0xFF doubling inside SB.** Per RFC 854, any 0xFF byte inside an SB block must be sent as `0xFF 0xFF` so the SE terminator (`0xFF 0xF0`) is unambiguous. UTF-8-encoded JSON never produces a single 0xFF for any valid Unicode codepoint, but `GmcpBridge.EscapeIacBytes` handles it defensively for caller-controlled package name strings.
2. **camelCase JSON.** Conventional GMCP servers (Achaea, all Iron Realms muds) use camelCase property names. `GmcpBridge` configures `JsonNamingPolicy.CamelCase` so off-the-shelf Mudlet scripts and existing Achaea-compatible clients work without remapping.

## Negotiation Flow

1. Client connects to port 4000 (or sslh-multiplexed equivalent).
2. After the 500ms AUTH-header timeout (which distinguishes raw MUD clients from SSH-proxied AUTH connections), the server sends `IAC WILL ECHO`, `IAC WILL SGA`, and `IAC WILL GMCP` in a single packet.
3. Inside `ProbeTtypeAsync`, the server reads incoming IAC sequences for ~250ms looking for both the TTYPE response AND any `IAC DO GMCP` / `IAC DONT GMCP` reply.
4. If `IAC DO GMCP` arrives, the session is marked `GmcpEnabled = true` on `SessionContext`. `IAC DONT GMCP` (or no response) leaves it false.
5. From that point on, `GmcpBridge.Emit("Package.Name", payload)` checks `SessionContext.Current.GmcpEnabled` and writes IAC-framed bytes to the session's `OutputStream`. Non-GMCP sessions get no frames.

The negotiation is bundled into the existing TTYPE probe to avoid a second 250ms round-trip — both responses race in the same window.

## Packages Shipped in v0.57.21

| Package | Trigger | Payload Shape |
|---|---|---|
| `Char.Vitals` | Top of `BaseLocation.LocationLoop` (every prompt cycle) when any tracked stat changed | `{ hp, maxHp, mp, maxMp, sp }` |
| `Char.Status` | `LocationManager.EnterLocation` (every location change) | `{ name, class, level, race, gold, bank, xp, location }` |
| `Room.Info` | `LocationManager.EnterLocation` (every location change) | `{ num, name, area, exits }` |
| `Comm.Channel.Text` | `MudChatSystem.HandleGossip` / `HandleShout` / `HandleTell` / `HandleGuildChat` | `{ channel, talker, text }` |

Selection rationale: these are the four packages every Mudlet/MUSHclient/TT++ user actually scripts against on day one. Combat events, inventory deltas, character skills, and room exits are deferred to v0.58 once we see what the real userbase wants.

## What's Not Shipped (Yet)

- **Char.Items.* (inventory deltas)** — would need hooks at every InventorySystem mutation site. Iterative.
- **Char.Skills.* (skill list / proficiency changes)** — needs hooks in TrainingSystem.
- **Combat events** — full GMCP combat protocol is non-trivial. Defer to v0.58.x.
- **Char.MaxStats / Char.BaseStats** — players rarely script against these vs. Vitals.
- **Room.Exits enum** — Room.Info ships with empty `exits` placeholder for now. Each location implementation would need to expose its exit list, which is more refactoring than a hotfix-class change warrants.
- **Server-supported package list (`Core.Supports.Set`)** — clients can negotiate which packages they want; we currently emit unconditionally to GMCP-enabled sessions. v0.58 should respect the supports list so we don't waste bandwidth on packages clients ignore.

## Files Changed

- `Scripts/Core/GameConfig.cs` — version bump 0.57.20 → 0.57.21.
- `Scripts/Server/SessionContext.cs` — new `GmcpEnabled` property. Set during PlayerSession init from the negotiation result.
- `Scripts/Server/MudServer.cs` — three changes:
  - Initial negotiation byte string extended from 6 bytes to 9 (added `IAC WILL GMCP` = `0xFF 0xFB 0xC9`).
  - `ProbeTtypeAsync` return type extended to include `gmcpEnabled` flag; loop body recognizes `IAC DO GMCP` (option 0xC9 with WILL-side cmd 0xFD) and sets the flag. Probe no longer breaks on TTYPE arrival to give GMCP DO/DONT a chance to also arrive in the same window.
  - `gmcpEnabled` declared at outer scope and passed through to `new PlayerSession(..., gmcpEnabled: gmcpEnabled, ...)`.
- `Scripts/Server/PlayerSession.cs` — constructor accepts `gmcpEnabled` parameter, stores it in `_gmcpEnabled`, copies to `ctx.GmcpEnabled` in `RunAsync`.
- `Scripts/Server/GmcpBridge.cs` — **NEW**. Static class with `Emit(package, payload)` for current-session emit and `EmitTo(session, package, payload)` for cross-session fan-out (chat). `BuildFrame` and `EscapeIacBytes` are `internal` for unit testing. Uses `JsonNamingPolicy.CamelCase` and `WriteIndented = false` for Achaea-compatible payload format. Synchronous `Stream.Write` under a per-stream lock so frames can't interleave with concurrent text output.
- `Scripts/Systems/LocationManager.cs` — `EnterLocation` emits `Room.Info` and `Char.Status` after the room registry update.
- `Scripts/Locations/BaseLocation.cs` — new `EmitGmcpVitals` private method with 5-field delta tracking (`_lastGmcpHp`, `_lastGmcpMaxHp`, `_lastGmcpMana`, `_lastGmcpMaxMana`, `_lastGmcpStamina`). Called at the top of every `LocationLoop` while-iteration. Per-instance fields reset implicitly on location change since each location object has its own loop.
- `Scripts/Server/MudChatSystem.cs` — `HandleGossip`, `HandleShout`, `HandleGuildChat` extended with `Comm.Channel.Text` fan-out via new `FanoutChannelText` helper. `HandleTell` does single-target `EmitTo` to the recipient. All four respect existing `MutedChannels` filtering — muted recipients get no GMCP frame.
- `Tests/GmcpBridgeTests.cs` — **NEW**. 8 unit tests covering: null payload (no body), simple payload framing, 0xFF doubling, ASCII-only fast path (no escaping), empty package name edge case, camelCase JSON output, compact (non-indented) JSON, and stress test with long package + 500-char payload (no premature IAC SE in the body).

## Tests

8 new GMCP tests + 0 changes to existing tests. Full suite: 661/661 green (8 new + 653 from v0.57.20).

## Deploy Notes

Game binary only. No save format change, no SQL schema change. Non-MUD clients (web, SSH, BBS, Electron, single-player) are entirely unaffected — the only code path they exercise is the constant-time `bool` check in `GmcpBridge.IsActive` and `GmcpBridge.Emit`'s early return.

For testing post-deploy:
- Mudlet: connect to `play.usurper-reborn.net:4000`, open Settings → Mapper → check that `Char.Vitals` shows up in the GMCP debug output. Build a status pane wired to `gmcp.Char.Vitals.hp` / `.maxHp`.
- TinTin++: `#config GMCP ON`, `#config DEBUG TELNET 5` to see incoming GMCP frames, then `#split` to enable a status pane fed by `#gmcp` event handlers.
- MUSHclient: enable Plugins → GMCP, drop in any Achaea-compatible vitals plugin.

If your MUD client doesn't support GMCP, behavior is identical to v0.57.20 — the `IAC WILL GMCP` is silently rejected and no frames are sent.
