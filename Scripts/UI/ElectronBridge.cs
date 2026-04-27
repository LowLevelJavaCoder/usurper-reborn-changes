using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// Emits structured JSON events to the Electron graphical client via OSC escape sequences.
/// Events are invisible to regular terminals (they ignore unrecognized OSC sequences).
/// Format: ESC ] 1337 ; usurper:{json} BEL
/// </summary>
public static class ElectronBridge
{
    private static readonly JsonSerializerOptions _jsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    /// <summary>
    /// Emit a JSON event to the Electron client. No-op if not in Electron mode.
    /// </summary>
    public static void Emit(string eventType, object data)
    {
        if (!GameConfig.ElectronMode) return;

        try
        {
            var envelope = new { e = eventType, d = data };
            var json = JsonSerializer.Serialize(envelope, _jsonOpts);
            // OSC 1337 ; usurper:{json} BEL
            Console.Write($"\x1b]1337;usurper:{json}\x07");
        }
        catch
        {
            // Never crash the game for a client event
        }
    }

    // ─── Location Events ─────────────────────

    public static void EmitLocation(string name, string description, string timeOfDay)
    {
        Emit("location", new { name, description, timeOfDay });
    }

    public static void EmitMenu(List<MenuItemData> items)
    {
        Emit("menu", new { items });
    }

    public static void EmitNPCList(List<NPCPresenceData> npcs)
    {
        Emit("npcs", new { npcs });
    }

    // ─── Player Stats ─────────────────────────

    public static void EmitStats(long hp, long maxHp, long mana, long maxMana,
        long stamina, long maxStamina, long gold, int level, string className, string raceName,
        string? playerName = null)
    {
        Emit("stats", new
        {
            hp, maxHp, mana, maxMana, stamina, maxStamina,
            gold, level, className, raceName, playerName
        });
    }

    // ─── Combat Events ────────────────────────

    public static void EmitCombatStart(string monsterName, int monsterLevel, long monsterHp, long monsterMaxHp, bool isBoss)
    {
        Emit("combat_start", new { monsterName, monsterLevel, monsterHp, monsterMaxHp, isBoss });
    }

    public static void EmitCombatAction(string actor, string action, string target, long damage, long targetHp, long targetMaxHp)
    {
        Emit("combat_action", new { actor, action, target, damage, targetHp, targetMaxHp });
    }

    public static void EmitCombatEnd(string outcome, long xpGained, long goldGained, string? lootName = null)
    {
        Emit("combat_end", new { outcome, xpGained, goldGained, lootName });
    }

    // ─── Shop Events ──────────────────────────

    public static void EmitShopInventory(string shopName, List<ShopItemData> items)
    {
        Emit("shop", new { shopName, items });
    }

    // ─── Narrative ────────────────────────────

    public static void EmitNarration(string text, string style = "normal")
    {
        Emit("narration", new { text, style });
    }

    public static void EmitPrompt(string prompt, string[] options)
    {
        Emit("prompt", new { prompt, options });
    }

    // ─── Dungeon Events ──────────────────────

    /// <summary>
    /// Emit a choice prompt with labeled options for the Electron client.
    /// The client renders these as clickable buttons.
    /// </summary>
    public static void EmitChoicePrompt(string context, string title, List<ChoiceOption> options)
    {
        Emit("choice", new { context, title, options });
    }

    /// <summary>Emit an event encounter with choices</summary>
    public static void EmitEventEncounter(string eventType, string title, string description, List<ChoiceOption> options)
    {
        Emit("event_encounter", new { eventType, title, description, options });
    }

    /// <summary>Emit loot item for pickup</summary>
    public static void EmitLootItem(string itemName, string itemType, int attack, int armor,
        Dictionary<string, int>? bonusStats, string rarity, bool isIdentified, List<ChoiceOption> options)
    {
        Emit("loot_item", new { itemName, itemType, attack, armor, bonusStats, rarity, isIdentified, options });
    }

