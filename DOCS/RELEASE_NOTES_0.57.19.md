# v0.57.19 - Save File Repair (Hotfix)

Hotfix for v0.57.18. The serialization-time bloat caps shipped in v0.57.18 stop saves from growing further but only fire on the *next save*. Players whose entire backup chain (primary + `_backup.json` + 3 autosaves + emergency dump) was ALL bloated had no path forward — every load attempt OOMed, so they could never trigger a re-save to apply the new caps. v0.57.19 adds an automatic in-place repair that uses `JsonDocument` (memory cost ~2-3x file size) instead of `JsonSerializer.Deserialize<T>` (memory cost ~10x+ file size) to read the bloated file, clip the known-bloated arrays directly in the JSON, and write back via the same atomic temp+flush+rename pattern the normal save path uses.

## Bloated Save Files Repair Tool

All five recovery files for a player were bloated to ~71 MB. v0.57.18 listed them correctly and routed to the recovery menu correctly, but every load attempt died on `JsonSerializer.Deserialize<SaveGameData>` because the materialized C# object graph from a 71 MB JSON file is several hundred MB to a GB of working set — well past .NET's per-allocation limits even on x64.

## Root Cause

`JsonSerializer.Deserialize<T>` allocates the full typed object graph in memory: 130+ NPCs × bloated `memories` / `recentDialogueIds` / `relationships` / `enemies` / `knownCharacters` lists × per-list element overhead (each `MemoryData` is ~200 bytes once strings, timestamps, and references are accounted for; each `Relationship` dict entry is ~50 bytes; etc.). For a 71 MB JSON file that's 700 MB - 1+ GB of object graph. .NET 8's `JsonReaderState` and array pool reservations push peak working set higher. OOM is hit before deserialization completes.

`JsonDocument.Parse(byte[])`, by contrast, holds the raw JSON tree in a more compact representation (~2-3x file size — ~200 MB for a 71 MB file). Random access to nodes works without materializing typed objects. We use this to walk the bloated JSON, copy it to a `Utf8JsonWriter` (streaming output, bounded memory), and trim the known-bloated arrays as we pass them.

## What's New

### Automatic Repair Path

When the load fails with an OOM-class error (matched on the existing error strings: "Not enough memory", "too large", "more data than"), the recovery menu now offers a new **`[R] Auto-repair the bloated save file (recommended)`** option in addition to the existing recovery-file picker. The repair flow:

1. Walks the same candidate list as the normal recovery menu — primary, `<name>_backup.json`, the 3 most recent `<name>_autosave_*.json`, all `emergency_<name>_*.json` files for this character, plus the legacy `emergency_autosave.json` fallback.
2. For each candidate, runs `SaveFileRepair.RepairInPlace(path, writeOptions)`. This reads the file via `File.ReadAllBytes` → `JsonDocument.Parse` → walks the tree via `Utf8JsonWriter` to a `<file>.repair.tmp` → atomic `File.Move(overwrite: true)` to the original path. Trim selection is **last-N** for arrays (works for "most recent" cases without needing typed sort logic) and **first-N** for object-as-dict (matches `MaxSerializedRelationshipsPerNpc` style).
3. After a successful repair, copies the repaired file to the primary slot (if it wasn't already) and runs the normal load path. If load succeeds, the player is back in their character. If load still fails (some non-bloat issue like genuine JSON corruption in a non-bloat field), tries the next candidate.
4. If all candidates fail, surfaces a clear "report this with your save folder" message instead of silently looping.

### Trim Targets (Match v0.57.18 Caps)

Hard-coded path-to-cap map in `SaveFileRepair.cs`. Caps mirror the serialization-time caps in `SaveSystem.cs` / `RomanceTracker.cs` / `CompanionSystem.cs` / `StrangerEncounterSystem.cs` / `VisualNovelDialogueSystem.cs` / `EnhancedNPCBehaviors.cs` / `MemorySystem.MAX_MEMORIES`:

| JSON path | Cap | Source |
|---|---|---|
| `.npcs[*].memories` | 30 | `MemorySystem.MAX_MEMORIES` |
| `.npcs[*].recentDialogueIds` | 50 | `MaxSerializedDialogueIdsPerNpc` |
| `.npcs[*].knownCharacters` | 80 | `MaxSerializedKnownCharactersPerNpc` |
| `.npcs[*].enemies` | 30 | `MaxSerializedEnemiesPerNpc` |
| `.npcs[*].inventory` | 30 | `MaxSerializedCompanionInventory` |
| `.npcs[*].marketInventory` | 50 | (new bound for repair only) |
| `.npcs[*].relationships` (dict) | 100 | `MaxSerializedRelationshipsPerNpc` |
| `.royalCourt.prisoners` | 50 | `MaxSerializedRoyalCourtPrisoners` |
| `.royalCourt.orphans` | 100 | `MaxSerializedRoyalCourtOrphans` |
| `.royalCourt.monarchHistory` | 30 | `MaxSerializedMonarchHistory` |
| `.royalCourt.courtMembers` | 50 | `MaxSerializedCourtMembers` |
| `.royalCourt.heirs` | 20 | `MaxSerializedHeirs` |
| `.royalCourt.monsterGuards` | 30 | `MaxSerializedMonsterGuards` |
| `.player.romanceData.encounterHistory` | 100 | `MaxSerializedEncounterHistory` |
| `.player.romanceData.conversationStates` | 100 | `MaxSerializedConversationStates` |
| `.player.romanceData.conversationStates[*].topicsDiscussed` | 30 | `MaxSerializedTopicsDiscussedPerConvo` |
| `.companions[*].inventory` | 30 | `MaxSerializedCompanionInventory` |
| `.strangerEncounters.usedDialogueIds` | 50 | `MaxSerializedStrangerDialogueIds` |
| `.strangerEncounters.recentGameEvents` | 20 | `MaxSerializedStrangerRecentEvents` |
| `.affairs` | 50 | `MaxSerializedAffairs` |

The repair uses **last-N** truncation uniformly for arrays. The serialization-time caps in v0.57.18 use proper sort strategies (Influence desc, Importance desc, |strength| desc) but those require typed C# objects. Last-N is acceptable for emergency repair because the player is already losing data either way — the goal is recovering the file, and subsequent normal saves will apply the proper sorts.

### Trade-off: Self-Healing Without Typed Sorts

The repair discards data that proper-sort would have kept. Example: an NPC with 200 memories of varying importance would be sorted by Importance desc on a normal save and the top 30 kept. The repair just keeps the last 30 (chronologically). The character isn't lost, but some memorable history is. This is documented in the user-facing repair menu text so players know what they're choosing.

The alternative — refusing to repair and asking the user to manually edit a 71 MB JSON file — is strictly worse.

### Memory Budget for the Repair Itself

`File.ReadAllBytes` on a 71 MB file: ~71 MB allocated as `byte[]`.
`JsonDocument.Parse(byte[])`: ~150-200 MB additional.
`Utf8JsonWriter` + `FileStream` output buffer: ~10 KB.
Peak working set: ~250-300 MB for the worst observed case.

This fits comfortably in any modern desktop process. The byte array reference is released before the atomic rename so it can be GC'd if the rename or following operations fail and we need to retry.

## SAVE_REPAIR Telemetry

New `SAVE_REPAIR` debug log category (writes to `logs/debug.log` only — no external transmission):
- Beginning of repair: file path + original size
- Repair complete: original size → new size + count of fields trimmed
- Per-field trim summary on the repair result for the user-facing menu
- Repair failures with exception type + stack trace

Same pattern as `SAVE_AUDIT`/`GOLD_AUDIT` from earlier versions.

## Tests

12 new tests in `Tests/SaveFileRepairTests.cs`:
- Non-existent file returns failure (no throw)
- Empty JSON object preserved
- NPC memories array over cap trimmed to 30, last-N selection verified
- RoyalCourt prisoners trimmed to cap
- Romance encounter history trimmed to cap
- Stranger dialogue IDs trimmed to cap
- NPC relationships **dictionary** trimmed (object-as-dict path)
- Affairs top-level array trimmed
- Nested topicsDiscussed-per-conversation trimmed correctly even when parent array is small
- Non-bloated file passes through with zero modifications
- Primitive fields (string, long, bool, null) preserved
- Output is always valid JSON (parseable round-trip)

All 653 tests green (12 new + 641 existing).

## Files Changed

- `Scripts/Core/GameConfig.cs` — version bump 0.57.18 → 0.57.19. No new constants (repair reuses the existing v0.57.18 caps).
- `Scripts/Systems/SaveFileRepair.cs` — **NEW**. `RepairInPlace(path, writeOptions)` static method + `RepairResult` record. Recursive `WriteTrimmedElement` walks the JsonDocument and writes via Utf8JsonWriter, applying caps from a hard-coded path map. ArrayCaps and DictCaps dictionaries name every trim target. Includes `SAVE_REPAIR` debug logging.
- `Scripts/Core/GameEngine.cs` — `ShowLoadFailureWithRecovery` detects OOM-class errors (string match on "Not enough memory" / "too large" / "more data than") and conditionally shows `[R] Auto-repair the bloated save file (recommended)` option. New `RunSaveRepair(fileName, originalError)` private method walks the candidate list, runs repair on each, copies the first successful one to primary, and re-runs the load pipeline.
- `Tests/SaveFileRepairTests.cs` — **NEW**. 12 unit tests covering the JSON-to-JSON repair logic without needing a full SaveGameData object graph.

## Deploy Notes

Game binary only. No save format change. The repair only fires when the player explicitly chooses [R] from the load failure menu — no automatic mutation of any save file. Repaired files use the same atomic temp+rename write pattern as normal saves, so a crash during repair leaves the original intact.

For affected players from v0.57.18: launch v0.57.19, click your character in the load menu, the recovery menu appears with the new [R] Auto-repair option, press R, watch the repair walk your candidate files until one loads, and your character is back. The next normal save runs with the v0.57.18 caps and the file stays at a sane size going forward.
