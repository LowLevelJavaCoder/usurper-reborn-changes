# Audio asset directory

The Electron client's `audio.js` resolves emitted soundIds to files under this directory. **The directory is intentionally empty in v1** — the audio infrastructure is wired but no assets ship. As assets are produced, drop them here and they become audible automatically (no code changes).

## Path convention

`soundId` from `ElectronBridge.EmitSound("sfx.combat.hit")` resolves to `assets/audio/sfx/combat-hit.ogg`:

- Channel = first dotted segment (`sfx` / `music` / `ui`)
- Filename = remaining segments joined with `-`, lowercase

## SoundIds emitted today

### sfx (combat / lifecycle)

| soundId | Triggered by |
|---|---|
| `sfx.level_up` | Normal level-up |
| `sfx.level_up_milestone` | Every 5th level (and L1-3) |
| `sfx.death` | Player death (resurrection offered) |
| `sfx.death_permadeath` | Nightmare-mode permadeath |
| `sfx.boss.phase_transition` | Old God boss enters phase 2/3 |
| `sfx.achievement.bronze` | Bronze tier achievement unlock |
| `sfx.achievement.silver` | Silver |
| `sfx.achievement.gold` | Gold |
| `sfx.achievement.platinum` | Platinum |
| `sfx.achievement.diamond` | Diamond |

### music (location ambient loops — long-running, looped)

None wired today; `EmitSound("music.location.inn")` etc. is reserved for future location-based ambient.

### ui (menu / settings / toast)

None wired today; reserved for menu hover/click chrome.

## Format

- `.ogg` Vorbis preferred (broad browser/Electron support, smaller than mp3)
- 44.1 kHz, stereo
- ~75% of full volume (audio.js applies channel + volume scaling)
- Keep SFX < 2 seconds, music loops 30-90 seconds with seamless edges

## Generating

Use any audio tool. Suggested workflow:

1. Generate / record / source the raw audio
2. Normalize peak to -3 dBFS
3. Export as Vorbis `.ogg`
4. Save to `assets/audio/<channel>/<filename>.ogg` per the path convention above
5. Test: launch Electron client, trigger the corresponding event in-game

## How to verify a sound triggers without playing through

Open Electron DevTools (Ctrl+Shift+I), then in the console:

```js
window.audio.playSound('sfx.level_up')
```

If the buffer loaded correctly you'll hear the sound. If silent, check:
- File exists at the resolved path
- File is valid Vorbis `.ogg`
- AudioContext is unlocked (any prior keypress / mouseclick in the window)
- Channel volume isn't 0 (`window.audio.getVolume('sfx')`)