    /// <summary>Emit combat target selection</summary>
    public static void EmitTargetSelection(string action, List<TargetOption> targets)
    {
        Emit("target_select", new { action, targets });
    }

    /// <summary>Emit floor overview</summary>
    public static void EmitFloorOverview(int floor, string theme, int totalRooms, int clearedRooms,
        bool hasStairs, bool hasBoss, List<ChoiceOption> options)
    {
        Emit("floor_overview", new { floor, theme, totalRooms, clearedRooms, hasStairs, hasBoss, options });
    }

    /// <summary>Emit a "press any key" signal</summary>
    public static void EmitPressAnyKey()
    {
        Emit("press_any_key", new { });
    }

    /// <summary>Emit confirmation prompt (Y/N)</summary>
    public static void EmitConfirm(string question)
    {
        Emit("confirm", new { question });
    }

    // ─── Pre-Game Events (Phase 3) ────────────
    //
    // Pre-game flows (main menu → save selection → character creation → opening)
    // happen before the player has a Character, so EmitStats / EmitLocation
    // aren't available. These events let the JS side render dedicated screens
    // for each pre-game surface. All use Pattern B (render-or-emit, continuous
    // loop sharing input via stdin) so the C# side reads choices/text from
    // the same GetInput call regardless of mode.

    /// <summary>
    /// Emit the title-screen / main menu (single-player local mode).
    /// JS renders splash + clickable menu buttons; click sends key+\n via stdin.
    /// </summary>
    public static void EmitMainMenu(string title, string subtitle, string version, List<MenuItemData> items)
    {
        Emit("main_menu", new { title, subtitle, version, items });
    }

    /// <summary>
    /// Emit the per-account save list (online / BBS / MUD-relay modes).
    /// JS renders save slots as cards with character info + last-played; tagged
    /// [RECOVERY] / [EMERGENCY SAVE] slots get visually distinct styling.
    /// </summary>
    public static void EmitSaveList(string accountName, List<SaveSlotData> slots, List<MenuItemData> actions)
    {
        Emit("save_list", new { accountName, slots, actions });
    }

    /// <summary>
    /// Emit one step of the character creation wizard. JS renders the picker
    /// for the current step; click/type sends the choice back via stdin.
    /// Step name is one of: "name", "gender", "orientation", "difficulty",
    /// "race", "class", "stats", "summary".
    /// </summary>
    public static void EmitCharacterCreationStep(string step, string title, string description, object data)
    {
        Emit("char_create_step", new { step, title, description, data });
    }

    /// <summary>
    /// Emit a recovery menu state when a save fails to load. JS renders the
    /// recovery file list + repair option as a focused dialog. Same input
    /// shape as the text version (1-N / R / N / Q).
    /// </summary>
    public static void EmitRecoveryMenu(string errorMessage, string saveFolderPath, List<RecoveryFileData> files,
        bool offerAutoRepair)
    {
        Emit("recovery_menu", new { errorMessage, saveFolderPath, files, offerAutoRepair });
    }

    /// <summary>
    /// Emit an opening-sequence narration screen. JS renders a focused
    /// narration panel with skip-on-key. Style hints layout: "awakening" =
    /// dream-like fade, "scene" = environmental, "mystery" = suspenseful,
    /// "goal" = mission statement.
    /// </summary>
    public static void EmitOpeningNarration(string phase, string text, string style)
    {
        Emit("opening_narration", new { phase, text, style });
    }

    // ─── Phase 4 Sub-Screen Events ────────────
    //
    // Generic input/browse overlays that multiple locations share. C# emits
    // these before the corresponding GetInput call; JS shows a focused overlay
    // with a number input or paginated grid. User confirms, JS sends value + \n
    // via stdin, the existing C# parser handles it as if it were typed text.

