// Usurper Reborn — JS-side Web Audio receiver for the Electron graphical
// client. Resolves soundIds emitted by the C# side (EmitSound) into Web Audio
// buffers and plays them through per-channel mixers (master / sfx / music / ui).
//
// Architecture:
//   AudioContext
//   ├── master gain (user-adjustable)
//   │   ├── sfx gain (combat hits, ability casts, level-up, death)
//   │   ├── music gain (location ambient loops — long-running, looped)
//   │   └── ui gain (menu clicks, settings toggles, toast pops)
//
// Asset directory layout (when audio assets land):
//   electron-client/assets/audio/sfx/{soundId}.ogg
//   electron-client/assets/audio/music/{soundId}.ogg
//   electron-client/assets/audio/ui/{soundId}.ogg
//
// In v1 the asset directory is empty — `playSound()` silently no-ops on
// missing buffers so emit-from-C# paths are safe to wire up before assets
// exist. As assets land, drop them into assets/audio/<channel>/ and they
// become audible automatically.

(function () {
  'use strict';

  let _ctx = null;
  let _channels = null;     // { master, sfx, music, ui } — GainNodes
  let _buffers = {};        // soundId → AudioBuffer
  let _activeLoops = {};    // soundId → AudioBufferSourceNode (for stop)
  let _volumes = {           // 0.0–1.0 per channel
    master: 0.7,
    sfx: 1.0,
    music: 0.6,
    ui: 0.8
  };
  let _userInteracted = false;

  // Restore volume preferences from localStorage.
  try {
    const saved = JSON.parse(localStorage.getItem('usurper.volumes') || 'null');
    if (saved && typeof saved === 'object') {
      _volumes = Object.assign(_volumes, saved);
    }
  } catch {}

  /// Lazily build the AudioContext + channel graph. Browsers (and Electron's
  /// renderer) require user interaction before audio plays — _userInteracted
  /// flips to true on the first keypress/click, then we wire up the context.
  function ensureContext() {
    if (_ctx) return _ctx;
    if (!_userInteracted) return null;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        console.warn('[audio] Web Audio API unavailable; sound disabled');
        return null;
      }
      _ctx = new Ctor();
      const master = _ctx.createGain();
      master.gain.value = _volumes.master;
      master.connect(_ctx.destination);
      const sfx = _ctx.createGain();
      sfx.gain.value = _volumes.sfx;
      sfx.connect(master);
      const music = _ctx.createGain();
      music.gain.value = _volumes.music;
      music.connect(master);
      const ui = _ctx.createGain();
      ui.gain.value = _volumes.ui;
      ui.connect(master);
      _channels = { master, sfx, music, ui };
      return _ctx;
    } catch (err) {
      console.warn('[audio] failed to init AudioContext:', err.message);
      return null;
    }
  }

  /// Track first user interaction so AudioContext can be created without
  /// breaking browser autoplay policy.
  function markUserInteracted() {
    if (_userInteracted) return;
    _userInteracted = true;
    ensureContext();
  }
  document.addEventListener('keydown', markUserInteracted, { once: true });
  document.addEventListener('mousedown', markUserInteracted, { once: true });

  /// Resolve a soundId to its file path. Convention: dotted lowercase like
  /// "sfx.combat.hit" → "assets/audio/sfx/combat-hit.ogg".
  function soundIdToPath(soundId) {
    if (!soundId || typeof soundId !== 'string') return null;
    const parts = soundId.split('.');
    if (parts.length < 2) return null;
    const channel = parts[0];                                // sfx / music / ui
    const name = parts.slice(1).join('-');                   // combat-hit / level_up
    if (!['sfx', 'music', 'ui'].includes(channel)) return null;
    return `assets/audio/${channel}/${name}.ogg`;
  }

  /// Load a sound buffer on demand. Caches in _buffers. Resolves to null on
  /// miss (asset not yet generated) so callers can no-op gracefully.
  async function loadBuffer(soundId) {
    if (_buffers[soundId] !== undefined) return _buffers[soundId];
    const ctx = ensureContext();
    if (!ctx) return null;

    const path = soundIdToPath(soundId);
    if (!path) {
      _buffers[soundId] = null;
      return null;
    }
    try {
      const res = await fetch(path);
      if (!res.ok) {
        _buffers[soundId] = null;       // cache miss to avoid repeated fetches
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      _buffers[soundId] = decoded;
      return decoded;
    } catch {
      _buffers[soundId] = null;
      return null;
    }
  }

  /// Play a sound. soundId convention: "sfx.combat.hit" / "music.location.inn"
  /// / "ui.click". volume is 0.0–1.0, multiplied with channel + master gain.
  /// pitch is 0.5–2.0, applied as playbackRate. channel override forces the
  /// sound through a specific mixer regardless of soundId prefix.
  async function playSound(soundId, volume = 1.0, pitch = 1.0, channelOverride = null) {
    const ctx = ensureContext();
    if (!ctx) return;
    const buffer = await loadBuffer(soundId);
    if (!buffer) return;     // silent no-op on miss

    const channelName = channelOverride
      || (soundId.startsWith('music.') ? 'music'
          : soundId.startsWith('ui.') ? 'ui'
          : 'sfx');
    const channelNode = _channels[channelName] || _channels.sfx;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.5, Math.min(2.0, pitch));

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0.0, Math.min(1.0, volume));
    source.connect(gain);
    gain.connect(channelNode);

    // Music tracks loop; SFX/UI play once.
    if (channelName === 'music') {
      source.loop = true;
      _activeLoops[soundId] = source;
    }

    source.start(0);
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); } catch {}
      if (_activeLoops[soundId] === source) delete _activeLoops[soundId];
    };
  }

  /// Stop a currently-playing looped sound (typically location ambient music).
  function stopSound(soundId) {
    const source = _activeLoops[soundId];
    if (!source) return;
    try { source.stop(0); } catch {}
    delete _activeLoops[soundId];
  }

  /// Set per-channel volume. Persists to localStorage so preference survives
  /// across launches.
  function setVolume(channel, volume) {
    volume = Math.max(0.0, Math.min(1.0, Number(volume) || 0));
    if (!['master', 'sfx', 'music', 'ui'].includes(channel)) return;
    _volumes[channel] = volume;
    if (_channels && _channels[channel]) {
      _channels[channel].gain.value = volume;
    }
    try { localStorage.setItem('usurper.volumes', JSON.stringify(_volumes)); } catch {}
  }

  function getVolume(channel) {
    return _volumes[channel] != null ? _volumes[channel] : 1.0;
  }

  window.audio = { playSound, stopSound, setVolume, getVolume };
})();
