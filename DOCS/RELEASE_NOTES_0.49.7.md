# Usurper Reborn v0.49.7 — Win7 TLS Bridge & Fixes

*Even the old guard gets the news.*

---

## Win7 Version Check Fallback

BBS SysOps running Windows 7 (which can't negotiate TLS 1.2) were unable to use the auto-update checker — the HTTPS call to GitHub's API failed with an SSL error. The game now falls back to a plain HTTP proxy hosted on the game server when the direct GitHub check fails. The server fetches the release info on the client's behalf and caches it for 5 minutes.

This is transparent — the update checker tries GitHub first, and only falls back if TLS fails. Modern systems are unaffected.

---

## Bug Fixes

- **Steam Build False Detection on BBS** — SysOps running on Windows with a stray `steam_appid.txt` or Steam API DLLs in the game directory saw "This is a Steam build. Updates are handled automatically by Steam." even though they were running in BBS door mode. The Steam build check now returns false immediately when running in BBS door mode

---

## Files Changed

- `Scripts/Core/GameConfig.cs` — Version 0.49.7
- `Scripts/Systems/VersionChecker.cs` — `FallbackApiUrl` constant (`http://usurper-reborn.net/api/releases/latest`); TLS failure catch with plain HTTP retry; BBS door mode bypasses Steam build detection
- `web/ssh-proxy.js` — `/api/releases/latest` endpoint proxying GitHub releases API with 5-minute cache; static file serving for Docker support
- `scripts-server/fix-nginx-http-releases.py` — Nginx config patcher for plain HTTP exception on `/api/releases/latest`