    /// <summary>
    /// Emit a numeric amount-entry prompt. Used by Bank deposit/withdraw,
    /// Temple/Church donations, Level Master training point allocation, and
    /// any other surface that asks for a quantity. JS shows a focused number
    /// input overlay with min/max validation and a confirm button. Suggested
    /// preset buttons (max, half, etc.) when relevant.
    /// </summary>
    public static void EmitAmountEntry(string title, string prompt, long maxAmount,
        string currency = "gold", long minAmount = 0, long? defaultAmount = null)
    {
        Emit("amount_entry", new { title, prompt, maxAmount, minAmount, currency, defaultAmount });
    }

    /// <summary>
    /// Emit a shop browse state — paginated list of items the player can buy.
    /// JS renders item cards with price/stats/equip-button. Click sends the
    /// item's index back as text (e.g. "5" for the 5th item on the current
    /// page) which the existing shop code parses. Pagination handled by JS
    /// sending "N" for next page, "P" for prev, "R" for return.
    /// </summary>
    public static void EmitShopBrowse(string shopName, string category, int currentPage,
        int totalPages, List<ShopBrowseItem> items, long playerGold)
    {
        Emit("shop_browse", new { shopName, category, currentPage, totalPages, items, playerGold });
    }

    // ─── Phase 6 Dialogue + Quest Events ──────
    //
    // Dialogue rendering used by both DialogueSystem (tree-driven, branching
    // story dialogue) and VisualNovelDialogueSystem (NPC chat with relationship
    // tracking). Pattern C — each emit shows current dialogue state, JS sends
    // back numeric choice via stdin matching the same input the text path reads.

    /// <summary>
    /// Emit one dialogue node — speaker, body text, and the available numbered
    /// choices. Closes with a "0" / "Say nothing" or "End conversation" entry
    /// the JS side renders as the dismiss button. portraitKey lets the JS pick
    /// a portrait sprite (e.g., "npc:Aldric", "race:Elf", "class:Cleric") with
    /// fallback chain: NPC-specific → race+class → race → default silhouette.
    /// </summary>
    public static void EmitDialogue(string speaker, string? portraitKey, string text,
        List<DialogueChoiceData> choices, string? relationLabel = null,
        string? relationColor = null, string? mood = null)
    {
        Emit("dialogue", new { speaker, portraitKey, text, choices, relationLabel, relationColor, mood });
    }

    /// <summary>
    /// Signal the JS side to dismiss the dialogue overlay (return to underlying
    /// location screen). Called when dialogue ends or the player picks "End".
    /// </summary>
    public static void EmitDialogueClose()
    {
        Emit("dialogue_close", new { });
    }

    /// <summary>
    /// Emit a quest list — used by Quest Hall sub-flows (View Available, View
    /// Active, Claim, Turn In, Abandon). Player picks a quest by typing/clicking
    /// the numeric Key; the existing parser handles it. listType controls JS
    /// rendering: "available" / "active" / "claim" / "turnin" / "abandon" /
    /// "bounty".
    /// </summary>
    public static void EmitQuestList(string listType, string title, List<QuestSummaryData> quests)
    {
        Emit("quest_list", new { listType, title, quests });
    }

    /// <summary>
    /// Emit detailed quest data for a confirm/accept modal. JS shows the quest
    /// card with full description, objectives, level range, reward breakdown,
    /// and Y/N buttons. Confirm input goes back via existing GetInput parser.
    /// </summary>
    public static void EmitQuestDetails(QuestDetailData quest, string confirmAction)
    {
        Emit("quest_details", new { quest, confirmAction });
    }

    /// <summary>
    /// Emit a quest completion state — the rewards screen shown when the player
    /// turns in a finished quest. JS plays a celebratory animation with the
    /// reward icons. Followed by EmitPressAnyKey to dismiss.
    /// </summary>
    public static void EmitQuestComplete(QuestDetailData quest, QuestRewardData rewards)
    {
        Emit("quest_complete", new { quest, rewards });
    }

    /// <summary>
    /// Emit the active-quest log overlay (the player's current quests with
    /// progress bars). Read-only; player presses any key to dismiss.
    /// </summary>
    public static void EmitQuestLog(List<QuestDetailData> activeQuests)
    {
        Emit("quest_log", new { activeQuests });
    }

