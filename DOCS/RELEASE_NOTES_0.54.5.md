# v0.54.5 - BBS Socket Hotfix

## BBS Socket Handle Fix (Corrected)

v0.54.4 fixed the socket handle leak that prevented BBS players from re-entering the game after quitting, but the fix was too aggressive — it called `Socket.Shutdown(Both)` and `closesocket()` which tore down the TCP connection entirely, disconnecting the user from the BBS.

The BBS and door process share the socket via handle inheritance. The door needs to release its handle reference when exiting, but the TCP connection must stay alive for the BBS to continue serving the user.

- **`CloseHandle()` instead of `closesocket()`** — releases our handle reference without tearing down the TCP connection. The BBS keeps its own handle and the user stays connected.
- **Reverted `ownsHandle` back to `false`** — prevents `SafeSocketHandle` from calling `closesocket()` in its finalizer
- **Raw socket handle stored and closed explicitly** — the IntPtr from DOOR32.SYS is saved during socket creation and passed to `CloseHandle()` on dispose (Windows only)

---

### Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.54.5
- `Scripts/BBS/SocketTerminal.cs` — Added `CloseHandle` P/Invoke; stored raw socket handle; `Dispose()` calls `CloseHandle` instead of `Socket.Shutdown`/`Close`/`Dispose`; reverted `ownsHandle` to `false`
