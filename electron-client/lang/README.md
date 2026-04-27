# JS-side translation files

These JSON files override the English baseline embedded in `src/i18n.js`. They cover only the strings that the Electron client renders directly — overlay banners, button labels, panel titles, fallback text. Game content (location names, NPC dialogue, quest titles, ability names, etc.) is localized server-side via the C# `Loc.Get()` pipeline and arrives in emit payloads pre-translated.

## Translation status

- `en` — embedded in `src/i18n.js` (no JSON file needed)
- `es` — TODO
- `fr` — TODO
- `hu` — TODO
- `it` — TODO

## How to add translations

1. Copy `_template.json` to `<lang_code>.json`
2. Translate each value (keep `{0}`, `{1}`, … placeholders in the same order)
3. Test by changing language in Settings (`/settings lang es`); the JS overlays should switch live without restart

## What's NOT here

- Story dialogue, NPC names, location descriptions — those use Localization/<lang>.json server-side
- Combat messages, level-up stat icons (emoji), reward type names — server-side
- Anything inside an emit payload's `text` / `description` / `body` field