    // ─── Phase 7 Lifecycle Events ─────────────
    //
    // Cross-cutting events fired during gameplay that warrant their own focused
    // overlay: level-up celebration, death + resurrection menu, achievement
    // toasts, ending end cards, NG+ transition, immortal ascension, and Old
    // God boss phase transitions. All non-modal except where the underlying
    // text path blocks on player input (death menu, ending Y/N, NG+ Y/N,
    // ascension Y/N, divine name prompt) — those use Pattern B (emit + share
    // existing GetInput) so the same parser handles both modes.

    /// <summary>
    /// Emit a level-up celebration. Non-modal toast/overlay. JS shows a
    /// transient "LEVEL X!" banner with stat increases and dismisses on a
    /// short timer or any key. The auto-level-up path doesn't block input,
    /// so the overlay must self-dismiss.
    /// </summary>
    public static void EmitLevelUp(int newLevel, string className, LevelUpStatGains gains,
        bool isMilestone = false)
    {
        Emit("level_up", new { newLevel, className, gains, isMilestone });
    }

    /// <summary>
    /// Emit the death screen state. JS renders full-screen tombstone with
    /// killer name, penalty breakdown, and either the resurrection Y/N
    /// buttons (normal death) or "permadeath — your save will be deleted"
    /// notice (nightmare/permadeath path). Player input flows through the
    /// shared GetInput so Y/N or any-key works in both modes.
    /// </summary>
    public static void EmitDeath(DeathScreenData data)
    {
        Emit("death", data);
    }

    /// <summary>
    /// Emit an achievement-unlocked toast notification. Non-blocking; the JS
    /// side queues it as a stack-up toast in the corner. Tier styles the
    /// border + glow color (Bronze through Diamond).
    /// </summary>
    public static void EmitAchievementToast(string id, string name, string description,
        string tier, long goldReward = 0, long xpReward = 0, int fameReward = 0,
        bool isBroadcast = false)
    {
        Emit("achievement_toast", new
        {
            id, name, description, tier,
            goldReward, xpReward, fameReward, isBroadcast
        });
    }

    /// <summary>
    /// Emit a full-screen ending card. endingType is "Usurper" / "Savior" /
    /// "Defiant" / "TrueEnding" / "Dissolution" / "Renouncer". JS plays the
    /// matching cinematic background, scrolls credits + epilogue, and shows
    /// the Y/N immortal/NG+ prompt (which flows through shared GetInput).
    /// </summary>
    public static void EmitEnding(EndingScreenData data)
    {
        Emit("ending", data);
    }

    /// <summary>
    /// Emit the NG+ transition prompt — separate from the ending card so
    /// players who renounce later (from the Pantheon) see the same UI.
    /// </summary>
    public static void EmitNewGamePlusPrompt(int currentCycle, int nextCycle,
        List<string> carryoverBonuses)
    {
        Emit("ng_plus_prompt", new { currentCycle, nextCycle, carryoverBonuses });
    }

    /// <summary>
    /// Emit the immortal ascension cinematic. JS shows Manwe's dialogue,
    /// the divine name input field, and the Y/N confirm buttons. The divine
    /// name + confirm flow back through shared GetInput.
    /// </summary>
    public static void EmitImmortalAscension(ImmortalAscensionData data)
    {
        Emit("immortal_ascension", data);
    }

    /// <summary>
    /// Emit an Old God boss phase transition. Non-blocking — combat continues
    /// after the overlay's animation timer expires. JS plays a brief banner
    /// with the boss name, new phase number, dialogue line, and a flavor of
    /// "grows more powerful" or "unleashes their true form".
    /// </summary>
    public static void EmitBossPhaseTransition(string bossName, int newPhase,
        long bossHp, long bossMaxHp, List<string> dialogue, string flavorText,
        bool isPhysicalImmune = false, bool isMagicalImmune = false)
    {
        Emit("boss_phase_transition", new
        {
            bossName, newPhase, bossHp, bossMaxHp,
            dialogue, flavorText, isPhysicalImmune, isMagicalImmune
        });
    }

