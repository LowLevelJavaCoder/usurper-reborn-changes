// Usurper Reborn — JS-side i18n shim for the Electron graphical client.
//
// The C# side already localizes everything that flows through Loc.Get(), so
// emit payloads (location names, NPC dialogue, quest titles, ability names,
// etc.) arrive pre-translated. What this shim handles is the JS-rendered
// chrome — overlay banners, button labels, panel titles, fallback strings —
// that doesn't pass through the C# localization pipeline.
//
// Usage: window.i18n.t('quest.complete_banner') → "QUEST COMPLETE" / "MISIÓN
// COMPLETADA" / etc., depending on the active language. Default fallback
// chain: current → en → key (so a missing key surfaces as the literal key
// rather than blank text — easy to spot during translation work).

(function () {
  'use strict';

  const EMBEDDED_EN = {
    // Settings overlay
    'settings.title':              'Settings',
    'settings.label.language':     'Language',
    'settings.label.font_scale':   'Font scale',
    'settings.toggle.screen_reader': 'Screen reader mode (plain text, no box drawing)',
    'settings.toggle.compact':     'Compact mode (small terminals)',
    'settings.toggle.art':         'Show character & monster art',
    'settings.label.date_format':  'Date format',
    'settings.button.done':        'Done',

    // Quest overlays
    'quest.list.empty':            'No quests available.',
    'quest.list.cancel':           'Cancel',
    'quest.detail.accept':         'Accept',
    'quest.detail.cancel':         'Cancel',
    'quest.complete.banner':       'QUEST COMPLETE',
    'quest.complete.continue':     'Continue',
    'quest.log.empty':             'No active quests.',
    'quest.log.title':             'Quest Log',
    'quest.log.close':             'Close',
    'quest.reward.header':         'Reward',
    'quest.reward.gold':           'gold',
    'quest.reward.xp':             'XP',
    'quest.reward.healing_potions': 'healing potion(s)',
    'quest.reward.mana_potions':   'mana potion(s)',
    'quest.reward.chivalry':       'Chivalry',
    'quest.reward.darkness':       'Darkness',
    'quest.meta.posted_by':        'Posted by:',
    'quest.meta.time':             'Time:',

    // Lifecycle event overlays
    'level_up.banner':             'LEVEL UP!',
    'level_up.fallback':           'Power awakens within you',
    'death.banner':                'YOU DIED',
    'death.killed_by':             'Killed by',
    'death.permadeath':            'PERMADEATH',
    'death.save_erased':           'Your save will be erased.',
    'death.continue':              'Continue',
    'death.resurrect_yes':         'Resurrect (Y)',
    'death.resurrect_no':          'Stay Dead (N)',
    'death.prompt_default':        'Resurrect?',
    'achievement.broadcast':       'BROADCAST',
    'ending.title_default':        'The End',
    'ending.stat.final_level':     'Final Level',
    'ending.stat.total_kills':     'Total Kills',
    'ending.stat.final_gold':      'Final Gold',
    'ending.stat.fame':            'Fame',
    'ending.stat.cycle':           'Cycle',
    'ngplus.banner':               'A NEW CYCLE BEGINS',
    'ngplus.cycle_arrow':          'Cycle {0} → Cycle {1}',
    'ngplus.prompt':               'Begin a new game cycle?',
    'ngplus.yes':                  'Begin (Y)',
    'ngplus.no':                   'Decline (N)',
    'ascension.banner':            '★ ASCENSION ★',
    'ascension.prompt':            'Ascend to godhood?',
    'ascension.yes':               'Ascend (Y)',
    'ascension.no':                'Decline (N)',
    'boss_phase.banner':           'PHASE {0}',

    // Multiplayer overlays
    'chat.panel_title':            'Chat',
    'chat.shouts':                 'shouts:',
    'chat.gossips':                'gossips:',
    'chat.guild':                  '[Guild]',
    'chat.tells_actor':            'You tell {0}:',
    'chat.tells_observer':         '{0} tells you:',
    'chat.someone':                'Someone',
    'group_invite.banner':         'GROUP INVITE',
    'group_invite.body':           'has invited you to join their dungeon group.',
    'group_invite.group_size':     'Group: {0}/{1} members',
    'group_invite.countdown':      '{0}s remaining',
    'group_invite.accept':         'Accept',
    'group_invite.decline':        'Decline',
    'spectate.banner':             '👁 SPECTATE REQUEST',
    'spectate.body':               'wants to watch your session.',
    'spectate.allow':              'Allow',
    'spectate.deny':               'Deny',
    'spectator.watching':          '👁 Watching {0}',
    'spectator.watcher_count':     '👁 {0} watching',
    'news_feed.title':             'While You Were Gone',
    'news_feed.empty':             'All quiet on the world front.',
    'news_feed.continue':          'Continue',
    'news_feed.unread_mail':       '📬 {0} unread mail',
    'news_feed.pending_trade':     '📦 {0} pending trade(s)',

    // Common
    'common.return':               'Return',
    'common.back':                 'Back',
    'common.confirm':              'Confirm',
    'common.cancel':               'Cancel',
  };

  let _current = 'en';
  let _strings = Object.assign({}, EMBEDDED_EN);

  /// Translate a key. If the active language has the key, returns its value.
  /// Otherwise falls back to embedded English. If still missing, returns the
  /// key itself (intentionally — makes missing translations obvious).
  /// args replaces {0}, {1}, ... placeholders.
  function t(key, ...args) {
    let s = _strings[key];
    if (s == null) s = EMBEDDED_EN[key];
    if (s == null) s = key;
    if (args.length === 0) return s;
    return s.replace(/\{(\d+)\}/g, (_, idx) => {
      const i = parseInt(idx, 10);
      return args[i] != null ? String(args[i]) : '';
    });
  }

  /// Switch active language. Tries to fetch lang/{code}.json from the local
  /// asset tree; merges over the English baseline so missing keys still
  /// surface in English instead of going blank.
  async function setLanguage(code) {
    if (!code) code = 'en';
    code = String(code).toLowerCase();
    _current = code;

    // English uses the embedded baseline only — no fetch needed.
    if (code === 'en') {
      _strings = Object.assign({}, EMBEDDED_EN);
      return;
    }

    try {
      const res = await fetch(`./lang/${code}.json`);
      if (!res.ok) {
        console.warn(`[i18n] lang/${code}.json not found (HTTP ${res.status}); falling back to English`);
        _strings = Object.assign({}, EMBEDDED_EN);
        return;
      }
      const overlay = await res.json();
      // Merge over English baseline so partial translations gracefully fall
      // through to en for missing keys.
      _strings = Object.assign({}, EMBEDDED_EN, overlay);
    } catch (err) {
      console.warn(`[i18n] failed to load lang/${code}.json:`, err.message);
      _strings = Object.assign({}, EMBEDDED_EN);
    }
  }

  function getLanguage() { return _current; }

  /// Return the embedded English source map. Useful for build-time tooling
  /// that wants to scaffold lang/<code>.json files with the correct keys.
  function getEnglishSource() { return Object.assign({}, EMBEDDED_EN); }

  // Apply language preference saved in localStorage on load. C# emits the
  // canonical language via /settings, but for instant boot we honor the
  // last user choice.
  try {
    const saved = localStorage.getItem('usurper.language');
    if (saved && saved !== 'en') {
      setLanguage(saved);
    }
  } catch {}

  window.i18n = { t, setLanguage, getLanguage, getEnglishSource };
})();
