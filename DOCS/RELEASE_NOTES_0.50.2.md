# Usurper Reborn v0.50.2 — Grief Visibility & Stat Display

Quality-of-life improvements for grief system feedback and companion/NPC stat displays.

## Improvements

### Grief System Visibility
The grief system now communicates its effects clearly to the player at every stage:
- **On death**: When a companion or NPC teammate dies, a message immediately tells the player they have entered grief and that combat will be affected.
- **At combat start**: A grief reminder displays at the beginning of every fight while grieving (e.g., "The weight of sorrow crushes your spirit.").
- **During combat**: Existing per-hit messages continue to show ("Rage fuels your strikes" or "Grief weighs on your arm").
- **In /health**: The grief section now shows numerical combat effects (e.g., "Combat Effects: Damage +30%, Defense -20%") and the stage description.

### Full Stat Display for Companions
The companion detail screen at the Inn now shows all stats (STR, DEX, AGI, CON, INT, WIS, CHA, STA) with gear bonuses included, instead of just base HP/ATK/DEF with parenthesized equipment bonuses.

### Full Stat Display for NPC Team Members
The equipment management screens for NPC team members (Inn, Team Corner, Home) now show full stats (STR, DEX, AGI, CON, INT, WIS, CHA, DEF) instead of just Str/Def/Agi. All values include equipped gear bonuses.

## Bug Fixes

### Settlement Deserialization on Legacy Saves
BBS sysops upgrading from v0.49.5 or earlier hit a JSON deserialization error because `ProposalCooldowns` changed from `List<string>` to `Dictionary<string, int>` in v0.49.9. The field now uses `JsonElement?` to accept both formats gracefully. Also added `AllowReadingFromString` to the online state manager JSON options to handle numeric string coercion.

## Files Changed
- `Scripts/Core/GameConfig.cs` — Version 0.50.2
- `Scripts/Locations/MainStreetLocation.cs` — `/health` grief section shows numerical combat effects and stage description
- `Scripts/Systems/CombatEngine.cs` — Grief status reminder at start of single and multi-monster combat; grief onset message after NPC teammate death
- `Scripts/Systems/CompanionSystem.cs` — Grief onset message after companion death
- `Scripts/Locations/InnLocation.cs` — Companion detail screen shows full effective stats with all attributes; NPC equipment screen shows full stats
- `Scripts/Locations/TeamCornerLocation.cs` — NPC equipment screen shows full stats
- `Scripts/Locations/HomeLocation.cs` — NPC equipment screen shows full stats
- `Scripts/Systems/SettlementSystem.cs` — `ProposalCooldowns` uses `JsonElement?` to handle both legacy `List<string>` and current `Dictionary<string, int>` formats
- `Scripts/Systems/OnlineStateManager.cs` — Added `AllowReadingFromString` to JSON number handling