    // ─── Phase 8 Online Multiplayer Events ────
    //
    // Online-mode-only surfaces wired into a single-player Electron client
    // running against the shared MUD server. All non-modal except group invite
    // and spectator request which use Pattern B (emit + share existing
    // /accept | /deny command parsing).

    /// <summary>
    /// Emit a chat broadcast (gossip / shout / tell / guild / system). JS
    /// renders into a persistent always-on chat panel with channel filtering
    /// and timestamps. perspective="actor" means the local player sent it
    /// (rendered with "You" prefix); "observer" means someone else sent it.
    /// </summary>
    public static void EmitChat(string channel, string sender, string message,
        string perspective = "observer", string? targetName = null)
    {
        Emit("chat_broadcast", new
        {
            channel,
            sender,
            message,
            perspective,
            targetName,
            timestamp = DateTime.UtcNow.ToString("o")
        });
    }

    /// <summary>
    /// Emit an inbound group invite. JS shows a modal with Accept/Decline
    /// buttons; the buttons send "/accept" or "/deny" through stdin so the
    /// existing chat command parser handles the response. timeoutSeconds
    /// drives a JS countdown so the modal auto-dismisses if the player
    /// doesn't respond.
    /// </summary>
    public static void EmitGroupInvite(string fromName, int currentSize, int maxSize,
        int timeoutSeconds = 60)
    {
        Emit("group_invite", new { fromName, currentSize, maxSize, timeoutSeconds });
    }

    /// <summary>
    /// Emit the "While You Were Gone" news feed at login. JS shows a focused
    /// dismissable panel with the sectioned news items, unread mail count,
    /// pending trade count, and PvP attack outcomes. Press-any-key dismisses.
    /// </summary>
    public static void EmitNewsFeed(NewsFeedData data)
    {
        Emit("news_feed", data);
    }

    /// <summary>
    /// Emit an inbound spectator request — another player wants to watch
    /// this session's terminal. Modal with Accept/Decline buttons that send
    /// "/accept" or "/deny" through stdin. JS shows a small focused dialog.
    /// </summary>
    public static void EmitSpectateRequest(string fromName, int timeoutSeconds = 60)
    {
        Emit("spectate_request", new { fromName, timeoutSeconds });
    }

    /// <summary>
    /// Emit the current spectator state — list of players currently watching
    /// this session, plus whether this player is themselves spectating someone
    /// else. Non-modal; JS shows a small persistent indicator.
    /// </summary>
    public static void EmitSpectatorState(List<string> watchers, string? watchingTarget)
    {
        Emit("spectator_state", new { watchers, watchingTarget });
    }

    // ─── Phase 9 Settings + Polish ─────────────

    /// <summary>
    /// Emit the settings screen state — current values + available options for
    /// language, font size, screen reader, compact mode, and art toggle. JS
    /// renders a focused settings card. Changes flow back via "/settings KEY:VALUE"
    /// slash commands the C# side parses.
    /// </summary>
    public static void EmitSettingsScreen(SettingsScreenData data)
    {
        Emit("settings", data);
    }

    /// <summary>
    /// Emit a transient "settings updated" toast confirming a change took effect.
    /// </summary>
    public static void EmitSettingsApplied(string settingKey, string newValue)
    {
        Emit("settings_applied", new { settingKey, newValue });
    }

    // ─── Phase 9.5 Audio Infrastructure ─────────
    //
    // Audio is wired through a single EmitSound() helper. Each soundId maps to
    // a JS-side Web Audio buffer in audio.js. The actual audio assets are
    // generated separately (see project_graphical_client.md "Audio infrastructure"
    // backlog item). For v1 the Electron client ignores unknown soundIds gracefully
    // — emitting from C# is safe even before assets exist.
    //
    // Convention: soundIds are dotted lowercase like Loc.Get keys.
    // - "sfx.combat.hit" / "sfx.combat.crit" / "sfx.combat.miss"
    // - "sfx.level_up" / "sfx.death" / "sfx.victory"
    // - "sfx.ui.click" / "sfx.ui.menu_open" / "sfx.ui.menu_close"
    // - "sfx.achievement.bronze" .. ".diamond"
    // - "sfx.boss.phase_transition" / "sfx.boss.kill"
    // - "music.location.{name}" for ambient location loops (long-running)

