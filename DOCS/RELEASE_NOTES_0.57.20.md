# v0.57.20 - Save Repair Visibility (Hotfix for v0.57.19)

Hotfix for v0.57.19. The `[R] Auto-repair` option introduced in v0.57.19 wasn't appearing for one of the exact players it was meant to help — multiple recovery-menu entry paths emit error strings that don't contain the OOM keywords `ShowLoadFailureWithRecovery`'s detector was matching on, so the option silently stayed hidden.

## Player Report That Drove This

Player launched v0.57.19, picked their character (tagged `[RECOVERY]` from the listing), got routed to the recovery menu, picked the `Backup` recovery file. The backup load failed with `Not enough memory to parse save file (67 MB at ... Lin_backup.json). The save contains more data than the process can hold.` — the recovery menu re-rendered and still showed only `[1-5] / [N] / [Q]` with no `[R] Auto-repair` option. The repair pass was implemented and shipped but the player never had a way to invoke it.

## Three Bugs in the Detection Logic

**1. `[RECOVERY]`-tagged short-circuit message had no OOM keywords.** When the listing pre-detects a slot as unparseable, [GameEngine.cs:2347](Scripts/Core/GameEngine.cs#L2347) short-circuits straight to `ShowLoadFailureWithRecovery` with a synthetic reason string: *"Save file failed to parse during listing — likely bloated or truncated. Recovery options below."* The detector at [GameEngine.cs:3015](Scripts/Core/GameEngine.cs#L3015) was looking for `"Not enough memory"` / `"too large"` / `"more data than"` — none of which match. So the most common entry path (clicking a [RECOVERY] slot) never showed [R].

**2. Recovery-file-failed re-entry passed stale error.** When a player picks a recovery file and it fails to load, [GameEngine.cs:3096](Scripts/Core/GameEngine.cs#L3096) re-enters `ShowLoadFailureWithRecovery` to let them pick another. Pre-fix, it passed the original `errorMessage` (the primary's failure reason) instead of the freshly-captured `recoveryError`. So if the primary failed for a non-OOM reason but a recovery file OOMed, the re-entered menu still showed the stale primary error and didn't trigger [R] detection on the new error.

**3. No file-size fallback.** The detector relied entirely on string matching against error messages — fragile against any error path that doesn't use the exact magic strings.

## Three Fixes (defense in depth)

**Fix 1 — short-circuit message includes detection keywords.** Updated the synthetic reason in the `IsRecovered` short-circuit to include `"too large"` and `"Not enough memory"` so the detector matches. Slots get tagged `IsRecovered` when `GetAllSaves` deserialize throws, which is almost always OOM on a bloated save, so it's correct to assume bloat in this path.

**Fix 2 — re-entry uses fresh recoveryError.** Line 3096 now passes `recoveryError ?? errorMessage` so the most recent failure information propagates. If the recovery file OOMed, [R] now appears even if the primary's original error was something else.

**Fix 3 — file-size fallback (the bulletproof signal).** New `BloatDetectionBytes = 10 MB` check runs when string matching fails. Walks the primary save path + every recovery candidate's path, calls `FileInfo.Length` on each (cheap OS-level metadata read), and sets `isBloatError = true` if any candidate exceeds the threshold. This is the catch-all — any future error path that doesn't include the magic strings still gets [R] surfaced as long as there's a bloated file on disk to repair. Also added `"bloated"` to the keyword list since that word appears naturally in several error messages.

## Files Changed

- `Scripts/Core/GameConfig.cs` — version bump 0.57.19 → 0.57.20.
- `Scripts/Core/GameEngine.cs` — three fixes:
  - `IsRecovered` short-circuit message now includes `"too large"` and `"Not enough memory"` text so the detector at `ShowLoadFailureWithRecovery` matches.
  - Recovery-file-failure re-entry now passes `recoveryError ?? errorMessage` instead of the stale original `errorMessage`.
  - `ShowLoadFailureWithRecovery` gained a file-size fallback: if string detection fails, walks primary + recovery candidates and sets `isBloatError = true` if any file exceeds 10 MB. `"bloated"` added to the keyword list.

## Tests

No test changes — the 12 `SaveFileRepairTests` from v0.57.19 still pass (the repair logic itself is unchanged; only the menu's offer-condition was fixed). Full suite: 653/653 green.

## Deploy Notes

Game binary only. No save format change. For the player from the bug report: launch v0.57.20, click the [RECOVERY]-tagged save, the menu now offers `[R] Auto-repair the bloated save file (recommended)` immediately on the first menu entry. Press R, the repair walks all candidates including the 67 MB backup, trims them down, and the load succeeds.
