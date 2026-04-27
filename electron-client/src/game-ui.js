// Usurper Reborn — Darkest Dungeon-style Game UI
// Full graphical estate screen with clickable buildings,
// toast notifications, and atmospheric scene rendering.

class GameUI {
  constructor(container, sendInput) {
    this.container = container;
    this.sendInput = sendInput;
    this.matcher = new PatternMatcher();

    // Phase 9: persist font scale across launches via localStorage. Applied
    // as a CSS variable on the document root so size affects every overlay.
    try {
      const saved = parseFloat(localStorage.getItem('usurper.fontScale') || '1.0');
      if (!isNaN(saved) && saved >= 0.85 && saved <= 1.4) {
        this._fontScale = saved;
        document.documentElement.style.setProperty('--gui-font-scale', String(saved));
      } else {
        this._fontScale = 1.0;
      }
    } catch { this._fontScale = 1.0; }

    // Game state
    this.state = {
      hp: 0, maxHp: 0,
      mana: 0, maxMana: 0,
      stamina: 0, maxStamina: 0,
      gold: 0, level: 0,
      location: '',
      currentScene: null,
    };

    // Location → scene image
    this.sceneMap = [
      { keywords: ['main street'],                    image: 'main-street.png', filter: '' },
      { keywords: ['dungeon', 'floor'],               image: 'dungeon.png',     filter: '' },
      { keywords: ['inn', 'dormitory'],               image: 'inn.png',         filter: '' },
      { keywords: ['weapon shop'],                     image: 'weapon-shop.png', filter: '' },
      { keywords: ['armor shop'],                      image: 'weapon-shop.png', filter: 'hue-rotate(10deg)' },
      { keywords: ['magic shop'],                      image: 'inn.png',         filter: 'hue-rotate(200deg) saturate(0.8)' },
      { keywords: ['temple', 'church'],                image: 'temple.png',      filter: '' },
      { keywords: ['bank'],                            image: 'bank.png',        filter: '' },
      { keywords: ['healer'],                          image: 'healer.png',      filter: '' },
      { keywords: ['castle'],                          image: 'castle.png',      filter: '' },
      { keywords: ['wilderness'],                      image: 'wilderness.png',  filter: '' },
      { keywords: ['dark alley'],                      image: 'main-street.png', filter: 'brightness(0.35) saturate(0.4)' },
      { keywords: ['home'],                            image: 'inn.png',         filter: 'brightness(1.1) saturate(0.7)' },
    ];

    // Dungeon theme → scene image
    this.dungeonThemeMap = {
      'Catacombs':    'catacombs.png',
      'Sewers':       'sewers.png',
      'Caverns':      'caverns.png',
      'AncientRuins': 'ancient-ruins.png',
      'DemonLair':    'demon-lair.png',
      'FrozenDepths': 'frozen-depths.png',
      'VolcanicPit':  'volcanic-pit.png',
      'AbyssalVoid':  'abyssal-void.png',
    };

    // Monster family → sprite image
    this.monsterSpriteMap = {
      'Goblinoid': 'goblin.png',
      'Undead':    'skeleton.png',
      'Orcish':    'orc.png',
      'Draconic':  'dragon.png',
      'Demonic':   'demon.png',
      'Giant':     'giant.png',
      'Beast':     'wolf-beast.png',
      'Elemental': 'elemental.png',
      'Insectoid': 'spider-queen.png',
      'Construct': 'golem.png',
      'Fey':       'dark-fairy.png',
      'Aquatic':   'sea-creature.png',
      'Celestial': 'fallen-angel.png',
      'Shadow':    'shadow.png',
      'Aberration':'wraith.png',
    };

    // Building definitions for the estate dock
    this.buildings = {
      explore: [
        { key: 'D', name: 'Dungeons',   icon: '⚔' },
        { key: 'E', name: 'Wilderness',  icon: '🌲' },
        { key: '>', name: 'Outskirts',   icon: '🏕' },
      ],
      services: [
        { key: 'I', name: 'Inn',         icon: '🍺' },
        { key: 'W', name: 'Weapons',     icon: '🗡' },
        { key: 'A', name: 'Armor',       icon: '🛡' },
        { key: 'M', name: 'Magic',       icon: '✨' },
        { key: 'U', name: 'Music',       icon: '🎵' },
        { key: 'B', name: 'Bank',        icon: '🏦' },
        { key: '1', name: 'Healer',      icon: '💊' },
        { key: 'T', name: 'Temple',      icon: '⛪' },
      ],
      progress: [
        { key: 'V', name: 'Training',    icon: '📖' },
        { key: '2', name: 'Quests',      icon: '📜' },
        { key: 'H', name: 'Home',        icon: '🏠' },
      ],
    };

    // Pending menu items from server (used to detect which buildings are available)
    this.serverMenuItems = [];

    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div class="gui-layout">
        <!-- Top HUD -->
        <div class="gui-hud">
          <div class="gui-hud-left">
            <div class="gui-hud-stat">
              <span class="gui-hud-label">HP</span>
              <div class="gui-bar-track">
                <div class="gui-bar-fill gui-bar-hp" id="gui-hp-bar"></div>
              </div>
              <span class="gui-hud-value" id="gui-hp-text">0/0</span>
            </div>
            <div class="gui-hud-stat">
              <span class="gui-hud-label" id="gui-resource-label">ST</span>
              <div class="gui-bar-track">
                <div class="gui-bar-fill gui-bar-stamina" id="gui-resource-bar"></div>
              </div>
              <span class="gui-hud-value" id="gui-resource-text">0/0</span>
            </div>
          </div>
          <div class="gui-hud-center">
            <span class="gui-location-name" id="gui-location">&mdash;</span>
          </div>
          <div class="gui-hud-right">
            <div class="gui-hud-stat">
              <span class="gui-hud-label">Gold</span>
              <span class="gui-hud-value gui-gold" id="gui-gold">0</span>
            </div>
            <div class="gui-hud-stat">
              <span class="gui-hud-label">Level</span>
              <span class="gui-hud-value" id="gui-level">1</span>
            </div>
          </div>
        </div>

        <!-- Main scene area -->
        <div class="gui-main">
          <div class="gui-scene">
            <div class="gui-scene-bg" id="gui-scene-bg">
              <div class="gui-npc-area" id="gui-npc-area"></div>
              <div class="gui-scene-title" id="gui-scene-title"></div>
              <!-- Compass navigation overlay (dungeon) -->
              <div class="gui-compass" id="gui-compass">
                <button class="gui-compass-btn gui-compass-n" data-dir="N" title="North">&#9650;</button>
                <button class="gui-compass-btn gui-compass-w" data-dir="W" title="West">&#9664;</button>
                <button class="gui-compass-btn gui-compass-e" data-dir="E" title="East">&#9654;</button>
                <button class="gui-compass-btn gui-compass-s" data-dir="S" title="South">&#9660;</button>
              </div>
              <!-- Room action buttons (Fight, Treasure, etc.) -->
              <div class="gui-room-actions" id="gui-room-actions"></div>
              <!-- Click-anywhere overlay for "Press any key" -->
              <div class="gui-press-any" id="gui-press-any" style="display:none">
                <span>Click or press any key to continue...</span>
              </div>
            </div>
          </div>
          <!-- Toast notifications -->
          <div class="gui-toast-area" id="gui-toast-area"></div>
        </div>

        <!-- Building dock -->
        <div class="gui-dock">
          <div class="gui-dock-scroll" id="gui-dock"></div>
        </div>

        <!-- Input -->
        <div class="gui-input-row">
          <input type="text" class="gui-input" id="gui-input"
            placeholder="Type command..." autocomplete="off" spellcheck="false">
        </div>
      </div>
    `;

    // Cache DOM
    this.hpBar = this.container.querySelector('#gui-hp-bar');
    this.hpText = this.container.querySelector('#gui-hp-text');
    this.resourceBar = this.container.querySelector('#gui-resource-bar');
    this.resourceText = this.container.querySelector('#gui-resource-text');
    this.resourceLabel = this.container.querySelector('#gui-resource-label');
    this.goldText = this.container.querySelector('#gui-gold');
    this.levelText = this.container.querySelector('#gui-level');
    this.locationText = this.container.querySelector('#gui-location');
    this.sceneBg = this.container.querySelector('#gui-scene-bg');
    this.sceneTitle = this.container.querySelector('#gui-scene-title');
    this.npcArea = this.container.querySelector('#gui-npc-area');
    this.toastArea = this.container.querySelector('#gui-toast-area');
    this.dock = this.container.querySelector('#gui-dock');
    this.inputEl = this.container.querySelector('#gui-input');
    this.compass = this.container.querySelector('#gui-compass');
    this.roomActions = this.container.querySelector('#gui-room-actions');
    this.pressAny = this.container.querySelector('#gui-press-any');

    // Track game screen state
    this.screen = 'town'; // town | dungeon | combat | loot

    // Input handling
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.sendInput(this.inputEl.value + '\n');
        this.inputEl.value = '';
        e.preventDefault();
      }
    });

    // Compass direction buttons
    this.compass.querySelectorAll('.gui-compass-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sendInput(btn.dataset.dir + '\n');
      });
    });

    // Press-any-key overlay
    this.pressAny.addEventListener('click', () => {
      this.sendInput('\n');
      this.pressAny.style.display = 'none';
    });

    // Keyboard shortcuts — single key sends command immediately in graphical mode
    window.addEventListener('keydown', (e) => {
      if (e.target === this.inputEl) return; // don't intercept when typing
      if (e.key === 'F10' || e.key === 'F9') return; // let view toggle through

      // Dismiss press-any-key on any keypress
      if (this.pressAny.style.display !== 'none') {
        this.sendInput('\n');
        this.pressAny.style.display = 'none';
        e.preventDefault();
        return;
      }

      // Enter key sends newline (for prompts)
      if (e.key === 'Enter') {
        this.sendInput('\n');
        e.preventDefault();
        return;
      }

      // Single key presses map to game commands
      const key = e.key.toUpperCase();
      if (/^[A-Z0-9><!]$/.test(key) && !e.ctrlKey && !e.altKey) {
        this.sendInput(key + '\n');
        e.preventDefault();
      }
    });

    // Render default dock
    this._renderDock();
  }

  // ─── Structured Game Events (from OSC JSON) ──

  handleGameEvent(event) {
    const { e: type, d: data } = event;

    switch (type) {
      case 'location':
        this.screen = 'town';
        this._setLocation(data.name);
        if (data.description) this.sceneTitle.textContent = data.description;
        this.compass.style.display = 'none';
        this.roomActions.innerHTML = '';
        break;

      case 'stats':
        this._updateHUD(data);
        if (data.className) this.state.playerClass = data.className.toLowerCase().replace(/\s+/g, '-');
        if (data.raceName) this.state.playerRace = data.raceName;
        if (data.playerName) this.state.playerName = data.playerName;
        break;

      case 'menu':
        if (data.items) this._renderDockFromServer(data.items);
        break;

      case 'npcs':
        this.npcArea.innerHTML = '';
        if (data.npcs) {
          for (const npc of data.npcs) {
            this._addNPCTagFromEvent(npc);
          }
        }
        break;

      case 'dungeon_room':
        this._setLocation(`Floor ${data.floor} — ${data.roomName}`);
        // Use theme-specific background
        const themeImage = this.dungeonThemeMap[data.theme] || 'dungeon.png';
        this._applySceneDirect(themeImage);
        this._renderDungeonRoom(data);
        break;

      case 'dungeon_map':
        this._renderDungeonMap(data);
        break;

      case 'inventory':
        this._renderInventory(data);
        break;

      case 'inventory_result':
        this._showInventoryResult(data);
        break;

      case 'inventory_slot_pick':
        this._showSlotPicker(data);
        break;

      case 'character_status':
        this._renderCharacterStatus(data);
        break;

      case 'party_status':
        this._renderPartyStatus(data);
        break;

      case 'potions_menu':
        this._renderPotionsMenu(data);
        break;

      case 'combat_start':
        this.screen = 'combat';
        this.state.inCombat = true;
        this.state.combat = data;
        this.state.combatFamily = data.family;
        this.compass.style.display = 'none';
        this.roomActions.innerHTML = '';
        this._renderCombatStart(data);
        this._renderCombatDock();
        break;

      case 'combat_status':
        this._renderCombatStatus(data);
        // Combat dock is now rendered by combat_menu event
        break;

      case 'combat_action':
        this._handleCombatAction(data);
        break;

      case 'combat_menu':
        // Store teammates for rendering in combat_status
        if (data.teammates) this.state.combatTeammates = data.teammates;
        this._renderFullCombatMenu(data);
        break;

      case 'combat_end':
        this.screen = 'dungeon';
        this.state.inCombat = false;
        this._renderCombatEnd(data);
        break;

      case 'narration':
        this._toast([{ text: data.text, fg: '#c0a050', bold: false }], 'system');
        break;

      case 'choice':
        // Render choice buttons overlaid on the scene
        this._renderChoiceButtons(data.context, data.title, data.options);
        break;

      case 'loot_item':
        this._renderLootItem(data);
        break;

      case 'press_any_key':
        this.pressAny.style.display = 'flex';
        break;

      case 'input_prompt':
        // Generic input prompt — focus the input field
        if (data.prompt) {
          this.inputEl.placeholder = data.prompt;
        }
        break;

      case 'confirm':
        this._renderChoiceButtons('confirm', data.question, [
          { key: 'Y', label: 'Yes', style: 'info' },
          { key: 'N', label: 'No', style: 'info' },
        ]);
        break;

      // ─── Phase 3 Pre-Game Events ──────────────
      // The C# side emits these before any character is loaded. Each handler
      // shows a focused screen that takes over the viewport; click handlers
      // send the input back via stdin (same path as text-mode keystrokes).

      case 'main_menu':
        this._renderMainMenu(data);
        break;

      case 'save_list':
        this._renderSaveList(data);
        break;

      case 'char_create_step':
        this._renderCharCreateStep(data);
        break;

      case 'recovery_menu':
        this._renderRecoveryMenu(data);
        break;

      case 'opening_narration':
        this._renderOpeningNarration(data);
        break;

      // ─── Phase 4 Sub-Screen Events ──────────────

      case 'amount_entry':
        this._renderAmountEntry(data);
        break;

      case 'shop_browse':
        this._renderShopBrowse(data);
        break;

      // ─── Phase 6 Dialogue + Quest Events ───────

      case 'dialogue':
        this._renderDialogue(data);
        break;

      case 'dialogue_close':
        this._dismissDialogueOverlay();
        break;

      case 'quest_list':
        this._renderQuestList(data);
        break;

      case 'quest_details':
        this._renderQuestDetails(data);
        break;

      case 'quest_complete':
        this._renderQuestComplete(data);
        break;

      case 'quest_log':
        this._renderQuestLog(data);
        break;

      // ─── Phase 7 Lifecycle Events ──────────────

      case 'level_up':
        this._renderLevelUp(data);
        break;

      case 'death':
        this._renderDeathScreen(data);
        break;

      case 'achievement_toast':
        this._renderAchievementToast(data);
        break;

      case 'ending':
        this._renderEnding(data);
        break;

      case 'ng_plus_prompt':
        this._renderNgPlusPrompt(data);
        break;

      case 'immortal_ascension':
        this._renderImmortalAscension(data);
        break;

      case 'boss_phase_transition':
        this._renderBossPhaseTransition(data);
        break;

      // ─── Phase 8 Online Multiplayer Events ────

      case 'chat_broadcast':
        this._renderChatBroadcast(data);
        break;

      case 'group_invite':
        this._renderGroupInvite(data);
        break;

      case 'news_feed':
        this._renderNewsFeed(data);
        break;

      case 'spectate_request':
        this._renderSpectateRequest(data);
        break;

      case 'spectator_state':
        this._renderSpectatorState(data);
        break;

      // ─── Phase 9 Settings + Polish ─────────────

      case 'settings':
        this._renderSettings(data);
        break;

      case 'settings_applied':
        this._renderSettingsAppliedToast(data);
        break;

      // ─── Phase 9.5 Audio Events ────────────────

      case 'sound':
        if (window.audio && window.audio.playSound) {
          window.audio.playSound(
            data.soundId,
            data.volume != null ? data.volume : 1.0,
            data.pitch != null ? data.pitch : 1.0,
            data.channel || null);
        }
        break;

      case 'sound_stop':
        if (window.audio && window.audio.stopSound) {
          window.audio.stopSound(data.soundId);
        }
        break;

      case 'volume_set':
        if (window.audio && window.audio.setVolume) {
          window.audio.setVolume(data.channel, data.volume);
        }
        break;

      default:
        console.log('Unknown game event:', type, data);
    }
  }

  // ─── Phase 4 Sub-Screen Renderers ──────────────

  _renderAmountEntry(data) {
    // Generic numeric amount-entry overlay used by Bank deposit/withdraw,
    // Temple/Church donations, Level Master training, etc. C# emits the
    // prompt + max amount; we accept a number, validate against min/max,
    // and send the value back as plain text so the existing C# input
    // parser treats it like a typed line.
    const overlay = document.createElement('div');
    overlay.className = 'pregame-overlay amount-entry-overlay';
    const max = data.maxAmount || 0;
    const min = data.minAmount || 0;
    const def = data.defaultAmount != null ? data.defaultAmount : Math.min(max, Math.max(min, 0));
    overlay.innerHTML = `
      <div class="amount-entry-card">
        <div class="amount-entry-title">${this._escapeHtml(data.title || 'Enter Amount')}</div>
        <div class="amount-entry-prompt">${this._escapeHtml(data.prompt || '')}</div>
        <div class="amount-entry-max">Max: ${this._formatNumber(max)} ${this._escapeHtml(data.currency || 'gold')}</div>
        <input type="number" class="amount-entry-input" value="${def}" min="${min}" max="${max}" />
        <div class="amount-entry-presets">
          <button class="pregame-btn amount-preset" data-amount="${Math.floor(max / 4)}">25%</button>
          <button class="pregame-btn amount-preset" data-amount="${Math.floor(max / 2)}">50%</button>
          <button class="pregame-btn amount-preset" data-amount="${Math.floor(max * 0.75)}">75%</button>
          <button class="pregame-btn amount-preset" data-amount="${max}">Max</button>
        </div>
        <div class="amount-entry-actions">
          <button class="pregame-btn amount-confirm-btn">Confirm</button>
          <button class="pregame-btn amount-cancel-btn">Cancel</button>
        </div>
      </div>
    `;
    const input = overlay.querySelector('.amount-entry-input');
    overlay.querySelectorAll('.amount-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-amount');
      });
    });
    overlay.querySelector('.amount-confirm-btn').addEventListener('click', () => {
      const val = Math.max(min, Math.min(max, parseInt(input.value, 10) || 0));
      this._sendInput(String(val));
      this._dismissPregameOverlay();
    });
    overlay.querySelector('.amount-cancel-btn').addEventListener('click', () => {
      this._sendInput('0');
      this._dismissPregameOverlay();
    });
    // Enter key submits
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        overlay.querySelector('.amount-confirm-btn').click();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        overlay.querySelector('.amount-cancel-btn').click();
      }
    });

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
    setTimeout(() => input.focus(), 50);
  }

  _renderShopBrowse(data) {
    const overlay = document.createElement('div');
    overlay.className = 'pregame-overlay shop-browse-overlay';
    const items = data.items || [];
    const totalPages = data.totalPages || 1;
    const currentPage = data.currentPage || 1;

    overlay.innerHTML = `
      <div class="shop-browse-card">
        <div class="shop-browse-header">
          <div class="shop-browse-title">${this._escapeHtml(data.shopName || 'Shop')}</div>
          <div class="shop-browse-category">${this._escapeHtml(data.category || '')}</div>
          <div class="shop-browse-gold">${this._formatNumber(data.playerGold || 0)} gold</div>
        </div>
        <div class="shop-browse-items"></div>
        <div class="shop-browse-pagination">
          ${currentPage > 1 ? `<button class="pregame-btn shop-page-btn" data-cc-key="P">← Prev</button>` : '<span></span>'}
          <span class="shop-page-indicator">Page ${currentPage} / ${totalPages}</span>
          ${currentPage < totalPages ? `<button class="pregame-btn shop-page-btn" data-cc-key="N">Next →</button>` : '<span></span>'}
        </div>
        <div class="shop-browse-footer">
          <button class="pregame-btn shop-back-btn" data-cc-key="R">Return</button>
        </div>
      </div>
    `;

    const itemsContainer = overlay.querySelector('.shop-browse-items');
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = `pregame-btn shop-item-card rarity-${(item.rarity || 'common').toLowerCase()}`;
      const buyable = item.affordable && item.levelOk && item.classOk;
      if (!buyable) btn.classList.add('not-buyable');
      btn.disabled = !buyable;

      let warningHtml = '';
      if (!item.affordable) warningHtml = '<div class="shop-item-warning">Insufficient gold</div>';
      else if (!item.levelOk) warningHtml = `<div class="shop-item-warning">Requires Lv.${item.minLevel}</div>`;
      else if (!item.classOk) warningHtml = '<div class="shop-item-warning">Class restricted</div>';

      const bonuses = item.bonuses && Object.keys(item.bonuses).length > 0
        ? `<div class="shop-item-bonuses">${Object.entries(item.bonuses).map(([k, v]) => `<span>${k} ${v >= 0 ? '+' : ''}${v}</span>`).join(' ')}</div>`
        : '';

      btn.innerHTML = `
        <div class="shop-item-name">${this._escapeHtml(item.name)}</div>
        <div class="shop-item-meta">
          <span class="shop-item-slot">${this._escapeHtml(item.slot)}</span>
          <span class="shop-item-power">PWR ${item.power}</span>
        </div>
        ${bonuses}
        <div class="shop-item-price">${this._formatNumber(item.price)} gold</div>
        ${warningHtml}
      `;
      btn.setAttribute('data-cc-key', item.key);
      btn.addEventListener('click', () => {
        this._sendInput(item.key);
        // Don't dismiss — shop will re-emit a new state (purchase confirm or
        // refreshed page) and the new emit triggers a fresh overlay.
      });
      itemsContainer.appendChild(btn);
    }

    overlay.querySelectorAll('.shop-page-btn, .shop-back-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-cc-key');
        this._sendInput(key);
      });
    });

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _formatNumber(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString();
  }

  // ─── Phase 6 Dialogue + Quest Renderers ─────

  _renderDialogue(data) {
    // Re-use existing overlay if present so iterating through a conversation
    // updates in place (no flicker). Speaker portrait left, body text + choices
    // right. Numeric choice keys flow back through the shared GetInput call.
    let overlay = this._currentDialogueOverlay;
    const isNew = !overlay;
    if (isNew) {
      overlay = document.createElement('div');
      overlay.className = 'gui-overlay dialogue-overlay';
      this._currentDialogueOverlay = overlay;
    }

    const speaker = this._escapeHtml(data.speaker || '');
    const relLabel = data.relationLabel ? `<div class="dialogue-relation" data-color="${this._escapeHtml(data.relationColor || 'gray')}">${this._escapeHtml(data.relationLabel)}</div>` : '';
    const textBody = (data.text || '').split('\n').map(line => `<p>${this._escapeHtml(line)}</p>`).join('');
    const portrait = this._resolveDialoguePortrait(data.portraitKey, data.speaker);

    let choicesHtml = '';
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      choicesHtml = '<div class="dialogue-choices">' +
        data.choices.map(c => {
          const disabled = c.disabled ? ' disabled' : '';
          const style = c.style ? ` data-style="${this._escapeHtml(c.style)}"` : '';
          return `<button class="dialogue-choice"${style}${disabled} data-key="${this._escapeHtml(c.key)}">
            <span class="dialogue-choice-key">${this._escapeHtml(c.key)}</span>
            <span class="dialogue-choice-text">${this._escapeHtml(c.text)}</span>
          </button>`;
        }).join('') +
        '</div>';
    }

    overlay.innerHTML = `
      <div class="dialogue-card">
        <div class="dialogue-portrait" style="background-image:url('${portrait}')"></div>
        <div class="dialogue-body">
          <div class="dialogue-header">
            <div class="dialogue-speaker">${speaker || '&nbsp;'}</div>
            ${relLabel}
          </div>
          <div class="dialogue-text">${textBody}</div>
          ${choicesHtml}
        </div>
      </div>
    `;

    overlay.querySelectorAll('.dialogue-choice:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        this._sendInput(key);
        // Don't dismiss yet — C# will re-emit the next dialogue state or
        // EmitDialogueClose when the conversation ends.
      });
    });

    if (isNew) document.body.appendChild(overlay);
  }

  _dismissDialogueOverlay() {
    if (this._currentDialogueOverlay && this._currentDialogueOverlay.parentNode) {
      this._currentDialogueOverlay.parentNode.removeChild(this._currentDialogueOverlay);
    }
    this._currentDialogueOverlay = null;
  }

  _resolveDialoguePortrait(portraitKey, speakerName) {
    // Fallback chain (Phase 9 hardened):
    // 1. NPC-specific portrait by speaker name → portraits-hd/{name}.png
    // 2. Companion class fallback (Aldric→warrior, Mira→cleric, etc.)
    // 3. Generic class portrait by class hint
    // 4. Generic silhouette
    const COMPANION_CLASS_MAP = {
      'aldric': 'warrior',
      'mira': 'cleric',
      'lyris': 'ranger',
      'vex': 'assassin',
      'melodia': 'bard'
    };
    if (portraitKey && portraitKey.startsWith('npc:')) {
      const rawName = portraitKey.slice(4).toLowerCase();
      const safeName = rawName.replace(/[^a-z0-9]/g, '_');
      const compClass = COMPANION_CLASS_MAP[rawName];
      // Use class portrait directly (NPC-specific portraits aren't generated yet).
      // Phase 9.5 polish backlog: per-NPC portrait generation via PixelLab.
      if (compClass) return `assets/classes-hd/${compClass}.png`;
      // Future: try assets/portraits-hd/{safeName}.png first via image preload check.
      return `assets/classes-hd/warrior.png`;
    }
    if (portraitKey && portraitKey.startsWith('class:')) {
      const cls = portraitKey.slice(6).toLowerCase();
      return `assets/classes-hd/${cls}.png`;
    }
    return 'assets/classes-hd/warrior.png';
  }

  _renderQuestList(data) {
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay quest-list-overlay';
    const title = this._escapeHtml(data.title || 'Quests');
    const listType = this._escapeHtml(data.listType || '');

    let body;
    if (!Array.isArray(data.quests) || data.quests.length === 0) {
      body = `<div class="quest-list-empty">No quests available.</div>`;
    } else {
      body = '<div class="quest-list-items">' + data.quests.map(q => {
        const eligible = q.eligible !== false;
        const disabled = eligible ? '' : ' disabled';
        const ineligible = !eligible && q.ineligibleReason
          ? `<div class="quest-list-warning">${this._escapeHtml(q.ineligibleReason)}</div>` : '';
        const progress = q.progress
          ? `<div class="quest-list-progress">${this._escapeHtml(q.progress)}</div>` : '';
        const status = q.status ? `<span class="quest-list-status">${this._escapeHtml(q.status)}</span>` : '';
        const desc = q.description ? `<div class="quest-list-desc">${this._escapeHtml(q.description)}</div>` : '';
        return `<button class="quest-list-item" data-key="${this._escapeHtml(q.key)}"${disabled}>
          <div class="quest-list-key">${this._escapeHtml(q.key)}</div>
          <div class="quest-list-body">
            <div class="quest-list-title">${this._escapeHtml(q.title)}</div>
            <div class="quest-list-meta">
              <span class="quest-list-difficulty" data-difficulty="${this._escapeHtml(q.difficulty || '')}">${this._escapeHtml(q.difficulty || '')}</span>
              <span class="quest-list-levels">Lv.${q.minLevel}-${q.maxLevel}</span>
              ${status}
            </div>
            ${desc}
            ${progress}
            ${ineligible}
          </div>
        </button>`;
      }).join('') + '</div>';
    }

    overlay.innerHTML = `
      <div class="quest-list-card" data-list-type="${listType}">
        <div class="quest-list-title-bar">${title}</div>
        ${body}
        <div class="quest-list-actions">
          <button class="pregame-btn quest-list-cancel">Cancel</button>
        </div>
      </div>
    `;

    overlay.querySelectorAll('.quest-list-item:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        this._sendInput(key);
      });
    });
    overlay.querySelector('.quest-list-cancel').addEventListener('click', () => {
      this._sendInput('0');
    });

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderQuestDetails(data) {
    const q = data.quest || {};
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay quest-details-overlay';
    const action = data.confirmAction || 'accept';

    const objectives = Array.isArray(q.objectives) && q.objectives.length > 0
      ? '<ul class="quest-detail-objectives">' + q.objectives.map(o => `<li>${this._escapeHtml(o)}</li>`).join('') + '</ul>'
      : '';
    const reward = this._buildRewardSummary(q.reward);

    overlay.innerHTML = `
      <div class="quest-detail-card">
        <div class="quest-detail-title-bar">${this._escapeHtml(q.title || 'Quest')}</div>
        <div class="quest-detail-body">
          <div class="quest-detail-meta">
            <span class="quest-list-difficulty" data-difficulty="${this._escapeHtml(q.difficulty || '')}">${this._escapeHtml(q.difficulty || '')}</span>
            <span>Lv.${q.minLevel}-${q.maxLevel}</span>
            ${q.giver ? `<span>Posted by: ${this._escapeHtml(q.giver)}</span>` : ''}
            ${q.timeLimit ? `<span>Time: ${this._escapeHtml(q.timeLimit)}</span>` : ''}
          </div>
          ${q.description ? `<div class="quest-detail-desc">${this._escapeHtml(q.description)}</div>` : ''}
          ${objectives}
          ${reward}
        </div>
        <div class="quest-detail-actions">
          <button class="pregame-btn quest-detail-confirm">Accept</button>
          <button class="pregame-btn quest-detail-cancel">Cancel</button>
        </div>
      </div>
    `;

    overlay.querySelector('.quest-detail-confirm').addEventListener('click', () => {
      this._sendInput('Y');
    });
    overlay.querySelector('.quest-detail-cancel').addEventListener('click', () => {
      this._sendInput('N');
    });

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderQuestComplete(data) {
    const q = data.quest || {};
    const reward = this._buildRewardSummary(data.rewards || q.reward);
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay quest-complete-overlay';
    const tr = (window.i18n && window.i18n.t) || ((k) => k);
    overlay.innerHTML = `
      <div class="quest-complete-card">
        <div class="quest-complete-banner">${this._escapeHtml(tr('quest.complete.banner'))}</div>
        <div class="quest-complete-title">${this._escapeHtml(q.title || 'Quest')}</div>
        ${reward}
        <div class="quest-detail-actions">
          <button class="pregame-btn quest-complete-dismiss">${this._escapeHtml(tr('quest.complete.continue'))}</button>
        </div>
      </div>
    `;
    overlay.querySelector('.quest-complete-dismiss').addEventListener('click', () => {
      this._sendInput('');
    });
    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderQuestLog(data) {
    const quests = Array.isArray(data.activeQuests) ? data.activeQuests : [];
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay quest-log-overlay';

    let body;
    if (quests.length === 0) {
      body = `<div class="quest-log-empty">No active quests.</div>`;
    } else {
      body = '<div class="quest-log-items">' + quests.map(q => {
        const objectives = Array.isArray(q.objectives) && q.objectives.length > 0
          ? '<ul class="quest-detail-objectives">' + q.objectives.map(o => `<li>${this._escapeHtml(o)}</li>`).join('') + '</ul>'
          : '';
        return `<div class="quest-log-item">
          <div class="quest-log-title">${this._escapeHtml(q.title)}</div>
          <div class="quest-detail-meta">
            <span class="quest-list-difficulty" data-difficulty="${this._escapeHtml(q.difficulty || '')}">${this._escapeHtml(q.difficulty || '')}</span>
            ${q.timeLimit ? `<span>Time: ${this._escapeHtml(q.timeLimit)}</span>` : ''}
          </div>
          ${q.description ? `<div class="quest-detail-desc">${this._escapeHtml(q.description)}</div>` : ''}
          ${objectives}
        </div>`;
      }).join('') + '</div>';
    }

    overlay.innerHTML = `
      <div class="quest-log-card">
        <div class="quest-list-title-bar">Quest Log</div>
        ${body}
        <div class="quest-detail-actions">
          <button class="pregame-btn quest-log-close">Close</button>
        </div>
      </div>
    `;
    overlay.querySelector('.quest-log-close').addEventListener('click', () => {
      this._sendInput('');
    });
    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _buildRewardSummary(reward) {
    if (!reward) return '';
    const parts = [];
    if (reward.gold) parts.push(`<div class="reward-icon"><span>💰</span> ${this._formatNumber(reward.gold)} gold</div>`);
    if (reward.experience) parts.push(`<div class="reward-icon"><span>⭐</span> ${this._formatNumber(reward.experience)} XP</div>`);
    if (reward.potions) parts.push(`<div class="reward-icon"><span>🧪</span> ${reward.potions} healing potion(s)</div>`);
    if (reward.manaPotions) parts.push(`<div class="reward-icon"><span>💧</span> ${reward.manaPotions} mana potion(s)</div>`);
    if (reward.chivalry) parts.push(`<div class="reward-icon"><span>✨</span> +${reward.chivalry} Chivalry</div>`);
    if (reward.darkness) parts.push(`<div class="reward-icon"><span>☠️</span> +${reward.darkness} Darkness</div>`);
    if (reward.itemName) parts.push(`<div class="reward-icon"><span>🎁</span> ${this._escapeHtml(reward.itemName)}</div>`);
    if (Array.isArray(reward.extras)) {
      reward.extras.forEach(e => parts.push(`<div class="reward-extra">${this._escapeHtml(e)}</div>`));
    }
    if (parts.length === 0) return '';
    return `<div class="quest-reward-block"><div class="quest-reward-header">Reward</div>${parts.join('')}</div>`;
  }

  // ─── Phase 7 Lifecycle Renderers ────────────

  _renderLevelUp(data) {
    // Non-blocking celebratory toast. Stat increases listed; auto-dismisses
    // after 4s but clickable to dismiss early.
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay level-up-overlay';
    if (data.isMilestone) overlay.classList.add('level-up-milestone');

    const stats = data.gains || {};
    const lines = [];
    if (stats.maxHp) lines.push(`<div class="lvl-stat"><span class="lvl-icon">❤️</span>+${stats.maxHp} Max HP</div>`);
    if (stats.maxMana) lines.push(`<div class="lvl-stat"><span class="lvl-icon">💧</span>+${stats.maxMana} Max Mana</div>`);
    if (stats.maxStamina) lines.push(`<div class="lvl-stat"><span class="lvl-icon">⚡</span>+${stats.maxStamina} Max Stamina</div>`);
    if (stats.strength) lines.push(`<div class="lvl-stat"><span class="lvl-icon">💪</span>+${stats.strength} STR</div>`);
    if (stats.defence) lines.push(`<div class="lvl-stat"><span class="lvl-icon">🛡️</span>+${stats.defence} DEF</div>`);
    if (stats.dexterity) lines.push(`<div class="lvl-stat"><span class="lvl-icon">🏹</span>+${stats.dexterity} DEX</div>`);
    if (stats.constitution) lines.push(`<div class="lvl-stat"><span class="lvl-icon">🧱</span>+${stats.constitution} CON</div>`);
    if (stats.intelligence) lines.push(`<div class="lvl-stat"><span class="lvl-icon">🔮</span>+${stats.intelligence} INT</div>`);
    if (stats.wisdom) lines.push(`<div class="lvl-stat"><span class="lvl-icon">📖</span>+${stats.wisdom} WIS</div>`);
    if (stats.charisma) lines.push(`<div class="lvl-stat"><span class="lvl-icon">✨</span>+${stats.charisma} CHA</div>`);
    if (stats.agility) lines.push(`<div class="lvl-stat"><span class="lvl-icon">🌀</span>+${stats.agility} AGI</div>`);
    if (stats.trainingPoints) lines.push(`<div class="lvl-stat"><span class="lvl-icon">🎯</span>+${stats.trainingPoints} Training Points</div>`);

    const tr = (window.i18n && window.i18n.t) || ((k, ...a) => k);
    overlay.innerHTML = `
      <div class="level-up-card">
        <div class="level-up-banner">${this._escapeHtml(tr('level_up.banner'))}</div>
        <div class="level-up-level">${data.newLevel}</div>
        <div class="level-up-class">${this._escapeHtml(data.className || '')}</div>
        <div class="level-up-stats">${lines.join('') || `<div class="lvl-stat">${this._escapeHtml(tr('level_up.fallback'))}</div>`}</div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 4000);
  }

  _renderDeathScreen(data) {
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay death-overlay';
    if (data.isPermadeath) overlay.classList.add('death-permadeath');

    const losses = [];
    if (data.fameLoss) losses.push(`<div class="death-loss">Fame: -${data.fameLoss}</div>`);
    if (data.xpLoss) losses.push(`<div class="death-loss">XP: -${this._formatNumber(data.xpLoss)}</div>`);
    if (data.goldLoss) losses.push(`<div class="death-loss">Gold: -${this._formatNumber(data.goldLoss)}</div>`);
    if (Array.isArray(data.itemsLost) && data.itemsLost.length > 0) {
      losses.push(`<div class="death-loss">Lost: ${data.itemsLost.map(i => this._escapeHtml(i)).join(', ')}</div>`);
    }

    const farewells = (Array.isArray(data.teammateFarewells) && data.teammateFarewells.length > 0)
      ? '<div class="death-farewells">' + data.teammateFarewells.map(f => `<div>${this._escapeHtml(f)}</div>`).join('') + '</div>'
      : '';

    const tr = (window.i18n && window.i18n.t) || ((k) => k);
    let actions = '';
    if (data.isPermadeath || data.isNightmareMode) {
      actions = `
        <div class="death-permadeath-notice">${this._escapeHtml(tr('death.permadeath'))}</div>
        <div class="death-subtext">${this._escapeHtml(tr('death.save_erased'))}</div>
        <div class="death-actions">
          <button class="pregame-btn death-dismiss-btn">${this._escapeHtml(tr('death.continue'))}</button>
        </div>`;
    } else if (data.resurrectionOffered) {
      actions = `
        <div class="death-prompt">${this._escapeHtml(data.resurrectionPrompt || tr('death.prompt_default'))}</div>
        <div class="death-actions">
          <button class="pregame-btn death-resurrect-btn">${this._escapeHtml(tr('death.resurrect_yes'))}</button>
          <button class="pregame-btn death-decline-btn">${this._escapeHtml(tr('death.resurrect_no'))}</button>
        </div>`;
    }

    overlay.innerHTML = `
      <div class="death-card">
        <div class="death-tombstone">☠</div>
        <div class="death-title">${this._escapeHtml(tr('death.banner'))}</div>
        <div class="death-killer">${this._escapeHtml(tr('death.killed_by'))} ${this._escapeHtml(data.killedBy || 'unknown')}</div>
        ${losses.length > 0 ? `<div class="death-losses">${losses.join('')}</div>` : ''}
        ${farewells}
        ${actions}
      </div>
    `;

    const resBtn = overlay.querySelector('.death-resurrect-btn');
    if (resBtn) resBtn.addEventListener('click', () => this._sendInput('Y'));
    const decBtn = overlay.querySelector('.death-decline-btn');
    if (decBtn) decBtn.addEventListener('click', () => this._sendInput('N'));
    const dismissBtn = overlay.querySelector('.death-dismiss-btn');
    if (dismissBtn) dismissBtn.addEventListener('click', () => this._sendInput(''));

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderAchievementToast(data) {
    // Toast-style notification — stack in top-right, auto-dismiss after 5s.
    if (!this._toastStack) {
      this._toastStack = document.createElement('div');
      this._toastStack.className = 'gui-toast-stack';
      document.body.appendChild(this._toastStack);
    }
    // Phase 9 perf pass: cap toast stack to prevent unbounded DOM growth
    // when many achievements unlock at once (e.g. NG+ rerun).
    while (this._toastStack.children.length >= 5) {
      this._toastStack.removeChild(this._toastStack.firstChild);
    }
    const toast = document.createElement('div');
    const tier = (data.tier || 'Bronze').toLowerCase();
    toast.className = `gui-toast achievement-toast achievement-tier-${tier}`;

    const rewards = [];
    if (data.goldReward) rewards.push(`+${this._formatNumber(data.goldReward)}g`);
    if (data.xpReward) rewards.push(`+${this._formatNumber(data.xpReward)} XP`);
    if (data.fameReward) rewards.push(`+${data.fameReward} Fame`);

    toast.innerHTML = `
      <div class="achievement-toast-header">
        <span class="achievement-toast-icon">🏆</span>
        <span class="achievement-toast-tier">${this._escapeHtml(data.tier || '')}</span>
        ${data.isBroadcast ? '<span class="achievement-toast-broadcast">BROADCAST</span>' : ''}
      </div>
      <div class="achievement-toast-name">${this._escapeHtml(data.name || '')}</div>
      ${data.description ? `<div class="achievement-toast-desc">${this._escapeHtml(data.description)}</div>` : ''}
      ${rewards.length > 0 ? `<div class="achievement-toast-rewards">${rewards.join(' • ')}</div>` : ''}
    `;

    this._toastStack.appendChild(toast);
    // Slide-in animation, then auto-dismiss
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 500);
    }, 5000);
  }

  _renderEnding(data) {
    // Full-screen end card with title, final stats, scrolling credits/epilogue.
    // Stays up until the C# side emits the next overlay (NG+ prompt or
    // immortal ascension), at which point that overlay supersedes it.
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay ending-overlay';
    overlay.classList.add(`ending-${(data.endingType || '').toLowerCase()}`);

    const epilogue = (Array.isArray(data.epilogue) && data.epilogue.length > 0)
      ? '<div class="ending-epilogue">' + data.epilogue.map(p => `<p>${this._escapeHtml(p)}</p>`).join('') + '</div>'
      : '';
    const credits = (Array.isArray(data.credits) && data.credits.length > 0)
      ? '<div class="ending-credits">' + data.credits.map(c => `<div>${this._escapeHtml(c)}</div>`).join('') + '</div>'
      : '';

    overlay.innerHTML = `
      <div class="ending-card">
        <div class="ending-banner">${this._escapeHtml(data.title || 'The End')}</div>
        ${data.subtitle ? `<div class="ending-subtitle">${this._escapeHtml(data.subtitle)}</div>` : ''}
        <div class="ending-stats">
          <div class="ending-stat"><span>Final Level</span><strong>${data.finalLevel}</strong></div>
          <div class="ending-stat"><span>Total Kills</span><strong>${this._formatNumber(data.totalKills)}</strong></div>
          <div class="ending-stat"><span>Final Gold</span><strong>${this._formatNumber(data.totalGold)}</strong></div>
          <div class="ending-stat"><span>Fame</span><strong>${data.fameFinal}</strong></div>
          <div class="ending-stat"><span>Cycle</span><strong>${data.cycleNumber}</strong></div>
        </div>
        ${epilogue}
        ${credits}
      </div>
    `;

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderNgPlusPrompt(data) {
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay ngplus-overlay';
    const bonuses = (Array.isArray(data.carryoverBonuses) && data.carryoverBonuses.length > 0)
      ? '<ul class="ngplus-bonuses">' + data.carryoverBonuses.map(b => `<li>${this._escapeHtml(b)}</li>`).join('') + '</ul>'
      : '';
    overlay.innerHTML = `
      <div class="ngplus-card">
        <div class="ngplus-banner">A NEW CYCLE BEGINS</div>
        <div class="ngplus-cycle">Cycle ${data.currentCycle} → Cycle ${data.nextCycle}</div>
        ${bonuses}
        <div class="ngplus-prompt">Begin a new game cycle?</div>
        <div class="ngplus-actions">
          <button class="pregame-btn ngplus-yes">Begin (Y)</button>
          <button class="pregame-btn ngplus-no">Decline (N)</button>
        </div>
      </div>
    `;
    overlay.querySelector('.ngplus-yes').addEventListener('click', () => this._sendInput('Y'));
    overlay.querySelector('.ngplus-no').addEventListener('click', () => this._sendInput('N'));
    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderImmortalAscension(data) {
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay ascension-overlay';
    const dialogue = (Array.isArray(data.manweDialogue) && data.manweDialogue.length > 0)
      ? '<div class="ascension-dialogue">' + data.manweDialogue.map(l => `<p>${this._escapeHtml(l)}</p>`).join('') + '</div>'
      : '';
    const benefits = (Array.isArray(data.benefits) && data.benefits.length > 0)
      ? '<ul class="ascension-benefits">' + data.benefits.map(b => `<li>${this._escapeHtml(b)}</li>`).join('') + '</ul>'
      : '';
    const blocked = data.blockedReason
      ? `<div class="ascension-blocked">${this._escapeHtml(data.blockedMessage || 'You cannot ascend at this time.')}</div>`
      : '';

    overlay.innerHTML = `
      <div class="ascension-card">
        <div class="ascension-banner">★ ASCENSION ★</div>
        <div class="ascension-character">${this._escapeHtml(data.characterName || '')} ${data.className ? '— ' + this._escapeHtml(data.className) : ''}</div>
        ${dialogue}
        ${benefits}
        ${blocked}
        <div class="ascension-prompt">Ascend to godhood?</div>
        <div class="ngplus-actions">
          <button class="pregame-btn ascend-yes">Ascend (Y)</button>
          <button class="pregame-btn ascend-no">Decline (N)</button>
        </div>
      </div>
    `;
    overlay.querySelector('.ascend-yes').addEventListener('click', () => this._sendInput('Y'));
    overlay.querySelector('.ascend-no').addEventListener('click', () => this._sendInput('N'));
    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderBossPhaseTransition(data) {
    // Transient cinematic banner — auto-dismisses after 3.5s. Combat continues
    // on the C# side immediately, so we don't block input.
    const banner = document.createElement('div');
    banner.className = 'gui-overlay boss-phase-overlay';
    const dialogue = (Array.isArray(data.dialogue) && data.dialogue.length > 0)
      ? '<div class="boss-phase-dialogue">' + data.dialogue.map(d => `<p>${this._escapeHtml(d)}</p>`).join('') + '</div>'
      : '';
    const immune = [];
    if (data.isPhysicalImmune) immune.push('PHYSICAL IMMUNITY');
    if (data.isMagicalImmune) immune.push('MAGICAL IMMUNITY');
    const immuneHtml = immune.length > 0
      ? `<div class="boss-phase-immune">${immune.join(' • ')}</div>` : '';

    const tr = (window.i18n && window.i18n.t) || ((k, ...a) => k);
    banner.innerHTML = `
      <div class="boss-phase-card">
        <div class="boss-phase-name">${this._escapeHtml(data.bossName || '')}</div>
        <div class="boss-phase-banner">${this._escapeHtml(tr('boss_phase.banner', data.newPhase))}</div>
        ${dialogue}
        <div class="boss-phase-flavor">${this._escapeHtml(data.flavorText || '')}</div>
        ${immuneHtml}
      </div>
    `;
    document.body.appendChild(banner);
    setTimeout(() => {
      banner.classList.add('boss-phase-fadeout');
      setTimeout(() => {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      }, 500);
    }, 3500);
  }

  // ─── Phase 8 Online Multiplayer Renderers ───

  _renderChatBroadcast(data) {
    // Always-on chat panel — append message to scrollback. Channel determines
    // styling. Auto-pin to bottom and cap at 200 entries to bound DOM size.
    const tr = (window.i18n && window.i18n.t) || ((k, ...a) => k);
    if (!this._chatPanel) {
      this._chatPanel = document.createElement('div');
      this._chatPanel.className = 'gui-chat-panel';
      this._chatPanel.innerHTML = `
        <div class="chat-panel-header">
          <span class="chat-panel-title">${this._escapeHtml(tr('chat.panel_title'))}</span>
          <button class="chat-panel-toggle" title="Toggle">_</button>
        </div>
        <div class="chat-panel-body"></div>
      `;
      document.body.appendChild(this._chatPanel);
      this._chatPanel.querySelector('.chat-panel-toggle').addEventListener('click', () => {
        this._chatPanel.classList.toggle('chat-panel-collapsed');
      });
    }

    const body = this._chatPanel.querySelector('.chat-panel-body');
    const channel = (data.channel || 'gossip').toLowerCase();
    const sender = this._escapeHtml(data.sender || '');
    const message = this._escapeHtml(data.message || '');
    const target = data.targetName ? this._escapeHtml(data.targetName) : null;

    let prefix = '';
    if (channel === 'shout') prefix = `${sender} ${this._escapeHtml(tr('chat.shouts'))}`;
    else if (channel === 'gossip') prefix = `${sender} ${this._escapeHtml(tr('chat.gossips'))}`;
    else if (channel === 'guild') prefix = `${this._escapeHtml(tr('chat.guild'))} ${sender}:`;
    else if (channel === 'tell' && data.perspective === 'actor' && target)
      prefix = this._escapeHtml(tr('chat.tells_actor', target));
    else if (channel === 'tell') prefix = this._escapeHtml(tr('chat.tells_observer', sender));
    else prefix = `${sender}:`;

    const line = document.createElement('div');
    line.className = `chat-line chat-channel-${channel}`;
    if (data.perspective === 'actor') line.classList.add('chat-actor');
    line.innerHTML = `<span class="chat-prefix">${prefix}</span> <span class="chat-text">${message}</span>`;
    body.appendChild(line);

    // Cap scrollback
    while (body.children.length > 200) body.removeChild(body.firstChild);
    body.scrollTop = body.scrollHeight;
  }

  _renderGroupInvite(data) {
    // Modal with countdown timer. Accept sends "/accept", Decline sends "/deny".
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay group-invite-overlay';
    const timeoutSec = data.timeoutSeconds || 60;
    const tr = (window.i18n && window.i18n.t) || ((k, ...a) => k);
    overlay.innerHTML = `
      <div class="group-invite-card">
        <div class="group-invite-banner">${this._escapeHtml(tr('group_invite.banner'))}</div>
        <div class="group-invite-body">
          <strong>${this._escapeHtml(data.fromName || tr('chat.someone'))}</strong>
          ${this._escapeHtml(tr('group_invite.body'))}
        </div>
        <div class="group-invite-meta">
          ${this._escapeHtml(tr('group_invite.group_size', data.currentSize || 1, data.maxSize || 4))}
        </div>
        <div class="group-invite-countdown" data-timeout="${timeoutSec}">${this._escapeHtml(tr('group_invite.countdown', timeoutSec))}</div>
        <div class="ngplus-actions">
          <button class="pregame-btn group-invite-accept">${this._escapeHtml(tr('group_invite.accept'))}</button>
          <button class="pregame-btn group-invite-decline">${this._escapeHtml(tr('group_invite.decline'))}</button>
        </div>
      </div>
    `;

    overlay.querySelector('.group-invite-accept').addEventListener('click', () => {
      this._sendInput('/accept');
      this._dismissPregameOverlay();
    });
    overlay.querySelector('.group-invite-decline').addEventListener('click', () => {
      this._sendInput('/deny');
      this._dismissPregameOverlay();
    });

    // Countdown timer
    const countdownEl = overlay.querySelector('.group-invite-countdown');
    let remaining = timeoutSec;
    const tick = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(tick);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        return;
      }
      countdownEl.textContent = tr('group_invite.countdown', remaining);
    }, 1000);

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderNewsFeed(data) {
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay news-feed-overlay';

    const sectionsHtml = (Array.isArray(data.sections) && data.sections.length > 0)
      ? data.sections.map(s => {
          const items = (s.items || []).map(item => {
            const cls = item.isGood ? 'news-good' : item.isBad ? 'news-bad' : '';
            const gold = item.goldDelta != null && item.goldDelta !== 0
              ? ` <span class="news-gold">${item.goldDelta > 0 ? '+' : ''}${this._formatNumber(item.goldDelta)}g</span>` : '';
            return `<div class="news-item ${cls}">${this._escapeHtml(item.text)}${gold}</div>`;
          }).join('');
          return `
            <div class="news-section">
              <div class="news-section-title">${this._escapeHtml(s.title)}</div>
              ${items}
            </div>`;
        }).join('')
      : `<div class="news-empty">${this._escapeHtml((window.i18n && window.i18n.t('news_feed.empty')) || 'All quiet on the world front.')}</div>`;

    const tr = (window.i18n && window.i18n.t) || ((k, ...a) => k);
    const counts = [];
    if (data.unreadMailCount) counts.push(this._escapeHtml(tr('news_feed.unread_mail', data.unreadMailCount)));
    if (data.pendingTradeCount) counts.push(this._escapeHtml(tr('news_feed.pending_trade', data.pendingTradeCount)));
    const countsHtml = counts.length > 0
      ? `<div class="news-counts">${counts.join(' · ')}</div>` : '';

    overlay.innerHTML = `
      <div class="news-feed-card">
        <div class="news-feed-header">
          <div class="news-feed-title">${this._escapeHtml(tr('news_feed.title'))}</div>
          <div class="news-feed-character">${this._escapeHtml(data.characterName || '')}</div>
        </div>
        ${countsHtml}
        <div class="news-feed-body">${sectionsHtml}</div>
        <div class="news-feed-actions">
          <button class="pregame-btn news-feed-dismiss">${this._escapeHtml(tr('news_feed.continue'))}</button>
        </div>
      </div>
    `;
    overlay.querySelector('.news-feed-dismiss').addEventListener('click', () => {
      this._sendInput('');
      this._dismissPregameOverlay();
    });

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderSpectateRequest(data) {
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay spectate-request-overlay';
    const timeoutSec = data.timeoutSeconds || 60;
    const tr = (window.i18n && window.i18n.t) || ((k, ...a) => k);
    overlay.innerHTML = `
      <div class="spectate-request-card">
        <div class="spectate-request-banner">${this._escapeHtml(tr('spectate.banner'))}</div>
        <div class="spectate-request-body">
          <strong>${this._escapeHtml(data.fromName || tr('chat.someone'))}</strong>
          ${this._escapeHtml(tr('spectate.body'))}
        </div>
        <div class="group-invite-countdown" data-timeout="${timeoutSec}">${this._escapeHtml(tr('group_invite.countdown', timeoutSec))}</div>
        <div class="ngplus-actions">
          <button class="pregame-btn spectate-accept">${this._escapeHtml(tr('spectate.allow'))}</button>
          <button class="pregame-btn spectate-decline">${this._escapeHtml(tr('spectate.deny'))}</button>
        </div>
      </div>
    `;
    overlay.querySelector('.spectate-accept').addEventListener('click', () => {
      this._sendInput('/accept');
      this._dismissPregameOverlay();
    });
    overlay.querySelector('.spectate-decline').addEventListener('click', () => {
      this._sendInput('/deny');
      this._dismissPregameOverlay();
    });
    const countdownEl = overlay.querySelector('.group-invite-countdown');
    let remaining = timeoutSec;
    const tick = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(tick);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        return;
      }
      countdownEl.textContent = `${remaining}s remaining`;
    }, 1000);

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderSpectatorState(data) {
    // Persistent indicator showing watcher count or "watching" status.
    if (!this._spectatorIndicator) {
      this._spectatorIndicator = document.createElement('div');
      this._spectatorIndicator.className = 'gui-spectator-indicator';
      document.body.appendChild(this._spectatorIndicator);
    }
    const watchers = Array.isArray(data.watchers) ? data.watchers : [];
    if (data.watchingTarget) {
      this._spectatorIndicator.innerHTML = `👁 Watching <strong>${this._escapeHtml(data.watchingTarget)}</strong>`;
      this._spectatorIndicator.classList.add('spectator-active');
    } else if (watchers.length > 0) {
      this._spectatorIndicator.innerHTML = `👁 ${watchers.length} watching`;
      this._spectatorIndicator.title = watchers.join(', ');
      this._spectatorIndicator.classList.add('spectator-active');
    } else {
      this._spectatorIndicator.classList.remove('spectator-active');
      this._spectatorIndicator.innerHTML = '';
    }
  }

  // ─── Phase 9 Settings + Polish Renderers ────

  _renderSettings(data) {
    const overlay = document.createElement('div');
    overlay.className = 'gui-overlay settings-overlay';

    const langs = Array.isArray(data.availableLanguages) ? data.availableLanguages : [];
    const langOptions = langs.map(l => {
      const sel = l.isCurrent ? ' selected' : '';
      return `<option value="${this._escapeHtml(l.code)}"${sel}>${this._escapeHtml(l.displayName)}</option>`;
    }).join('');

    const tr = (window.i18n && window.i18n.t) || ((k) => k);
    overlay.innerHTML = `
      <div class="settings-card">
        <div class="settings-title-bar">
          <div class="settings-title">${this._escapeHtml(tr('settings.title'))}</div>
          <button class="settings-close" title="Close">×</button>
        </div>
        <div class="settings-body">
          <div class="settings-row">
            <label class="settings-label" for="settings-language">${this._escapeHtml(tr('settings.label.language'))}</label>
            <select class="settings-select" id="settings-language">${langOptions}</select>
          </div>
          <div class="settings-row">
            <label class="settings-label" for="settings-font-scale">${this._escapeHtml(tr('settings.label.font_scale'))}</label>
            <input type="range" class="settings-slider" id="settings-font-scale"
              min="0.85" max="1.4" step="0.05" value="${this._fontScale || 1.0}">
            <span class="settings-value" id="settings-font-scale-value">${(this._fontScale || 1.0).toFixed(2)}×</span>
          </div>
          <div class="settings-row">
            <label class="settings-label settings-toggle-label" for="settings-sr">
              <input type="checkbox" id="settings-sr" ${data.screenReaderMode ? 'checked' : ''}>
              ${this._escapeHtml(tr('settings.toggle.screen_reader'))}
            </label>
          </div>
          <div class="settings-row">
            <label class="settings-label settings-toggle-label" for="settings-compact">
              <input type="checkbox" id="settings-compact" ${data.compactMode ? 'checked' : ''}>
              ${this._escapeHtml(tr('settings.toggle.compact'))}
            </label>
          </div>
          <div class="settings-row">
            <label class="settings-label settings-toggle-label" for="settings-art">
              <input type="checkbox" id="settings-art" ${!data.disableCharacterMonsterArt ? 'checked' : ''}>
              ${this._escapeHtml(tr('settings.toggle.art'))}
            </label>
          </div>
          <div class="settings-row settings-info">
            <div class="settings-info-label">${this._escapeHtml(tr('settings.label.date_format'))}</div>
            <div class="settings-info-value">${this._escapeHtml(data.dateFormat || 'MM/DD/YYYY')}</div>
          </div>
        </div>
        <div class="settings-actions">
          <button class="pregame-btn settings-done">${this._escapeHtml(tr('settings.button.done'))}</button>
        </div>
      </div>
    `;

    // Language picker — fires immediately on change. Reload JS-side
    // translations live so overlay buttons localize without a restart.
    overlay.querySelector('#settings-language').addEventListener('change', (e) => {
      const code = e.target.value;
      this._sendInput(`/settings lang ${code}`);
      try { localStorage.setItem('usurper.language', code); } catch {}
      if (window.i18n && window.i18n.setLanguage) {
        window.i18n.setLanguage(code);
      }
    });

    // Font scale — adjusts CSS variable on root, no C# round-trip needed
    const fontSlider = overlay.querySelector('#settings-font-scale');
    const fontVal = overlay.querySelector('#settings-font-scale-value');
    fontSlider.addEventListener('input', (e) => {
      const scale = parseFloat(e.target.value);
      this._fontScale = scale;
      fontVal.textContent = scale.toFixed(2) + '×';
      document.documentElement.style.setProperty('--gui-font-scale', String(scale));
      try { localStorage.setItem('usurper.fontScale', String(scale)); } catch {}
    });

    // Toggle checkboxes — each fires its own /settings sub-command
    overlay.querySelector('#settings-sr').addEventListener('change', (e) => {
      this._sendInput(`/settings sr ${e.target.checked ? 'on' : 'off'}`);
    });
    overlay.querySelector('#settings-compact').addEventListener('change', (e) => {
      this._sendInput(`/settings compact ${e.target.checked ? 'on' : 'off'}`);
    });
    overlay.querySelector('#settings-art').addEventListener('change', (e) => {
      // Inverted: checkbox shows art, but C# stores DisableCharacterMonsterArt
      this._sendInput(`/settings art ${e.target.checked ? 'on' : 'off'}`);
    });

    overlay.querySelector('.settings-close').addEventListener('click', () => {
      this._dismissPregameOverlay();
    });
    overlay.querySelector('.settings-done').addEventListener('click', () => {
      this._dismissPregameOverlay();
    });

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderSettingsAppliedToast(data) {
    if (!this._toastStack) {
      this._toastStack = document.createElement('div');
      this._toastStack.className = 'gui-toast-stack';
      document.body.appendChild(this._toastStack);
    }
    // Cap toast stack to prevent unbounded DOM growth.
    while (this._toastStack.children.length >= 5) {
      this._toastStack.removeChild(this._toastStack.firstChild);
    }
    const toast = document.createElement('div');
    toast.className = 'gui-toast settings-applied-toast';
    toast.innerHTML = `
      <div class="achievement-toast-name">⚙ ${this._escapeHtml(data.settingKey || 'setting')}</div>
      <div class="achievement-toast-desc">Set to: <strong>${this._escapeHtml(data.newValue || '')}</strong></div>
    `;
    this._toastStack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 500);
    }, 2500);
  }

  // ─── Phase 3 Pre-Game Renderers ──────────────

  _renderMainMenu(data) {
    this.screen = 'main_menu';
    this.compass.style.display = 'none';
    this.roomActions.innerHTML = '';
    this.npcArea.innerHTML = '';

    // Splash + version + clickable menu buttons.
    const overlay = document.createElement('div');
    overlay.className = 'pregame-overlay main-menu-overlay';
    overlay.innerHTML = `
      <div class="main-menu-card">
        <div class="main-menu-title">${this._escapeHtml(data.title || 'Usurper Reborn')}</div>
        <div class="main-menu-subtitle">${this._escapeHtml(data.subtitle || '')}</div>
        <div class="main-menu-version">${this._escapeHtml(data.version || '')}</div>
        <div class="main-menu-buttons"></div>
      </div>
    `;
    const buttonContainer = overlay.querySelector('.main-menu-buttons');
    for (const item of (data.items || [])) {
      const btn = document.createElement('button');
      btn.className = `pregame-btn main-menu-btn cat-${item.category || 'default'}`;
      btn.innerHTML = `<span class="key">[${this._escapeHtml(item.key)}]</span> <span class="label">${this._escapeHtml(item.label)}</span>`;
      btn.onclick = () => {
        this._sendInput(item.key);
        this._dismissPregameOverlay();
      };
      buttonContainer.appendChild(btn);
    }

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderSaveList(data) {
    this.screen = 'save_list';
    const overlay = document.createElement('div');
    overlay.className = 'pregame-overlay save-list-overlay';
    overlay.innerHTML = `
      <div class="save-list-card">
        <div class="save-list-title">Choose a Character</div>
        ${data.accountName ? `<div class="save-list-account">${this._escapeHtml(data.accountName)}</div>` : ''}
        <div class="save-list-slots"></div>
        <div class="save-list-actions"></div>
      </div>
    `;

    const slotsContainer = overlay.querySelector('.save-list-slots');
    for (const slot of (data.slots || [])) {
      const slotEl = document.createElement('div');
      let badgeClass = '';
      let badge = '';
      if (slot.isEmergency) { badgeClass = 'badge-emergency'; badge = 'EMERGENCY SAVE'; }
      else if (slot.isRecovered) { badgeClass = 'badge-recovery'; badge = 'RECOVERY'; }
      slotEl.className = `save-slot-card ${badgeClass}`;

      const lastPlayed = slot.lastPlayed
        ? new Date(slot.lastPlayed).toLocaleString()
        : '';
      slotEl.innerHTML = `
        <div class="save-slot-portrait class-${(slot.className || '').toLowerCase().replace(/\s+/g, '-')}"></div>
        <div class="save-slot-info">
          <div class="save-slot-name">${this._escapeHtml(slot.characterName)}${badge ? ` <span class="save-slot-badge">${badge}</span>` : ''}</div>
          <div class="save-slot-meta">Lv. ${slot.level} ${this._escapeHtml(slot.className)}</div>
          ${lastPlayed ? `<div class="save-slot-played">${this._escapeHtml(lastPlayed)}</div>` : ''}
        </div>
        <div class="save-slot-key">[${this._escapeHtml(slot.slotKey)}]</div>
      `;
      slotEl.onclick = () => {
        this._sendInput(slot.slotKey);
        this._dismissPregameOverlay();
      };
      slotsContainer.appendChild(slotEl);
    }

    const actionsContainer = overlay.querySelector('.save-list-actions');
    for (const action of (data.actions || [])) {
      const btn = document.createElement('button');
      btn.className = `pregame-btn save-list-btn cat-${action.category || 'default'}`;
      btn.innerHTML = `<span class="key">[${this._escapeHtml(action.key)}]</span> <span class="label">${this._escapeHtml(action.label)}</span>`;
      btn.onclick = () => {
        this._sendInput(action.key);
        this._dismissPregameOverlay();
      };
      actionsContainer.appendChild(btn);
    }

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderCharCreateStep(data) {
    // Phase 3: per-step renderers for the character creation wizard. The C# side
    // emits one step at a time; we render a focused overlay per step. Click sends
    // the input back via stdin (same path as text-mode keystrokes).
    this.screen = 'char_create';
    const step = data.step || '';
    const overlay = document.createElement('div');
    overlay.className = `pregame-overlay char-create-overlay step-${step}`;

    let bodyHtml = '';
    switch (step) {
      case 'name':
        bodyHtml = this._buildCharCreateNameBody(data);
        break;
      case 'gender':
        bodyHtml = this._buildCharCreateOptionsBody(data, 'gender-options');
        break;
      case 'orientation':
        bodyHtml = this._buildCharCreateOptionsBody(data, 'orientation-options');
        break;
      case 'difficulty':
        bodyHtml = this._buildCharCreateDifficultyBody(data);
        break;
      case 'race':
        bodyHtml = this._buildCharCreateRaceBody(data);
        break;
      case 'class':
        bodyHtml = this._buildCharCreateClassBody(data);
        break;
      case 'stats':
        bodyHtml = this._buildCharCreateStatsBody(data);
        break;
      case 'summary':
        bodyHtml = this._buildCharCreateSummaryBody(data);
        break;
      default:
        bodyHtml = `<div class="char-create-hint">Use the input below to continue.</div>`;
    }

    overlay.innerHTML = `
      <div class="char-create-card">
        <div class="char-create-step-label">${this._escapeHtml(step)}</div>
        <div class="char-create-title">${this._escapeHtml(data.title || '')}</div>
        ${data.description ? `<div class="char-create-description">${this._escapeHtml(data.description)}</div>` : ''}
        ${bodyHtml}
      </div>
    `;

    // Wire up button click handlers that send their data-key via stdin.
    overlay.querySelectorAll('[data-cc-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-cc-key');
        this._sendInput(key);
        // Don't dismiss the overlay yet — the next emit (next step or re-prompt)
        // will replace it. Premature dismissal would briefly show terminal pane.
      });
    });

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _buildCharCreateNameBody(data) {
    // Plain message + a submit button that uses the existing input box.
    // (Free-text name entry uses the bottom input bar; clicking submit sends Enter.)
    return `
      <div class="char-create-hint">Type your character's name in the input below and press Enter.</div>
    `;
  }

  _buildCharCreateOptionsBody(data, extraClass = '') {
    // Generic horizontal options for gender/orientation pickers.
    const opts = (data.data && data.data.options) || [];
    let html = `<div class="char-create-options ${this._escapeHtml(extraClass)}">`;
    for (const opt of opts) {
      html += `
        <button class="pregame-btn char-create-option-btn" data-cc-key="${this._escapeHtml(opt.key)}">
          <span class="key">[${this._escapeHtml(opt.key)}]</span>
          <span class="label">${this._escapeHtml(opt.label)}</span>
        </button>
      `;
    }
    html += `</div>`;
    return html;
  }

  _buildCharCreateDifficultyBody(data) {
    const opts = (data.data && data.data.options) || [];
    let html = `<div class="char-create-difficulty">`;
    for (const opt of opts) {
      html += `
        <button class="pregame-btn char-create-difficulty-btn" data-cc-key="${this._escapeHtml(opt.key)}" style="border-color: ${this._cssColor(opt.color)};">
          <div class="diff-key" style="color: ${this._cssColor(opt.color)};">[${this._escapeHtml(opt.key)}]</div>
          <div class="diff-name" style="color: ${this._cssColor(opt.color)};">${this._escapeHtml(opt.label)}</div>
          <div class="diff-desc">${this._escapeHtml(opt.description || '')}</div>
        </button>
      `;
    }
    html += `</div>`;
    return html;
  }

  _buildCharCreateRaceBody(data) {
    const races = (data.data && data.data.races) || [];
    let html = `<div class="char-create-race-grid">`;
    for (const r of races) {
      // Map race name to portrait. We use the existing class portraits dir
      // for now since race portraits aren't graphical-pipeline assets yet —
      // the C# RacePortraits.cs has ANSI art only. Phase 3.5 / Phase 9
      // polish will add proper race portraits to the asset library.
      const raceKey = (r.race || '').toLowerCase();
      const classCount = (r.availableClasses || []).length;
      const flavor = r.suffix === 'regen' ? '* regenerates'
                   : r.suffix === 'poison_bite' ? '* poison bite'
                   : '';
      html += `
        <button class="pregame-btn char-create-race-card" data-cc-key="${this._escapeHtml(r.key)}">
          <div class="race-portrait race-${this._escapeHtml(raceKey)}"></div>
          <div class="race-key">[${this._escapeHtml(r.key)}]</div>
          <div class="race-name">${this._escapeHtml(r.name)}</div>
          <div class="race-meta">${classCount} classes${flavor ? ` · ${flavor}` : ''}</div>
        </button>
      `;
    }
    html += `
      <button class="pregame-btn char-create-race-card race-action" data-cc-key="H">
        <div class="race-key">[H]</div>
        <div class="race-name">Help</div>
      </button>
      <button class="pregame-btn char-create-race-card race-action" data-cc-key="A">
        <div class="race-key">[A]</div>
        <div class="race-name">Abort</div>
      </button>
    </div>`;
    return html;
  }

  _buildCharCreateClassBody(data) {
    const classes = (data.data && data.data.classes) || [];
    let baseHtml = '';
    let prestigeHtml = '';
    for (const c of classes) {
      const classKey = (c.class || '').toLowerCase().replace(/\s+/g, '-');
      const cardHtml = `
        <button class="pregame-btn char-create-class-card ${c.tier === 'prestige' ? 'prestige' : ''} ${c.restricted ? 'restricted' : ''}"
                data-cc-key="${this._escapeHtml(c.key || '')}"
                ${c.restricted || !c.key ? 'disabled' : ''}>
          <div class="class-portrait class-${this._escapeHtml(classKey)}"></div>
          ${c.key ? `<div class="class-key">[${this._escapeHtml(c.key)}]</div>` : '<div class="class-key locked">LOCKED</div>'}
          <div class="class-name">${this._escapeHtml(c.name)}</div>
          ${c.description ? `<div class="class-desc">${this._escapeHtml(c.description)}</div>` : ''}
          ${c.unlockReq ? `<div class="class-unlock-req">${this._escapeHtml(c.unlockReq)}</div>` : ''}
        </button>
      `;
      if (c.tier === 'prestige') prestigeHtml += cardHtml;
      else baseHtml += cardHtml;
    }
    return `
      <div class="char-create-class-grid">${baseHtml}</div>
      ${prestigeHtml ? `
        <div class="char-create-prestige-header">Prestige Classes (NG+)</div>
        <div class="char-create-class-grid prestige">${prestigeHtml}</div>
      ` : ''}
      <div class="char-create-class-actions">
        <button class="pregame-btn class-action" data-cc-key="H">[H] Help</button>
        <button class="pregame-btn class-action" data-cc-key="A">[A] Abort</button>
      </div>
    `;
  }

  _buildCharCreateStatsBody(data) {
    const d = data.data || {};
    const stats = d.stats || {};
    const rerollsRemaining = d.rerollsRemaining ?? 0;
    const total = d.totalStats ?? 0;
    const totalClass = total >= 70 ? 'good' : total >= 55 ? 'mid' : 'low';

    const statRows = [
      ['HP',      `${stats.hp}/${stats.maxHp}`],
      ['STR',     stats.strength],
      ['DEF',     stats.defence],
      ['STA',     stats.stamina],
      ['AGI',     stats.agility],
      ['DEX',     stats.dexterity],
      ['CON',     stats.constitution],
      ['INT',     stats.intelligence],
      ['WIS',     stats.wisdom],
      ['CHA',     stats.charisma],
    ];
    if (stats.maxMana > 0) {
      statRows.push(['MANA', `${stats.mana}/${stats.maxMana}`]);
    }

    let rowsHtml = statRows.map(([label, value]) => `
      <div class="stat-row">
        <span class="stat-label">${label}</span>
        <span class="stat-value">${value}</span>
      </div>
    `).join('');

    return `
      <div class="char-create-stats">
        <div class="stats-meta">
          <span class="stats-class">${this._escapeHtml(d.className || '')}</span>
          <span class="stats-race">${this._escapeHtml(d.raceName || '')}</span>
        </div>
        <div class="stats-grid">${rowsHtml}</div>
        <div class="stats-total ${totalClass}">Total: ${total}</div>
        <div class="stats-rerolls">Rerolls remaining: ${rerollsRemaining}</div>
        <div class="stats-actions">
          <button class="pregame-btn stats-accept-btn" data-cc-key="A">[A] Accept</button>
          ${rerollsRemaining > 0 ? `<button class="pregame-btn stats-reroll-btn" data-cc-key="R">[R] Reroll</button>` : ''}
        </div>
      </div>
    `;
  }

  _buildCharCreateSummaryBody(data) {
    const d = data.data || {};
    return `
      <div class="char-create-summary">
        <div class="summary-name">${this._escapeHtml(d.name || '')}</div>
        <div class="summary-class-race">Lv.${d.level} ${this._escapeHtml(d.race || '')} ${this._escapeHtml(d.className || '')}</div>
        <div class="summary-section">
          <div class="summary-row"><span>HP</span><span>${d.hp}/${d.maxHp}</span></div>
          ${d.maxMana > 0 ? `<div class="summary-row"><span>Mana</span><span>${d.mana}/${d.maxMana}</span></div>` : ''}
          <div class="summary-row"><span>Gold</span><span>${d.gold}</span></div>
          <div class="summary-row"><span>Sex</span><span>${this._escapeHtml(d.sex || '')}</span></div>
        </div>
        <div class="summary-section appearance">
          <div class="summary-row"><span>Eyes</span><span>${this._escapeHtml(d.eyes || '')}</span></div>
          <div class="summary-row"><span>Hair</span><span>${this._escapeHtml(d.hair || '')}</span></div>
          <div class="summary-row"><span>Skin</span><span>${this._escapeHtml(d.skin || '')}</span></div>
        </div>
        <button class="pregame-btn summary-begin-btn" data-cc-key="">Begin Adventure ↵</button>
      </div>
    `;
  }

  // Map color names from C# DifficultySystem.GetColor to CSS hex values.
  _cssColor(name) {
    const map = {
      'bright_green': '#80d080',
      'bright_yellow': '#f0d68c',
      'yellow': '#d4b040',
      'bright_red': '#d04040',
      'red': '#a04040',
      'green': '#508050',
      'cyan': '#80a0c0',
      'bright_cyan': '#a0c0e0',
      'magenta': '#c080c0',
      'white': '#d4c194',
      'gray': '#808080',
    };
    return map[name] || '#d4c194';
  }

  _renderRecoveryMenu(data) {
    this.screen = 'recovery';
    const overlay = document.createElement('div');
    overlay.className = 'pregame-overlay recovery-menu-overlay';
    overlay.innerHTML = `
      <div class="recovery-menu-card">
        <div class="recovery-menu-title">Save Load Failed</div>
        <div class="recovery-menu-error">${this._escapeHtml(data.errorMessage || '')}</div>
        ${data.saveFolderPath ? `<div class="recovery-menu-folder">${this._escapeHtml(data.saveFolderPath)}</div>` : ''}
        ${(data.files && data.files.length > 0)
          ? '<div class="recovery-menu-section-title">Recovery Files</div><div class="recovery-menu-files"></div>'
          : '<div class="recovery-menu-section-title">No backup or autosave files found</div>'}
        <div class="recovery-menu-actions"></div>
      </div>
    `;
    const filesEl = overlay.querySelector('.recovery-menu-files');
    if (filesEl) {
      for (const f of (data.files || [])) {
        const sizeMb = f.sizeBytes > 0 ? ` (${(f.sizeBytes / 1048576).toFixed(1)} MB)` : '';
        const btn = document.createElement('button');
        btn.className = 'pregame-btn recovery-file-btn';
        btn.innerHTML = `<span class="key">[${this._escapeHtml(f.key)}]</span> <span class="label">${this._escapeHtml(f.label)}${sizeMb}</span>`;
        btn.onclick = () => {
          this._sendInput(f.key);
          // Don't dismiss yet — recovery flow may re-emit on failure.
        };
        filesEl.appendChild(btn);
      }
    }
    const actionsEl = overlay.querySelector('.recovery-menu-actions');
    if (data.offerAutoRepair) {
      const repairBtn = document.createElement('button');
      repairBtn.className = 'pregame-btn recovery-repair-btn';
      repairBtn.innerHTML = `<span class="key">[R]</span> <span class="label">Auto-repair the bloated save file (recommended)</span>`;
      repairBtn.onclick = () => this._sendInput('R');
      actionsEl.appendChild(repairBtn);
    }
    const newBtn = document.createElement('button');
    newBtn.className = 'pregame-btn recovery-new-btn';
    newBtn.innerHTML = `<span class="key">[N]</span> <span class="label">Start a NEW character (overwrites broken save)</span>`;
    newBtn.onclick = () => this._sendInput('N');
    actionsEl.appendChild(newBtn);

    const quitBtn = document.createElement('button');
    quitBtn.className = 'pregame-btn recovery-quit-btn';
    quitBtn.innerHTML = `<span class="key">[Q]</span> <span class="label">Return to main menu</span>`;
    quitBtn.onclick = () => this._sendInput('Q');
    actionsEl.appendChild(quitBtn);

    this._dismissPregameOverlay();
    document.body.appendChild(overlay);
    this._currentPregameOverlay = overlay;
  }

  _renderOpeningNarration(data) {
    // Phase 7 (lifecycle events) will replace this with a proper themed
    // narration panel. For now emit-only acknowledgement.
    this._toast([{ text: data.text || '', fg: '#c0a050', bold: false }], 'narration');
  }

  _dismissPregameOverlay() {
    if (this._currentPregameOverlay && this._currentPregameOverlay.parentNode) {
      this._currentPregameOverlay.parentNode.removeChild(this._currentPregameOverlay);
    }
    this._currentPregameOverlay = null;
  }

  _sendInput(text) {
    // Send a key/string + newline through the same IPC the regular input box uses.
    // The C# side reads it from stdin as if it had been typed.
    if (window.usurper && window.usurper.sendInput) {
      window.usurper.sendInput(text + '\n');
    }
  }

  _escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _addNPCTagFromEvent(npc) {
    const tag = document.createElement('div');
    tag.className = 'gui-npc-tag';
    tag.textContent = `${npc.name}`;
    if (npc.class) tag.title = `Lv.${npc.level || '?'} ${npc.class}`;
    this.npcArea.appendChild(tag);
  }

  _renderDockFromServer(items) {
    this.dock.innerHTML = '';

    // Group by category
    const categories = {};
    for (const item of items) {
      const cat = item.category || 'other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(item);
    }

    // Icon map for building types
    const iconMap = {
      dungeon: '⚔', inn: '🍺', weapons: '🗡', armor: '🛡', magic: '✨',
      music: '🎵', bank: '🏦', healer: '💊', temple: '⛪', wilderness: '🌲',
      outskirts: '🏕', training: '📖', quests: '📜', home: '🏠',
      status: '📊', quit: '🚪',
    };

    const catOrder = ['explore', 'services', 'progress', 'info'];
    let first = true;

    for (const cat of catOrder) {
      const catItems = categories[cat];
      if (!catItems || catItems.length === 0) continue;

      if (!first) {
        const divider = document.createElement('div');
        divider.className = 'gui-dock-divider';
        this.dock.appendChild(divider);
      }
      first = false;

      const sectionEl = document.createElement('div');
      sectionEl.className = 'gui-dock-section';

      for (const item of catItems) {
        const icon = iconMap[item.icon] || '📍';
        const btn = document.createElement('div');
        btn.className = 'gui-building';
        btn.innerHTML = `
          <span class="gui-building-key">${item.key}</span>
          <span class="gui-building-icon">${icon}</span>
          <span class="gui-building-name">${item.label}</span>
        `;
        btn.addEventListener('click', () => this.sendInput(item.key + '\n'));
        btn.title = `${item.label} [${item.key}]`;
        sectionEl.appendChild(btn);
      }
      this.dock.appendChild(sectionEl);
    }
  }

  // ─── Line Processing ─────────────────────

  processLine(classified) {
    switch (classified.type) {
      case LineType.STATUS_BAR:
        this._updateHUD(classified.data);
        break;

      case LineType.MUD_PROMPT:
        this._setLocation(classified.location);
        break;

      case LineType.MENU_ITEM:
        // Collect menu items from server to know what's available
        if (classified.multi) {
          for (const item of classified.items) {
            this.serverMenuItems.push(item);
          }
        } else {
          this.serverMenuItems.push({ key: classified.key, label: classified.label });
        }
        break;

      case LineType.BOX_TOP:
        break;

      case LineType.BOX_BOTTOM:
        // Flush collected menu to dock
        if (this.serverMenuItems.length > 0) {
          this._updateDockFromServer();
        }
        // Detect location from box title
        if (classified.boxTitle) {
          this._detectLocationFromTitle(classified.boxTitle);
        }
        break;

      case LineType.BOX_LINE:
        if (classified.inner && classified.boxTitle === classified.inner) {
          this._detectLocationFromTitle(classified.inner);
        }
        break;

      case LineType.NPC_ACTIVITY:
        this._addNPCTag(classified.spans);
        this._toast(classified.spans, 'npc');
        break;

      case LineType.LOCATION_DESC:
        this._setSceneDescription(classified.spans);
        break;

      case LineType.SYSTEM_MSG:
        this._toast(classified.spans, 'system');
        break;

      case LineType.COMBAT_HIT:
        this._toast(classified.spans, 'combat');
        break;

      case LineType.COMBAT_HEAL:
        this._toast(classified.spans, 'heal');
        break;

      case LineType.PROMPT:
        if (classified.pressAnyKey) {
          // Show clickable overlay
          this.pressAny.style.display = 'flex';
        }
        break;

      case LineType.EMPTY:
      case LineType.BOX_DIVIDER:
      case LineType.SEPARATOR:
        break;

      default:
        // Regular text — show as toast if it's meaningful
        if (classified.raw && classified.raw.length > 3) {
          this._toast(classified.spans, '');
        }
        break;
    }
  }

  clearScreen() {
    this.serverMenuItems = [];
    this.sceneTitle.textContent = '';
    this.matcher.resetCombat();
    // Reset location so it re-detects
    this.state.location = '';
    // Don't clear npcArea or roomActions during combat — they hold monster cards and action buttons
    if (this.screen !== 'combat') {
      this.npcArea.innerHTML = '';
      this.roomActions.innerHTML = '';
    }
  }

  // ─── HUD ────────────────────────────────

  _updateHUD(data) {
    if (data.hp !== undefined) {
      this.state.hp = data.hp;
      this.state.maxHp = data.maxHp;
      const pct = data.maxHp ? (data.hp / data.maxHp * 100) : 100;
      this.hpBar.style.width = pct + '%';
      this.hpBar.className = 'gui-bar-fill gui-bar-hp' + (pct < 30 ? ' critical' : pct < 60 ? ' warning' : '');
      this.hpText.textContent = `${data.hp.toLocaleString()}/${data.maxHp.toLocaleString()}`;
    }

    if (data.stamina !== undefined) {
      this.resourceLabel.textContent = 'ST';
      this.resourceBar.className = 'gui-bar-fill gui-bar-stamina';
      const pct = data.maxStamina ? (data.stamina / data.maxStamina * 100) : 100;
      this.resourceBar.style.width = pct + '%';
      this.resourceText.textContent = `${data.stamina}/${data.maxStamina}`;
    } else if (data.mana !== undefined) {
      this.resourceLabel.textContent = 'MP';
      this.resourceBar.className = 'gui-bar-fill gui-bar-mana';
      const pct = data.maxMana ? (data.mana / data.maxMana * 100) : 100;
      this.resourceBar.style.width = pct + '%';
      this.resourceText.textContent = `${data.mana}/${data.maxMana}`;
    }

    if (data.gold !== undefined) {
      this.state.gold = data.gold;
      this.goldText.textContent = data.gold.toLocaleString();
    }
    if (data.level !== undefined) {
      this.state.level = data.level;
      this.levelText.textContent = data.level;
    }
  }

  // ─── Location & Scene ───────────────────

  _detectLocationFromTitle(title) {
    const locationNames = [
      'Main Street', 'The Inn', 'The Dungeon', 'Weapon Shop', 'Armor Shop',
      'Magic Shop', 'The Bank', 'The Healer', 'The Temple', 'The Castle',
      'Dark Alley', 'Love Street', 'Quest Hall', 'Level Master', 'Home',
      'Music Shop', 'The Arena', 'The Wilderness', 'The Outskirts',
      'Team Corner', 'The Settlement', 'The Prison', 'The Dormitory',
    ];
    const clean = title.replace(/[^\w\s]/g, '').trim();
    for (const name of locationNames) {
      if (clean.toLowerCase().includes(name.toLowerCase())) {
        this._setLocation(name);
        return;
      }
    }
  }

  _setLocation(name) {
    if (this.state.location === name) return;
    this.state.location = name;
    this.locationText.textContent = name;
    this._applyScene(name);
  }

  _applyScene(name) {
    const loc = name.toLowerCase();
    const scene = this.sceneMap.find(s => s.keywords.some(k => loc.includes(k)));

    if (scene && this.state.currentScene !== scene.image) {
      this.state.currentScene = scene.image;
      this.sceneBg.style.backgroundImage =
        `linear-gradient(to top, rgba(2,2,4,0.5) 0%, transparent 50%),
         url('./assets/scenes/${scene.image}')`;
      this.sceneBg.style.backgroundSize = 'cover, cover';
      this.sceneBg.style.backgroundPosition = 'center, center';
      this.sceneBg.style.backgroundRepeat = 'no-repeat, no-repeat';
      this.sceneBg.style.imageRendering = 'pixelated';
      this.sceneBg.style.filter = scene.filter || '';
    } else if (!scene) {
      this.state.currentScene = null;
      this.sceneBg.style.backgroundImage = '';
      this.sceneBg.style.filter = '';
    }
  }

  _applySceneDirect(imageFile, filter = '') {
    if (this.state.currentScene === imageFile) return;
    this.state.currentScene = imageFile;
    this.sceneBg.style.backgroundImage =
      `linear-gradient(to top, rgba(2,2,4,0.5) 0%, transparent 50%),
       url('./assets/scenes/${imageFile}')`;
    this.sceneBg.style.backgroundSize = 'cover, cover';
    this.sceneBg.style.backgroundPosition = 'center, center';
    this.sceneBg.style.backgroundRepeat = 'no-repeat, no-repeat';
    this.sceneBg.style.imageRendering = 'pixelated';
    this.sceneBg.style.filter = filter;
  }

  _setSceneDescription(spans) {
    const text = spans.map(s => s.text).join('');
    this.sceneTitle.textContent = text;
  }

  // ─── NPC Tags (floating in scene) ───────

  _addNPCTag(spans) {
    // Extract NPC name (usually the first bold/colored span)
    const text = spans.map(s => s.text).join('').trim();
    if (!text) return;

    // Short version for the tag
    const short = text.length > 50 ? text.substring(0, 50) + '…' : text;

    const tag = document.createElement('div');
    tag.className = 'gui-npc-tag';
    tag.textContent = short;
    this.npcArea.appendChild(tag);

    // Max 8 NPC tags
    while (this.npcArea.children.length > 8) {
      this.npcArea.removeChild(this.npcArea.firstChild);
    }
  }

  // ─── Toast Notifications ────────────────

  _toast(spans, type) {
    const div = document.createElement('div');
    div.className = 'gui-toast' + (type ? ` toast-${type}` : '');

    for (const span of spans) {
      if (!span.text) continue;
      const el = document.createElement('span');
      el.textContent = span.text;
      el.style.color = span.fg;
      if (span.bold) el.style.fontWeight = 'bold';
      div.appendChild(el);
    }

    this.toastArea.appendChild(div);

    // Max 6 visible toasts
    while (this.toastArea.children.length > 6) {
      this.toastArea.removeChild(this.toastArea.firstChild);
    }

    // Auto-remove after animation completes
    setTimeout(() => {
      if (div.parentNode) div.remove();
    }, 6000);
  }

  // ─── Building Dock ──────────────────────

  _renderDock() {
    this.dock.innerHTML = '';

    const sections = [
      { name: 'explore', items: this.buildings.explore },
      { name: 'services', items: this.buildings.services },
      { name: 'progress', items: this.buildings.progress },
    ];

    sections.forEach((section, i) => {
      if (i > 0) {
        const divider = document.createElement('div');
        divider.className = 'gui-dock-divider';
        this.dock.appendChild(divider);
      }

      const sectionEl = document.createElement('div');
      sectionEl.className = 'gui-dock-section';

      for (const bld of section.items) {
        const btn = document.createElement('div');
        btn.className = 'gui-building';
        btn.innerHTML = `
          <span class="gui-building-key">${bld.key}</span>
          <span class="gui-building-icon">${bld.icon}</span>
          <span class="gui-building-name">${bld.name}</span>
        `;
        btn.addEventListener('click', () => {
          this.sendInput(bld.key + '\n');
        });
        btn.title = `${bld.name} [${bld.key}]`;
        sectionEl.appendChild(btn);
      }

      this.dock.appendChild(sectionEl);
    });
  }

  _updateDockFromServer() {
    this.serverMenuItems = [];
  }

  // ─── Choice/Event Buttons ───────────────

  _renderChoiceButtons(context, title, options) {
    // Show choice buttons in the room actions area
    this.roomActions.innerHTML = '';

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'gui-choice-title';
      titleEl.textContent = title;
      this.roomActions.appendChild(titleEl);
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'gui-choice-row';

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = `gui-room-action-btn ${opt.style || 'info'}`;
      btn.innerHTML = `<span class="gui-room-action-key">${opt.key}</span>${opt.label}`;
      btn.addEventListener('click', () => {
        this.sendInput(opt.key + '\n');
        this.roomActions.innerHTML = ''; // Clear after choice
      });
      btnRow.appendChild(btn);
    }
    this.roomActions.appendChild(btnRow);
  }

  _renderLootItem(data) {
    // Show loot item card with equip/take/pass buttons
    this.npcArea.innerHTML = '';
    this.roomActions.innerHTML = '';

    const loot = document.createElement('div');
    loot.className = 'gui-loot-card';

    let statsHtml = '';
    if (data.attack > 0) statsHtml += `<span class="gui-loot-stat atk">ATK: ${data.attack}</span>`;
    if (data.armor > 0) statsHtml += `<span class="gui-loot-stat def">AC: ${data.armor}</span>`;
    if (data.bonusStats) {
      for (const [stat, val] of Object.entries(data.bonusStats)) {
        if (val > 0) statsHtml += `<span class="gui-loot-stat bonus">+${val} ${stat}</span>`;
        else if (val < 0) statsHtml += `<span class="gui-loot-stat penalty">${val} ${stat}</span>`;
      }
    }

    loot.innerHTML = `
      <div class="gui-loot-rarity ${data.rarity.toLowerCase()}">${data.rarity}</div>
      <div class="gui-loot-name">${data.isIdentified ? data.itemName : '??? Unidentified ???'}</div>
      <div class="gui-loot-type">${data.itemType}</div>
      <div class="gui-loot-stats">${statsHtml}</div>
    `;
    this.npcArea.appendChild(loot);

    // Choice buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'gui-choice-row';
    for (const opt of data.options) {
      const btn = document.createElement('button');
      btn.className = `gui-room-action-btn ${opt.style || 'info'}`;
      btn.innerHTML = `<span class="gui-room-action-key">${opt.key}</span>${opt.label}`;
      btn.addEventListener('click', () => {
        this.sendInput(opt.key + '\n');
        this.roomActions.innerHTML = '';
      });
      btnRow.appendChild(btn);
    }
    this.roomActions.appendChild(btnRow);
  }

  // ─── Dungeon Room Rendering ─────────────

  _renderDungeonRoom(data) {
    this.screen = 'dungeon';
    this.npcArea.innerHTML = '';
    this.toastArea.innerHTML = '';
    this.pressAny.style.display = 'none';

    // Danger stars
    const dangerStars = '★'.repeat(Math.min(data.dangerRating || 0, 5));
    const clearedBadge = data.isCleared ? '<span class="gui-room-cleared-badge">CLEARED</span>' : '';

    // Features list
    const features = data.features || [];
    const featuresHtml = features.length > 0
      ? `<div class="gui-room-features">${features.map(f => `<span class="gui-room-feature">· ${f}</span>`).join('')}</div>`
      : '';

    // Exits with cleared status
    const exits = data.exits || [];
    const exitsHtml = exits.length > 0
      ? `<div class="gui-room-exits">${exits.map(e => {
          const ex = typeof e === 'object' ? e : { dir: e, label: e, cleared: false };
          return `<span class="gui-room-exit${ex.cleared ? ' cleared' : ''}">
            <span class="gui-room-exit-dir">[${ex.dir}]</span> ${ex.label}${ex.cleared ? ' ✓' : ''}
          </span>`;
        }).join('')}</div>`
      : '';

    // Room info panel — left side overlay
    const roomInfo = document.createElement('div');
    roomInfo.className = 'gui-room-info';
    roomInfo.innerHTML = `
      <div class="gui-room-header">
        <div class="gui-room-name">${data.roomName}</div>
        <div class="gui-room-meta">
          <span class="gui-room-floor">Floor ${data.floor}</span>
          <span class="gui-room-theme">${data.theme}</span>
          <span class="gui-room-danger">${dangerStars}</span>
          ${clearedBadge}
        </div>
      </div>
      <div class="gui-room-desc">${data.description || ''}</div>
      ${data.atmosphere ? `<div class="gui-room-atmo">${data.atmosphere}</div>` : ''}
      ${featuresHtml}
      <div class="gui-room-divider"></div>
      <div class="gui-room-section-label">Exits</div>
      ${exitsHtml}
      ${data.potions !== undefined ? `<div class="gui-room-status">Potions: ${data.potions}/${data.maxPotions}</div>` : ''}
    `;
    this.npcArea.appendChild(roomInfo);

    // Update compass — show/hide direction buttons based on available exits
    this.compass.style.display = 'flex';
    const exitDirs = exits.map(e => typeof e === 'object' ? e.dir : e);
    this.compass.querySelector('.gui-compass-n').style.display = exitDirs.includes('N') ? 'flex' : 'none';
    this.compass.querySelector('.gui-compass-s').style.display = exitDirs.includes('S') ? 'flex' : 'none';
    this.compass.querySelector('.gui-compass-e').style.display = exitDirs.includes('E') ? 'flex' : 'none';
    this.compass.querySelector('.gui-compass-w').style.display = exitDirs.includes('W') ? 'flex' : 'none';

    // Room action buttons — all available actions
    this.roomActions.innerHTML = '';

    // Primary actions row (context-sensitive)
    const primaryActions = [];
    if (data.hasMonsters && !data.isCleared)
      primaryActions.push({ key: 'F', label: 'Fight', cls: 'danger' });
    if (data.hasTreasure)
      primaryActions.push({ key: 'T', label: 'Treasure', cls: 'treasure' });
    if (data.hasEvent)
      primaryActions.push({ key: 'V', label: 'Event', cls: 'event' });
    if (data.hasFeatures)
      primaryActions.push({ key: 'X', label: 'Examine', cls: 'feature' });

    if (primaryActions.length > 0) {
      const primaryRow = document.createElement('div');
      primaryRow.className = 'gui-choice-row';
      for (const action of primaryActions) {
        const btn = document.createElement('button');
        btn.className = `gui-room-action-btn ${action.cls}`;
        btn.innerHTML = `<span class="gui-room-action-key">${action.key}</span>${action.label}`;
        btn.addEventListener('click', () => this.sendInput(action.key + '\n'));
        primaryRow.appendChild(btn);
      }
      this.roomActions.appendChild(primaryRow);
    }

    // Utility actions row
    const utilRow = document.createElement('div');
    utilRow.className = 'gui-choice-row gui-utility-row';
    const utilActions = [
      { key: 'R', label: 'Camp' },
      { key: 'M', label: 'Map' },
      { key: 'G', label: 'Guide' },
      { key: 'I', label: 'Inventory' },
      { key: 'P', label: 'Potions' },
      { key: 'Y', label: 'Party' },
      { key: '=', label: 'Status' },
      { key: 'Q', label: 'Leave' },
    ];
    for (const action of utilActions) {
      const btn = document.createElement('button');
      btn.className = 'gui-room-action-btn info gui-util-btn';
      btn.innerHTML = `<span class="gui-room-action-key">${action.key}</span>${action.label}`;
      btn.addEventListener('click', () => this.sendInput(action.key + '\n'));
      utilRow.appendChild(btn);
    }
    this.roomActions.appendChild(utilRow);

    this.sceneTitle.textContent = '';
  }

  // ─── Dungeon Map Rendering ──────────────

  _renderDungeonMap(data) {
    this.npcArea.innerHTML = '';
    this.roomActions.innerHTML = '';
    this.compass.style.display = 'none';

    const overlay = document.createElement('div');
    overlay.className = 'gui-map-overlay';

    // Header
    overlay.innerHTML = `
      <div class="gui-map-header">
        <span class="gui-map-title">Dungeon Map — Floor ${data.floor} (${data.theme})</span>
        <span class="gui-map-stats">${data.explored}/${data.total} explored, ${data.cleared}/${data.total} cleared</span>
      </div>
    `;

    const rooms = data.rooms || [];
    if (rooms.length === 0) {
      overlay.innerHTML += '<div style="text-align:center;color:var(--text-dim);padding:40px;">Map unavailable</div>';
      this.npcArea.appendChild(overlay);
      return;
    }

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const r of rooms) {
      if (r.x < minX) minX = r.x;
      if (r.x > maxX) maxX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.y > maxY) maxY = r.y;
    }

    // Position lookup
    const posMap = {};
    for (const r of rooms) posMap[`${r.x},${r.y}`] = r;

    // Canvas-based map with corridors
    const CELL = 44;   // cell size in px
    const CORR = 16;   // corridor length between cells
    const STEP = CELL + CORR; // total step per grid unit
    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;
    const cw = cols * STEP - CORR + 20; // +padding
    const ch = rows * STEP - CORR + 20;

    const canvas = document.createElement('canvas');
    canvas.className = 'gui-map-canvas';
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    const ox = 10; // offset/padding
    const oy = 10;

    // Color map
    const typeColors = {
      player: '#ffdd44', cleared: '#44aa44', monsters: '#cc3333',
      boss: '#ff4444', stairs: '#4477dd', safe: '#5599aa', unknown: '#444444'
    };

    // Draw corridors first
    for (const room of rooms) {
      const rx = (room.x - minX) * STEP + ox;
      const ry = (room.y - minY) * STEP + oy;
      const exits = room.exits || [];

      ctx.strokeStyle = 'rgba(120, 100, 60, 0.5)';
      ctx.lineWidth = 3;

      for (const dir of exits) {
        const d = dir.toUpperCase();
        let tx, ty;
        if (d === 'E') { tx = rx + CELL; ty = ry + CELL/2; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + CORR, ty); ctx.stroke(); }
        if (d === 'S') { tx = rx + CELL/2; ty = ry + CELL; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty + CORR); ctx.stroke(); }
        // Only draw E and S to avoid double-drawing
      }
    }

    // Draw rooms
    for (const room of rooms) {
      const rx = (room.x - minX) * STEP + ox;
      const ry = (room.y - minY) * STEP + oy;
      const color = typeColors[room.type] || '#555';

      // Room background
      ctx.fillStyle = room.type === 'player' ? 'rgba(200, 180, 50, 0.2)' :
                      room.type === 'monsters' ? 'rgba(180, 30, 30, 0.15)' :
                      room.type === 'cleared' ? 'rgba(40, 120, 40, 0.1)' :
                      room.type === 'boss' ? 'rgba(200, 30, 30, 0.25)' :
                      room.type === 'stairs' ? 'rgba(40, 60, 160, 0.15)' :
                      'rgba(30, 30, 30, 0.3)';
      ctx.fillRect(rx + 1, ry + 1, CELL - 2, CELL - 2);

      // Room border
      ctx.strokeStyle = color;
      ctx.lineWidth = room.type === 'player' ? 2 : 1;
      ctx.strokeRect(rx + 0.5, ry + 0.5, CELL - 1, CELL - 1);

      // Player glow
      if (room.type === 'player') {
        ctx.shadowColor = 'rgba(200, 180, 50, 0.6)';
        ctx.shadowBlur = 8;
        ctx.strokeRect(rx + 0.5, ry + 0.5, CELL - 1, CELL - 1);
        ctx.shadowBlur = 0;
      }

      // Room symbol
      ctx.fillStyle = color;
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.symbol, rx + CELL/2, ry + CELL/2);
    }

    overlay.appendChild(canvas);

    // Legend + footer row
    const bottomRow = document.createElement('div');
    bottomRow.className = 'gui-map-bottom';
    bottomRow.innerHTML = `
      <div class="gui-map-legend">
        <span class="gui-map-legend-item"><span class="gui-map-sym-player">@</span> You</span>
        <span class="gui-map-legend-item"><span class="gui-map-sym-cleared">#</span> Cleared</span>
        <span class="gui-map-legend-item"><span class="gui-map-sym-monsters">█</span> Monsters</span>
        <span class="gui-map-legend-item"><span class="gui-map-sym-stairs">></span> Stairs</span>
        <span class="gui-map-legend-item"><span class="gui-map-sym-boss">B</span> Boss</span>
        <span class="gui-map-legend-item"><span class="gui-map-sym-safe">·</span> Safe</span>
        <span class="gui-map-legend-item"><span class="gui-map-sym-unknown">?</span> Unknown</span>
      </div>
      <div class="gui-map-footer">
        <span>Location: ${data.currentRoomName}</span>
        ${data.bossDefeated ? '<span class="gui-map-boss-defeated">★ BOSS DEFEATED</span>' : ''}
      </div>
    `;
    overlay.appendChild(bottomRow);

    this.npcArea.appendChild(overlay);
  }

  // ─── Inventory Rendering ────────────────

  _renderInventory(data) {
    this.npcArea.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'gui-map-overlay gui-inv-overlay';

    // Header
    overlay.innerHTML = `
      <div class="gui-map-header">
        <span class="gui-map-title">Equipment — ${data.playerName}</span>
        <span class="gui-map-stats">Lv.${data.level} ${data.className} | Gold: ${(data.gold || 0).toLocaleString()}</span>
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'gui-inv-body';

    // -- Left: Paperdoll with equipment slots --
    const paperdoll = document.createElement('div');
    paperdoll.className = 'gui-inv-paperdoll';

    // Character portrait in center
    const sprites = this._getClassSprite(data.className);
    paperdoll.innerHTML = `<img class="gui-inv-portrait" src="${sprites.hdSrc}"
      onerror="this.src='${sprites.regularSrc}'; this.onerror=function(){this.src='${sprites.fallbackSrc}';}">`;

    // Equipment slots in display order (flows into 2-column grid)
    const slotLayout = {
      MainHand: { icon: '⚔' },
      OffHand:  { icon: '🛡' },
      Head:     { icon: '🎩' },
      Body:     { icon: '👕' },
      Arms:     { icon: '💪' },
      Hands:    { icon: '🧤' },
      Legs:     { icon: '👖' },
      Feet:     { icon: '👢' },
      Waist:    { icon: '🩳' },
      Cloak:    { icon: '🧣' },
      Face:     { icon: '👤' },
      Neck:     { icon: '📿' },
      LFinger:  { icon: '💍' },
      RFinger:  { icon: '💍' },
    };

    const slotsGrid = document.createElement('div');
    slotsGrid.className = 'gui-inv-slots-grid';

    const eqMap = {};
    for (const eq of (data.equipment || [])) eqMap[eq.slot] = eq;

    for (const [slotName, layout] of Object.entries(slotLayout)) {
      const eq = eqMap[slotName];
      const isEmpty = !eq || eq.name === '(empty)';
      const slot = document.createElement('div');
      slot.className = `gui-inv-slot ${isEmpty ? 'empty' : (eq?.rarity || '')}`;
      slot.title = isEmpty ? slotName : `${eq.name}\n${eq.attack ? 'ATK: ' + eq.attack : ''} ${eq.defense ? 'DEF: ' + eq.defense : ''}`;

      slot.innerHTML = `
        <span class="gui-inv-slot-icon">${isEmpty ? layout.icon : (eq.attack ? '⚔' : '🛡')}</span>
        <span class="gui-inv-slot-name">${isEmpty ? slotName : eq.name}</span>
      `;

      // Click equipped slot — send UNEQUIP command (stays in graphical overlay)
      if (!isEmpty) {
        const sn = slotName;
        slot.addEventListener('click', () => {
          this.sendInput(`UNEQUIP:${sn}\n`);
        });
        slot.style.cursor = 'pointer';
        slot.title += '\n\nClick to unequip';
      }

      slotsGrid.appendChild(slot);
    }

    const leftPanel = document.createElement('div');
    leftPanel.className = 'gui-inv-left';
    leftPanel.appendChild(paperdoll);
    leftPanel.appendChild(slotsGrid);
    body.appendChild(leftPanel);

    // -- Right: Backpack --
    const rightPanel = document.createElement('div');
    rightPanel.className = 'gui-inv-right';
    rightPanel.innerHTML = `<div class="gui-inv-section-label">Backpack (${(data.backpack || []).length} items)</div>`;

    const bpGrid = document.createElement('div');
    bpGrid.className = 'gui-inv-bp-grid';

    const backpack = data.backpack || [];
    for (let i = 0; i < backpack.length; i++) {
      const item = backpack[i];
      const cell = document.createElement('div');
      cell.className = 'gui-inv-bp-cell';
      cell.title = `${item.name}\nType: ${item.type}\n${item.attack ? 'ATK: ' + item.attack : ''} ${item.defense ? 'DEF: ' + item.defense : ''}\n\nClick to equip`;
      const typeIcon = item.type === 'Weapon' ? '⚔' : item.type === 'Shield' ? '🛡' :
                       item.type === 'Head' ? '🎩' : item.type === 'Body' ? '👕' :
                       item.type === 'Fingers' ? '💍' : item.type === 'Neck' ? '📿' : '🛡';
      cell.innerHTML = `
        <span class="gui-inv-bp-cell-icon">${typeIcon}</span>
        <span class="gui-inv-bp-cell-name">${item.name}</span>
        <span class="gui-inv-bp-cell-stats">${item.attack ? `ATK:${item.attack}` : ''} ${item.defense ? `DEF:${item.defense}` : ''}</span>
      `;
      // Click to equip (or drop if drop mode active)
      const bpIdx = i;
      cell.addEventListener('click', () => {
        if (this._inventoryDropMode) {
          this.sendInput(`DROP:${bpIdx}\n`);
          this._inventoryDropMode = false;
        } else {
          this.sendInput(`EQUIP:${bpIdx}\n`);
        }
      });
      cell.style.cursor = 'pointer';
      bpGrid.appendChild(cell);
    }

    if ((data.backpack || []).length === 0) {
      bpGrid.innerHTML = '<div style="color:var(--text-faint);padding:20px;text-align:center;">Backpack empty</div>';
    }

    rightPanel.appendChild(bpGrid);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'gui-inv-actions';
    const dropBtn = document.createElement('button');
    dropBtn.className = 'gui-room-action-btn info gui-util-btn';
    dropBtn.innerHTML = '<span class="gui-room-action-key">D</span>Drop Mode';
    dropBtn.addEventListener('click', () => {
      // Toggle drop mode — next backpack click drops instead of equips
      this._inventoryDropMode = !this._inventoryDropMode;
      dropBtn.classList.toggle('active-mode', this._inventoryDropMode);
      dropBtn.innerHTML = this._inventoryDropMode
        ? '<span class="gui-room-action-key">D</span>Drop Mode ON'
        : '<span class="gui-room-action-key">D</span>Drop Mode';
    });
    actions.appendChild(dropBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gui-room-action-btn info gui-util-btn';
    closeBtn.innerHTML = '<span class="gui-room-action-key">Q</span>Close';
    closeBtn.addEventListener('click', () => {
      this._inventoryDropMode = false;
      this.npcArea.innerHTML = '';
      this.sendInput('Q\n');
    });
    actions.appendChild(closeBtn);
    rightPanel.appendChild(actions);

    body.appendChild(rightPanel);
    overlay.appendChild(body);
    this.npcArea.appendChild(overlay);
  }

  /** Show equip/unequip result as a toast in the inventory overlay */
  _showInventoryResult(data) {
    const existing = document.querySelector('.gui-inv-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `gui-inv-toast gui-inv-toast-${data.type || 'info'}`;
    toast.textContent = data.message;
    // Insert at top of the overlay
    const overlay = this.npcArea.querySelector('.gui-inv-overlay');
    if (overlay) {
      overlay.insertBefore(toast, overlay.children[1]); // After header
    }
    setTimeout(() => toast.remove(), 3000);
  }

  /** Show slot picker for rings or 1H weapons */
  _showSlotPicker(data) {
    const existing = document.querySelector('.gui-inv-slot-picker');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.className = 'gui-inv-slot-picker';
    picker.innerHTML = `<div class="gui-inv-picker-title">Where to equip ${data.itemName}?</div>`;

    for (const opt of (data.options || [])) {
      const btn = document.createElement('button');
      btn.className = 'gui-room-action-btn feature';
      btn.innerHTML = `${opt.label}<br><span style="font-size:8px;color:var(--text-dim)">${opt.current}</span>`;
      btn.addEventListener('click', () => {
        picker.remove();
        this.sendInput(`EQUIP:${data.itemIndex}:${opt.slot}\n`);
      });
      picker.appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'gui-room-action-btn info';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => picker.remove());
    picker.appendChild(cancelBtn);

    const overlay = this.npcArea.querySelector('.gui-inv-overlay');
    if (overlay) overlay.appendChild(picker);
  }

  // ─── Character Status Rendering ───────────

  _renderCharacterStatus(data) {
    this.npcArea.innerHTML = '';
    this.roomActions.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'gui-map-overlay';

    // Use class sprite as portrait
    const sprites = this._getClassSprite(data.className);

    overlay.innerHTML = `
      <div class="gui-map-header">
        <span class="gui-map-title">Character Status</span>
        <span class="gui-map-stats">${data.isKnighted ? '⚔ ' : ''}${data.name}</span>
      </div>
      <div class="gui-status-body">
        <div class="gui-status-portrait">
          <img class="gui-status-portrait-img" src="${sprites.hdSrc}"
               onerror="this.src='${sprites.regularSrc}'; this.onerror=function(){this.src='${sprites.fallbackSrc}';}">
          <div class="gui-status-name">${data.name}</div>
          <div class="gui-status-classrace">Lv.${data.level} ${data.className} ${data.race}</div>
        </div>
        <div class="gui-status-stats">
          <div class="gui-status-bars">
            <div class="gui-status-bar-row">
              <span class="gui-status-bar-label">HP</span>
              <div class="gui-status-bar"><div class="gui-status-bar-fill hp" style="width:${data.maxHp > 0 ? (data.hp/data.maxHp*100) : 0}%"></div></div>
              <span class="gui-status-bar-val">${data.hp}/${data.maxHp}</span>
            </div>
            ${data.isManaClass ? `
            <div class="gui-status-bar-row">
              <span class="gui-status-bar-label">MP</span>
              <div class="gui-status-bar"><div class="gui-status-bar-fill mp" style="width:${data.maxMana > 0 ? (data.mana/data.maxMana*100) : 0}%"></div></div>
              <span class="gui-status-bar-val">${data.mana}/${data.maxMana}</span>
            </div>` : `
            <div class="gui-status-bar-row">
              <span class="gui-status-bar-label">ST</span>
              <div class="gui-status-bar"><div class="gui-status-bar-fill sta" style="width:${data.maxStamina > 0 ? (data.stamina/data.maxStamina*100) : 0}%"></div></div>
              <span class="gui-status-bar-val">${data.stamina}/${data.maxStamina}</span>
            </div>`}
          </div>
          <div class="gui-status-attributes">
            ${['str','dex','agi','con','intel','wis','cha','def'].map(s => {
              const label = s === 'intel' ? 'INT' : s.toUpperCase();
              const val = data[s] || 0;
              return `<div class="gui-status-attr"><span class="gui-status-attr-label">${label}</span><span class="gui-status-attr-val">${val}</span></div>`;
            }).join('')}
          </div>
          <div class="gui-status-info">
            <span>Gold: ${(data.gold || 0).toLocaleString()}</span>
            <span>Potions: ${data.potions}/${data.maxPotions}</span>
            <span>XP: ${(data.experience || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>
    `;

    this.npcArea.appendChild(overlay);
  }

  // ─── Party Status Rendering ───────────────

  _renderPartyStatus(data) {
    this.npcArea.innerHTML = '';
    this.roomActions.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'gui-map-overlay';
    overlay.innerHTML = `<div class="gui-map-header"><span class="gui-map-title">Party Management</span></div>`;

    const list = document.createElement('div');
    list.className = 'gui-party-list';

    for (const m of (data.members || [])) {
      const hpPct = m.maxHp > 0 ? (m.hp / m.maxHp * 100) : 0;
      const sprites = this._getClassSprite(m.className);
      const card = document.createElement('div');
      card.className = 'gui-party-card';
      card.innerHTML = `
        <img class="gui-party-portrait" src="${sprites.hdSrc}"
             onerror="this.src='${sprites.regularSrc}'; this.onerror=function(){this.src='${sprites.fallbackSrc}';}">
        <div class="gui-party-info">
          <div class="gui-party-member-name">${m.name}</div>
          <div class="gui-party-member-class">Lv.${m.level} ${m.className}</div>
          <div class="gui-party-hp-row">
            <span class="gui-party-hp-label">HP</span>
            <div class="gui-party-hp-bar"><div class="gui-party-hp-fill" style="width:${hpPct}%"></div></div>
            <span class="gui-party-hp-val">${m.hp}/${m.maxHp}</span>
          </div>
          ${m.isManaClass ? `
          <div class="gui-party-hp-row">
            <span class="gui-party-hp-label">MP</span>
            <div class="gui-party-hp-bar"><div class="gui-party-hp-fill mp" style="width:${m.maxMana > 0 ? (m.mana/m.maxMana*100) : 0}%"></div></div>
            <span class="gui-party-hp-val">${m.mana}/${m.maxMana}</span>
          </div>` : ''}
          <div class="gui-party-equip">⚔ ${m.weapon} | 🛡 ${m.armor}</div>
        </div>
      `;
      list.appendChild(card);
    }

    if ((data.members || []).length === 0) {
      list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:40px;">No party members</div>';
    }

    overlay.appendChild(list);
    this.npcArea.appendChild(overlay);
  }

  // ─── Potions Menu Rendering ───────────────

  _renderPotionsMenu(data) {
    this.npcArea.innerHTML = '';
    this.roomActions.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'gui-map-overlay';
    const hpPct = data.playerMaxHp > 0 ? (data.playerHp / data.playerMaxHp * 100) : 0;

    overlay.innerHTML = `
      <div class="gui-map-header">
        <span class="gui-map-title">Potions & Healing</span>
        <span class="gui-map-stats">Gold: ${(data.gold || 0).toLocaleString()}</span>
      </div>
      <div class="gui-potions-player">
        <div class="gui-potions-hp-row">
          <span>HP</span>
          <div class="gui-potions-bar"><div class="gui-potions-fill hp" style="width:${hpPct}%"></div></div>
          <span>${data.playerHp}/${data.playerMaxHp}</span>
        </div>
        <div class="gui-potions-count">Potions: ${data.potions}/${data.maxPotions} | Heals: ${(data.healAmount || 0).toLocaleString()} HP each</div>
      </div>
    `;

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'gui-potions-actions';
    const btns = [
      { key: 'U', label: 'Use Potion (Self)', enabled: data.potions > 0 && data.playerHp < data.playerMaxHp },
      { key: 'H', label: 'Heal to Full', enabled: data.potions > 0 && data.playerHp < data.playerMaxHp },
      { key: 'B', label: `Buy Potion (${data.potionCost}g)`, enabled: data.gold >= data.potionCost && data.potions < data.maxPotions },
      { key: 'T', label: 'Heal Teammate', enabled: data.potions > 0 && (data.teammates || []).length > 0 },
      { key: 'A', label: 'Heal All', enabled: data.potions > 0 },
      { key: 'Q', label: 'Back', enabled: true },
    ];
    for (const b of btns) {
      const btn = document.createElement('button');
      btn.className = `gui-room-action-btn ${b.enabled ? 'feature' : 'info'}${b.enabled ? '' : ' gui-btn-disabled'}`;
      btn.innerHTML = `<span class="gui-room-action-key">${b.key}</span>${b.label}`;
      if (b.enabled) btn.addEventListener('click', () => this.sendInput(b.key + '\n'));
      actions.appendChild(btn);
    }
    overlay.appendChild(actions);

    // Teammate HP bars
    if ((data.teammates || []).length > 0) {
      const tmSection = document.createElement('div');
      tmSection.className = 'gui-potions-team';
      tmSection.innerHTML = '<div class="gui-inv-section-label">Team Status</div>';
      for (const tm of data.teammates) {
        const tmHpPct = tm.maxHp > 0 ? (tm.hp / tm.maxHp * 100) : 0;
        const row = document.createElement('div');
        row.className = 'gui-potions-tm-row';
        row.innerHTML = `
          <span class="gui-potions-tm-name">${tm.name}</span>
          <div class="gui-potions-bar"><div class="gui-potions-fill hp" style="width:${tmHpPct}%"></div></div>
          <span class="gui-potions-tm-val">${tm.hp}/${tm.maxHp}</span>
        `;
        tmSection.appendChild(row);
      }
      overlay.appendChild(tmSection);
    }

    this.npcArea.appendChild(overlay);
  }

  // ─── Combat Rendering (DD-style) ────────

  _renderFullCombatMenu(data) {
    // Hide the dock during combat — ability bar goes in the scene
    this.dock.innerHTML = '';

    // Build the DD-style ability bar at the bottom of the scene
    this.roomActions.innerHTML = '';

    const needsTarget = !data.singleTarget && data.targets && data.targets.length > 1;

    const abilityBar = document.createElement('div');
    abilityBar.className = 'gui-combat-ability-bar';

    // -- Character portrait --
    const playerClass = this.state.playerClass || 'warrior';
    const sprites = this._getClassSprite(playerClass);
    const portrait = document.createElement('div');
    portrait.className = 'gui-combat-portrait hd';
    portrait.innerHTML = `<img src="${sprites.hdSrc}" alt="${playerClass}"
      onerror="this.parentElement.classList.remove('hd'); this.src='${sprites.regularSrc}'; this.onerror=function(){this.src='${sprites.fallbackSrc}';}">`;
    abilityBar.appendChild(portrait);

    // -- Mini stats panel --
    const hpPct = this.state.maxHp > 0 ? (this.state.hp / this.state.maxHp * 100) : 100;
    const mpPct = this.state.maxMana > 0 ? (this.state.mana / this.state.maxMana * 100) : 0;
    const staPct = this.state.maxStamina > 0 ? (this.state.stamina / this.state.maxStamina * 100) : 0;
    const statsPanel = document.createElement('div');
    statsPanel.className = 'gui-combat-stats-mini';
    statsPanel.innerHTML = `
      <div class="stat-row">
        <span class="stat-label">HP</span>
        <div class="stat-bar"><div class="stat-fill hp" style="width:${hpPct}%"></div></div>
        <span class="stat-value">${this.state.hp}/${this.state.maxHp}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">${this.state.maxMana > 0 ? 'MP' : 'ST'}</span>
        <div class="stat-bar"><div class="stat-fill ${this.state.maxMana > 0 ? 'mp' : 'sta'}" style="width:${this.state.maxMana > 0 ? mpPct : staPct}%"></div></div>
        <span class="stat-value">${this.state.maxMana > 0 ? `${this.state.mana}/${this.state.maxMana}` : `${this.state.stamina}/${this.state.maxStamina}`}</span>
      </div>
      ${data.potions !== undefined ? `<div class="stat-row"><span class="stat-label" style="color:#cc5555">⚗</span><span class="stat-value" style="flex:1">${data.potions} potions</span></div>` : ''}
    `;
    abilityBar.appendChild(statsPanel);

    // -- Skill slots container --
    const skillsContainer = document.createElement('div');
    skillsContainer.className = 'gui-combat-skills';

    // Skill icon map for core actions
    const skillIcons = {
      'A': { icon: '⚔', label: 'Attack', cat: 'combat', target: true },
      'D': { icon: '🛡', label: 'Defend', cat: 'defense', target: false },
      'P': { icon: '💥', label: 'Power', cat: 'combat', target: true },
      'E': { icon: '🎯', label: 'Precise', cat: 'combat', target: true },
      'T': { icon: '📢', label: 'Taunt', cat: 'tactics', target: true },
      'I': { icon: '🗡', label: 'Disarm', cat: 'tactics', target: true },
      'W': { icon: '👤', label: 'Hide', cat: 'tactics', target: false },
      'H': { icon: '❤', label: 'Heal', cat: 'heal', target: false },
      'R': { icon: '🏃', label: 'Flee', cat: 'escape', target: false },
    };

    // Core combat actions as skill slots
    const coreKeys = ['A', 'P', 'E', 'D', 'T', 'W', 'H', 'R'];
    for (const key of coreKeys) {
      const info = skillIcons[key];
      if (!info) continue;
      // Check if this action is available from server data
      const serverAction = data.actions ? data.actions.find(a => a.key === key) : null;
      const isAvailable = serverAction ? serverAction.available : true;
      // Special: hide potions button if no potions
      if (key === 'H' && data.potions !== undefined && data.potions <= 0) continue;

      const slot = this._createSkillSlot(key, info.icon, info.label, info.cat, isAvailable,
        needsTarget && info.target ? data.targets : null);
      skillsContainer.appendChild(slot);
    }

    // Separator before quickbar
    if (data.quickbar && data.quickbar.length > 0) {
      const sep = document.createElement('div');
      sep.style.cssText = 'width:1px; height:40px; background:rgba(140,100,40,0.3); margin:0 4px; flex-shrink:0;';
      skillsContainer.appendChild(sep);

      // Quickbar skills
      for (const skill of data.quickbar) {
        const slot = this._createSkillSlot(
          skill.key, '✦', skill.label, 'spell', skill.available,
          needsTarget ? data.targets : null
        );
        skillsContainer.appendChild(slot);
      }
    }

    abilityBar.appendChild(skillsContainer);
    this.roomActions.appendChild(abilityBar);
  }

  /** Create a single DD-style skill slot button */
  _createSkillSlot(key, icon, label, category, available, targets) {
    const slot = document.createElement('div');
    slot.className = `gui-skill-slot ${category}${available ? '' : ' disabled'}`;
    slot.innerHTML = `
      <span class="gui-skill-key">${key}</span>
      <span class="gui-skill-icon">${icon}</span>
      <span class="gui-skill-label">${label}</span>
    `;
    slot.title = `${label} [${key}]`;

    if (available) {
      if (targets && targets.length > 1) {
        slot.addEventListener('click', () => this._showTargetPicker(targets, key));
      } else {
        slot.addEventListener('click', () => this.sendInput(key + '\n'));
      }
    }
    return slot;
  }

  _createDockButton(key, label, available) {
    const btn = document.createElement('div');
    btn.className = 'gui-building' + (available ? '' : ' gui-building-disabled');
    btn.innerHTML = `
      <span class="gui-building-key">${key}</span>
      <span class="gui-building-name">${label}</span>
    `;
    if (available) {
      btn.addEventListener('click', () => this.sendInput(key + '\n'));
    }
    btn.title = `${label} [${key}]`;
    return btn;
  }

  _showTargetPicker(targets, actionKey) {
    // Replace room actions with clickable monster targets
    this.roomActions.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'gui-choice-title';
    title.textContent = 'Select Target';
    this.roomActions.appendChild(title);

    const row = document.createElement('div');
    row.className = 'gui-choice-row';

    for (const target of targets) {
      const hpPct = target.maxHp > 0 ? Math.round(target.hp / target.maxHp * 100) : 0;
      const btn = document.createElement('button');
      btn.className = 'gui-room-action-btn danger';
      btn.innerHTML = `<span class="gui-room-action-key">${target.index}</span>${target.name} (${hpPct}%)`;
      btn.addEventListener('click', () => {
        // Send action key + target number
        this.sendInput(actionKey + '\n');
        // Small delay then send target
        setTimeout(() => this.sendInput(target.index + '\n'), 100);
      });
      row.appendChild(btn);
    }

    // Random target — send 0 for random
    const rndBtn = document.createElement('button');
    rndBtn.className = 'gui-room-action-btn info';
    rndBtn.innerHTML = '<span class="gui-room-action-key">0</span>Random';
    rndBtn.addEventListener('click', () => {
      this.sendInput(actionKey + '\n');
      setTimeout(() => this.sendInput('0\n'), 150);
    });
    row.appendChild(rndBtn);

    this.roomActions.appendChild(row);
  }

  _renderCombatDock() {
    // In DD-style, the dock is hidden during combat — the ability bar is rendered inside the scene
    this.dock.innerHTML = '';
  }

  _renderCombatStart(data) {
    this.npcArea.innerHTML = '';
    this.toastArea.innerHTML = '';
    this.roomActions.innerHTML = '';
    this.state.combatLog = [];

    this._renderBattlefield(data);
  }

  /** Get the best available sprite for a player/ally class */
  _getClassSprite(className) {
    const cls = (className || 'warrior').toLowerCase().replace(/\s+/g, '-');
    // Check if HD sprite exists (we'll try HD first, fallback to regular)
    return {
      hdSrc: `./assets/classes-hd/${cls}.png`,
      regularSrc: `./assets/classes/${cls}-east.png`,
      fallbackSrc: `./assets/classes/${cls}.png`,
      className: cls
    };
  }

  _renderPlayerCombatant(name, hpPct, hpClass, isPlayer) {
    const playerClass = this.state.playerClass || 'warrior';
    const sprites = this._getClassSprite(playerClass);
    return `
      <div class="gui-combatant gui-player-char${isPlayer ? ' active' : ''}">
        <img class="gui-combatant-sprite hd-sprite"
             src="${sprites.hdSrc}"
             alt="${playerClass}"
             onerror="this.className='gui-combatant-sprite'; this.src='${sprites.regularSrc}'; this.onerror=function(){this.src='${sprites.fallbackSrc}';}">
        <div class="gui-combatant-info">
          <div class="gui-combatant-name player-name">${name || 'You'}</div>
          <div class="gui-combatant-hp-bar">
            <div class="gui-combatant-hp-fill hp-player ${hpClass}" style="width:${hpPct}%"></div>
          </div>
        </div>
      </div>
    `;
  }

  _renderTeammateCombatant(tm) {
    const tmHpPct = tm.maxHp > 0 ? (tm.hp / tm.maxHp * 100) : 100;
    const tmHpClass = tmHpPct < 25 ? 'critical' : tmHpPct < 50 ? 'warning' : '';
    const tmClass = (tm.className || '').toLowerCase().replace(/\s+/g, '-');
    const sprites = this._getClassSprite(tmClass);
    const isDead = tm.hp <= 0;

    const spriteHtml = tmClass
      ? `<img class="gui-combatant-sprite hd-sprite"
             src="${sprites.hdSrc}" alt="${tm.name}"
             onerror="this.className='gui-combatant-sprite'; this.src='${sprites.regularSrc}'; this.onerror=function(){this.src='${sprites.fallbackSrc}';};">`
      : `<div class="gui-combatant-sprite gui-teammate-placeholder">${(tm.name || '?')[0]}</div>`;

    return `
      <div class="gui-combatant gui-teammate${isDead ? ' defeated' : ''}">
        ${spriteHtml}
        <div class="gui-combatant-info">
          <div class="gui-combatant-name ally-name">${tm.name}</div>
          <div class="gui-combatant-hp-bar">
            <div class="gui-combatant-hp-fill hp-ally ${tmHpClass}" style="width:${tmHpPct}%"></div>
          </div>
        </div>
      </div>
    `;
  }

  _renderMonsterCombatant(name, level, hp, maxHp, isBoss, spriteFile, family) {
    const hpPct = maxHp > 0 ? (hp / maxHp * 100) : 0;
    const hpClass = hpPct < 25 ? 'critical' : hpPct < 50 ? 'warning' : '';
    const isDead = hp <= 0;
    // Try HD monster sprite first, fallback to regular
    const baseName = spriteFile ? spriteFile.replace('.png', '') : '';
    const sprite = spriteFile
      ? `<img class="gui-combatant-sprite hd-sprite monster-sprite"
             src="./assets/monsters-hd/${spriteFile}" alt="${name}"
             onerror="this.className='gui-combatant-sprite monster-sprite'; this.src='./assets/monsters/${spriteFile}'; this.onerror=function(){this.style.display='none';};">`
      : `<div class="gui-combatant-sprite gui-monster-placeholder">${(name || '?')[0]}</div>`;
    return `
      <div class="gui-combatant gui-monster-combatant${isBoss ? ' boss' : ''}${isDead ? ' defeated' : ''}">
        ${sprite}
        <div class="gui-combatant-info">
          <div class="gui-combatant-name monster-name">${name}${isBoss ? ' ★' : ''}</div>
          <div class="gui-combatant-level">Lv.${level}</div>
          <div class="gui-combatant-hp-bar">
            <div class="gui-combatant-hp-fill hp-monster ${hpClass}" style="width:${hpPct}%"></div>
          </div>
          <div class="gui-combatant-hp-text">${hp.toLocaleString()} / ${maxHp.toLocaleString()}</div>
        </div>
      </div>
    `;
  }

  /** Render the full battlefield with party left, monsters right */
  _renderBattlefield(data) {
    this.npcArea.innerHTML = '';

    const battlefield = document.createElement('div');
    battlefield.className = 'gui-battlefield';

    // -- Left: Player party --
    const partyDiv = document.createElement('div');
    partyDiv.className = 'gui-party-side';

    const playerHpPct = data.playerMaxHp > 0 ? (data.playerHp / data.playerMaxHp * 100) : 100;
    const playerHpClass = playerHpPct < 25 ? 'critical' : playerHpPct < 50 ? 'warning' : '';

    let partyHtml = this._renderPlayerCombatant(this.state.playerName, playerHpPct, playerHpClass, true);

    // Add teammates
    const teammates = data.teammates || this.state.combatTeammates || [];
    for (const tm of teammates) {
      partyHtml += this._renderTeammateCombatant(tm);
    }
    partyDiv.innerHTML = partyHtml;
    battlefield.appendChild(partyDiv);

    // -- Center: Divider line --
    const vs = document.createElement('div');
    vs.className = 'gui-vs-divider';
    battlefield.appendChild(vs);

    // -- Right: Monsters --
    const monsterDiv = document.createElement('div');
    monsterDiv.className = 'gui-monster-side';

    if (data.monsters && data.monsters.length > 0) {
      let monstersHtml = '';
      for (const m of data.monsters) {
        const spriteFile = this.monsterSpriteMap[m.family] || '';
        monstersHtml += this._renderMonsterCombatant(m.name, m.level, m.hp, m.maxHp, m.isBoss, spriteFile, m.family);
      }
      monsterDiv.innerHTML = monstersHtml;
    } else if (data.monsterName) {
      // Single monster from combat_start event
      const spriteFile = this.monsterSpriteMap[data.family] || '';
      monsterDiv.innerHTML = this._renderMonsterCombatant(
        data.monsterName, data.monsterLevel,
        data.monsterHp, data.monsterMaxHp,
        data.isBoss, spriteFile, data.family
      );
    }
    battlefield.appendChild(monsterDiv);

    // -- Combat log overlay --
    const logDiv = document.createElement('div');
    logDiv.className = 'gui-combat-log';
    logDiv.id = 'gui-combat-log';
    battlefield.appendChild(logDiv);

    // -- Turn indicator --
    const turnDiv = document.createElement('div');
    turnDiv.className = 'gui-turn-indicator';
    turnDiv.id = 'gui-turn-indicator';
    turnDiv.textContent = 'Combat';
    battlefield.appendChild(turnDiv);

    // Add density class based on max combatants per side
    const partyCount = partyDiv.querySelectorAll('.gui-combatant').length;
    const monsterCount = monsterDiv.querySelectorAll('.gui-combatant').length;
    const maxPerSide = Math.max(partyCount, monsterCount);
    if (maxPerSide >= 5) battlefield.classList.add('dense-5');
    else if (maxPerSide >= 4) battlefield.classList.add('dense-4');
    else if (maxPerSide >= 3) battlefield.classList.add('dense-3');

    this.npcArea.appendChild(battlefield);
  }

  _renderCombatStatus(data) {
    if (!data.monsters || data.monsters.length === 0) return;
    this._renderBattlefield(data);

    // Update player HUD
    if (data.playerHp !== undefined) {
      this._updateHUD({
        hp: data.playerHp, maxHp: data.playerMaxHp,
        mana: data.playerMana, maxMana: data.playerMaxMana
      });
    }
  }

  /** Handle a combat_action event — feed the combat log and show damage numbers */
  _handleCombatAction(data) {
    const { actor, action, target, damage, targetHp, targetMaxHp } = data;
    // Determine log type
    let type = 'info';
    let text = '';
    if (damage > 0) {
      const isHeal = action && (action.toLowerCase().includes('heal') || action.toLowerCase().includes('potion'));
      if (isHeal) {
        type = 'heal';
        text = `${actor} heals ${target} for ${damage.toLocaleString()} HP`;
      } else {
        type = 'damage';
        text = `${actor} ${action || 'attacks'} ${target} for ${damage.toLocaleString()} damage`;
      }
    } else if (action) {
      type = action.toLowerCase().includes('defend') ? 'buff' : 'info';
      text = `${actor} uses ${action}${target ? ` on ${target}` : ''}`;
    } else {
      text = `${actor} attacks ${target}`;
    }
    this._addCombatLog(text, type);
  }

  /** Add entry to combat log */
  _addCombatLog(text, type) {
    const log = document.getElementById('gui-combat-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = `gui-combat-log-entry ${type || 'info'}`;
    entry.textContent = text;
    log.appendChild(entry);
    // Keep scrolled to bottom
    log.scrollTop = log.scrollHeight;
    // Limit entries
    while (log.children.length > 30) {
      log.removeChild(log.firstChild);
    }
  }

  _renderCombatEnd(data) {
    // Keep battlefield visible, overlay the result
    const result = document.createElement('div');
    result.className = 'gui-combat-result';
    const isDefeat = data.outcome && data.outcome.toLowerCase().includes('defeat');
    result.innerHTML = `
      <div class="gui-combat-result-title${isDefeat ? ' defeat' : ''}">${data.outcome}</div>
      <div class="gui-combat-rewards">
        ${data.xpGained ? `<span class="gui-reward-xp">+${data.xpGained.toLocaleString()} XP</span>` : ''}
        ${data.goldGained ? `<span class="gui-reward-gold">+${data.goldGained.toLocaleString()} Gold</span>` : ''}
        ${data.lootName ? `<span class="gui-reward-loot">${data.lootName}</span>` : ''}
      </div>
    `;
    this.npcArea.appendChild(result);

    // Clear ability bar
    this.roomActions.innerHTML = '';

    // Auto-clear after a few seconds
    setTimeout(() => {
      if (result.parentNode) result.remove();
    }, 5000);
  }
}

window.GameUI = GameUI;