    /// <summary>
    /// Emit a sound trigger to the Electron client. Volume in [0.0, 1.0],
    /// pitch in [0.5, 2.0] for slight randomization. JS side resolves soundId
    /// to a Web Audio buffer and plays through the configured channel mixer.
    /// </summary>
    public static void EmitSound(string soundId, float volume = 1.0f, float pitch = 1.0f,
        string channel = "sfx")
    {
        Emit("sound", new { soundId, volume, pitch, channel });
    }

    /// <summary>
    /// Stop an actively playing sound (typically used for ambient location music
    /// when changing locations).
    /// </summary>
    public static void EmitSoundStop(string soundId)
    {
        Emit("sound_stop", new { soundId });
    }

    /// <summary>
    /// Set per-channel volume (0.0–1.0). Persisted client-side via localStorage.
    /// Channels: "master" / "sfx" / "music" / "ui".
    /// </summary>
    public static void EmitVolumeSet(string channel, float volume)
    {
        Emit("volume_set", new { channel, volume });
    }

    // ─── Data Types ───────────────────────────

    public class ChoiceOption
    {
        public string Key { get; set; } = "";
        public string Label { get; set; } = "";
        public string? Style { get; set; }  // "danger", "treasure", "info", etc.
    }

    public class TargetOption
    {
        public int Index { get; set; }
        public string Name { get; set; } = "";
        public long Hp { get; set; }
        public long MaxHp { get; set; }
        public string? Status { get; set; }
    }

    public class MenuItemData
    {
        public string Key { get; set; } = "";
        public string Label { get; set; } = "";
        public string? Category { get; set; }
        public string? Icon { get; set; }
    }

    public class NPCPresenceData
    {
        public string Name { get; set; } = "";
        public string? Activity { get; set; }
        public string? Class { get; set; }
        public int? Level { get; set; }
    }

    public class ShopItemData
    {
        public string Name { get; set; } = "";
        public int Price { get; set; }
        public string Slot { get; set; } = "";
        public int Power { get; set; }
        public string? Rarity { get; set; }
    }

    /// <summary>
    /// One save slot's data for the save selection screen. IsRecovered /
    /// IsEmergency from v0.57.18 surface as styling hints to JS.
    /// </summary>
    public class SaveSlotData
    {
        public string SlotKey { get; set; } = "";    // "1" or "2" or whatever the input key is
        public string CharacterName { get; set; } = "";
        public int Level { get; set; }
        public string ClassName { get; set; } = "";
        public string RaceName { get; set; } = "";
        public bool IsImmortal { get; set; }
        public string? LastPlayed { get; set; }       // ISO8601 string
        public bool IsRecovered { get; set; }         // tagged [RECOVERY]
        public bool IsEmergency { get; set; }         // tagged [EMERGENCY SAVE]
        public bool IsAlt { get; set; }
    }

    /// <summary>
    /// One recovery file in the recovery menu (backup, autosaves, emergency).
    /// </summary>
    public class RecoveryFileData
    {
        public string Key { get; set; } = "";         // "1", "2", "3" — the input key
        public string Label { get; set; } = "";       // "Backup from 2026-04-25 12:34"
        public string Path { get; set; } = "";        // absolute path
        public long SizeBytes { get; set; }
    }

    /// <summary>
    /// One item in a paginated shop-browse view. Index is the on-page number
    /// (1-based) the user types/clicks to select; the shop's existing parser
    /// handles the buy flow from there.
    /// </summary>
    public class ShopBrowseItem
    {
        public string Key { get; set; } = "";          // "1".."10" — what gets sent on click
        public string Name { get; set; } = "";
        public string Slot { get; set; } = "";         // "Weapon", "Body", "Head", etc.
        public long Price { get; set; }
        public int Power { get; set; }                 // attack for weapons, armor for armor
        public int MinLevel { get; set; }
        public string? Rarity { get; set; }            // styling hint
        public bool Affordable { get; set; }           // playerGold >= Price
        public bool LevelOk { get; set; }              // playerLevel >= MinLevel
        public bool ClassOk { get; set; }              // class restrictions pass
        public Dictionary<string, int>? Bonuses { get; set; }
    }

    /// <summary>
    /// One choice button in a dialogue overlay. Key is what gets typed/sent
    /// (typically "1".."N", or "0" for dismiss). Style is a JS rendering hint
    /// for color: "normal" / "flirt" / "intimate" / "hostile" / "danger" /
    /// "info" / "confess" / "propose" / "leave".
    /// </summary>
    public class DialogueChoiceData
    {
        public string Key { get; set; } = "";
        public string Text { get; set; } = "";
        public string? Style { get; set; }
        public bool Disabled { get; set; }
        public string? DisabledReason { get; set; }
    }

    /// <summary>
    /// Compact quest entry for a list overlay. Key is the numeric input the
    /// player types/clicks to select. Difficulty drives styling. Progress is
    /// a "3/5" style string for active quests; null for available/board.
    /// </summary>
    public class QuestSummaryData
    {
        public string Key { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string Difficulty { get; set; } = "";
        public int MinLevel { get; set; }
        public int MaxLevel { get; set; }
        public string? Progress { get; set; }
        public string? Status { get; set; }
        public bool Eligible { get; set; } = true;
        public string? IneligibleReason { get; set; }
    }

    /// <summary>
    /// Full quest detail for the accept/turn-in/log modal. Objectives is a
    /// list of "(2/5) Defeat 5 wolves" style strings ready to render. Reward
    /// strings are localized and ready to display.
    /// </summary>
    public class QuestDetailData
    {
        public string Id { get; set; } = "";
        public string Title { get; set; } = "";
        public string Description { get; set; } = "";
        public string Difficulty { get; set; } = "";
        public int MinLevel { get; set; }
        public int MaxLevel { get; set; }
        public List<string> Objectives { get; set; } = new();
        public string? Giver { get; set; }
        public string? Status { get; set; }            // active / available / completed / failed
        public string? TimeLimit { get; set; }
        public QuestRewardData? Reward { get; set; }
    }

    /// <summary>
    /// Quest reward summary. All numeric fields default to 0; non-zero fields
    /// drive which icons render in the JS overlay.
    /// </summary>
    public class QuestRewardData
    {
        public long Gold { get; set; }
        public long Experience { get; set; }
        public int Potions { get; set; }
        public int ManaPotions { get; set; }
        public long Chivalry { get; set; }
        public long Darkness { get; set; }
        public string? ItemName { get; set; }
        public List<string> Extras { get; set; } = new();
    }

    /// <summary>
    /// Per-class stat increases applied at level-up. Non-zero fields drive
    /// which stat icons render in the level-up celebration overlay.
    /// </summary>
    public class LevelUpStatGains
    {
        public int MaxHp { get; set; }
        public int MaxMana { get; set; }
        public int MaxStamina { get; set; }
        public int Strength { get; set; }
        public int Defence { get; set; }
        public int Dexterity { get; set; }
        public int Constitution { get; set; }
        public int Intelligence { get; set; }
        public int Wisdom { get; set; }
        public int Charisma { get; set; }
        public int Agility { get; set; }
        public int TrainingPoints { get; set; }
        public long ChivalryBonus { get; set; }
        public long DarknessBonus { get; set; }
    }

    /// <summary>
    /// Death screen payload — shows tombstone + penalty + resurrection menu.
    /// IsPermadeath disables the resurrection options entirely.
    /// </summary>
    public class DeathScreenData
    {
        public string KilledBy { get; set; } = "";
        public string DeathMessage { get; set; } = "";
        public long XpLoss { get; set; }
        public long GoldLoss { get; set; }
        public int FameLoss { get; set; }
        public List<string> ItemsLost { get; set; } = new();
        public bool IsPermadeath { get; set; }
        public bool IsNightmareMode { get; set; }
        public bool ResurrectionOffered { get; set; }
        public string? ResurrectionPrompt { get; set; }
        public List<string> TeammateFarewells { get; set; } = new();
    }

    /// <summary>
    /// Ending screen payload — full-screen end card with credits, epilogue,
    /// and final stats. EndingType drives the cinematic background sprite.
    /// </summary>
    public class EndingScreenData
    {
        public string EndingType { get; set; } = "";       // Usurper / Savior / Defiant / TrueEnding / Dissolution / Renouncer
        public string Title { get; set; } = "";
        public string Subtitle { get; set; } = "";
        public List<string> Credits { get; set; } = new();
        public List<string> Epilogue { get; set; } = new();
        public string? WorldImpact { get; set; }
        public int FinalLevel { get; set; }
        public long TotalKills { get; set; }
        public long TotalGold { get; set; }
        public int FameFinal { get; set; }
        public int CycleNumber { get; set; }
        public long PlayTimeSeconds { get; set; }
        public List<string> UnlockedAchievements { get; set; } = new();
        public bool ImmortalityOffered { get; set; }
        public bool NgPlusOffered { get; set; }
    }

    /// <summary>
    /// Immortal ascension cinematic payload. PromptStage controls which step
    /// the JS shows: "offer" (Y/N), "name" (text input), "confirmed" (final
    /// "you are now a god" celebration).
    /// </summary>
    public class ImmortalAscensionData
    {
        public string PromptStage { get; set; } = "offer";  // offer / name / confirmed
        public string CharacterName { get; set; } = "";
        public string ClassName { get; set; } = "";
        public List<string> ManweDialogue { get; set; } = new();
        public List<string> Benefits { get; set; } = new();
        public string? DivineName { get; set; }
        public bool IsKing { get; set; }
        public bool BlockedReason { get; set; }
        public string? BlockedMessage { get; set; }
    }

    /// <summary>
    /// "While You Were Gone" payload shown on login. Sections render as a
    /// scrollable feed with section headers and per-item icons.
    /// </summary>
    public class NewsFeedData
    {
        public string CharacterName { get; set; } = "";
        public string? LastSeen { get; set; }              // ISO-8601 string for time-since
        public List<NewsFeedSection> Sections { get; set; } = new();
        public int UnreadMailCount { get; set; }
        public int PendingTradeCount { get; set; }
        public int UnreadMessages { get; set; }
    }

    public class NewsFeedSection
    {
        public string Title { get; set; } = "";
        public string Icon { get; set; } = "";
        public List<NewsFeedItem> Items { get; set; } = new();
    }

    public class NewsFeedItem
    {
        public string Text { get; set; } = "";
        public string? Type { get; set; }                  // "pvp_attack" / "world_event" / "guild" / "system"
        public string? Timestamp { get; set; }
        public long? GoldDelta { get; set; }
        public bool IsBad { get; set; }
        public bool IsGood { get; set; }
    }

    /// <summary>
    /// Settings screen payload — current values + supported options. JS renders
    /// pickers/toggles and pipes user choices back through "/settings" slash
    /// commands so the same parser handles the change in both modes.
    /// </summary>
    public class SettingsScreenData
    {
        public string CurrentLanguage { get; set; } = "en";
        public List<SettingsLanguageOption> AvailableLanguages { get; set; } = new();
        public bool ScreenReaderMode { get; set; }
        public bool CompactMode { get; set; }
        public bool DisableCharacterMonsterArt { get; set; }
        public string DateFormat { get; set; } = "MM/DD/YYYY";
        public string Orientation { get; set; } = "Bisexual";
    }

    public class SettingsLanguageOption
    {
        public string Code { get; set; } = "en";
        public string DisplayName { get; set; } = "";
        public bool IsCurrent { get; set; }
    }
}
