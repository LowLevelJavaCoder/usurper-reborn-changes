using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using UsurperRemake.Data;
using UsurperRemake.Systems;

namespace UsurperRemake.Editor;

/// <summary>
/// Comprehensive player-save editor. Loads a save JSON, deserializes to
/// <see cref="SaveGameData"/>, lets the user modify nearly any field
/// through nested category menus, then serializes back to disk.
///
/// This class is deliberately long. Every top-level menu item below has
/// its own region so you can navigate by category; each region owns a
/// small set of methods that edit one concern. All editing happens on
/// the in-memory <see cref="SaveGameData"/> graph — the only I/O is the
/// initial load, the backup-on-save, and the final serialize. No game
/// systems are loaded, no network is opened, and a running game server
/// is unaffected unless the sysop is editing the same save file that
/// server has open (in which case the last writer wins — the intro
/// banner warns about that).
///
/// Design notes:
///   - Every menu choice is non-destructive until the user picks "Save changes".
///   - Before overwriting a save file we copy it to <c>.bak</c> alongside itself.
///   - Power users can still hand-edit the JSON for anything not exposed here —
///     this editor is a convenience over the file, not a replacement for it.
/// </summary>
internal static class PlayerSaveEditor
{
    public static async Task RunAsync()
    {
        EditorIO.Section("Player Saves");
        var backend = new FileSaveBackend();
        var saveDir = backend.GetSaveDirectory();
        EditorIO.Info($"Save directory: {saveDir}");

        var saves = backend.GetAllSaves();
        if (saves.Count == 0)
        {
            EditorIO.Warn("No save files found in that directory.");
            EditorIO.Pause();
            return;
        }

        var ordered = saves.OrderByDescending(s => s.SaveTime).ToList();
        var labels = ordered
            .Select(s => $"{s.PlayerName,-24} L{s.Level,-3} {s.ClassName,-12} last saved {s.SaveTime:yyyy-MM-dd HH:mm}")
            .ToList();
        int pick = EditorIO.Menu("Pick a save to edit (most recent first):", labels);
        if (pick == 0) return;

        var chosen = ordered[pick - 1];
        var fileName = SanitizeFileName(chosen.PlayerName);
        var path = Path.Combine(saveDir, fileName + ".json");
        if (!File.Exists(path))
        {
            EditorIO.Error($"Expected save file not found: {path}");
            EditorIO.Pause();
            return;
        }

        SaveGameData? data;
        try
        {
            var json = await File.ReadAllTextAsync(path);
            data = JsonSerializer.Deserialize<SaveGameData>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
        }
        catch (Exception ex)
        {
            EditorIO.Error($"Failed to parse save JSON: {ex.Message}");
            EditorIO.Pause();
            return;
        }
        if (data == null || data.Player == null)
        {
            EditorIO.Error("Save file produced null data. Aborting.");
            EditorIO.Pause();
            return;
        }

        bool dirty = false;
        while (true)
        {
            var p = data.Player;
            EditorIO.Section($"Editing: {p.Name2} (L{p.Level} {p.Class}, {p.Race}){(dirty ? "  [UNSAVED CHANGES]" : "")}");
            int choice = EditorIO.Menu("Choose category:", new[]
            {
                "Character Info           — name, class, race, alignment, fame, knighthood",
                "Stats & Progression      — level, XP, core stats, HP/Mana caps, resurrections",
                "Gold & Economy           — gold, bank, loan, team wages",
                "Inventory & Equipment    — items, equipped slots, curses, potions",
                "Spells & Abilities       — learned spells, class abilities, quickbar",
                "Companions               — recruit, revive, loyalty, romance",
                "Quests                   — active, complete, reset, grant",
                "Achievements             — grant, revoke, list",
                "Old Gods & Story         — god states, cycle, seals, artifacts",
                "Relationships & Family   — NPC relationships, marriages, children",
                "Status & Cleanup         — diseases, divine wrath, daily limits, poison",
                "Appearance & Flavor      — height, weight, eyes/hair/skin, phrases, description",
                "Skills & Training        — proficiencies, stat training counts, crafting materials",
                "Team / Guild / Factions  — team info, guild, faction standings",
                "Settings & Preferences   — auto-heal, combat speed, color theme, language",
                "World State              — current king, bank interest, town pot, economy",
                "Show full summary",
                dirty ? "SAVE CHANGES to disk" : "(no changes yet)",
                "Discard changes and exit",
            });
            if (choice == 0 || choice == 19)
            {
                if (dirty && !EditorIO.Confirm("Discard unsaved changes?")) continue;
                return;
            }
            try
            {
                switch (choice)
                {
                    case 1: EditCharacterInfo(p); dirty = true; break;
                    case 2: EditStats(p); dirty = true; break;
                    case 3: EditGold(p); dirty = true; break;
                    case 4: EditInventoryAndEquipment(p); dirty = true; break;
                    case 5: EditSpellsAndAbilities(p); dirty = true; break;
                    case 6: EditCompanions(data); dirty = true; break;
                    case 7: EditQuests(p); dirty = true; break;
                    case 8: EditAchievements(p); dirty = true; break;
                    case 9: EditStoryAndGods(data); dirty = true; break;
                    case 10: EditRelationshipsAndFamily(data); dirty = true; break;
                    case 11: EditStatusAndCleanup(p); dirty = true; break;
                    case 12: EditAppearance(p); dirty = true; break;
                    case 13: EditSkillsAndTraining(p); dirty = true; break;
                    case 14: EditTeamAndGuild(p); dirty = true; break;
                    case 15: EditSettings(p); dirty = true; break;
                    case 16: EditWorldState(data); dirty = true; break;
                    case 17: ShowSummary(p); break;
                    case 18:
                        if (!dirty) { EditorIO.Info("Nothing to save."); EditorIO.Pause(); break; }
                        if (SaveBack(path, data)) dirty = false;
                        break;
                }
            }
            catch (Exception ex)
            {
                EditorIO.Error($"Editor action failed: {ex.Message}");
                EditorIO.Info(ex.StackTrace ?? "");
                EditorIO.Pause();
            }
        }
    }

    // FileSaveBackend.SanitizeFileName is private; mirror its behavior here.
    private static string SanitizeFileName(string name)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var ch in name)
            sb.Append(char.IsLetterOrDigit(ch) ? ch : '_');
        return sb.ToString();
    }

    private static bool SaveBack(string path, SaveGameData data)
    {
        try
        {
            var backupPath = path + ".bak";
            File.Copy(path, backupPath, overwrite: true);
            var json = JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(path, json);
            EditorIO.Success($"Saved. Backup at: {backupPath}");
            EditorIO.Pause();
            return true;
        }
        catch (Exception ex)
        {
            EditorIO.Error($"Write failed: {ex.Message}");
            EditorIO.Pause();
            return false;
        }
    }

    #region Character Info

    private static void EditCharacterInfo(PlayerData p)
    {
        EditorIO.Section("Character Info");
        p.Name2 = EditorIO.PromptString("Display name", p.Name2);
        p.Name1 = EditorIO.PromptString("Internal name (rarely used — match display name if unsure)", p.Name1);
        p.RealName = EditorIO.PromptString("Real name (narrative, can be blank)", p.RealName);

        EditorIO.Info("Class and race are USUALLY risky to change — stats tied to class-per-level won't re-apply.");
        EditorIO.Info("Change only if you know what you're doing or are willing to tweak stats manually after.");
        if (EditorIO.Confirm("Change class?"))
            p.Class = EditorIO.PromptEnum("Class", p.Class);
        if (EditorIO.Confirm("Change race?"))
            p.Race = EditorIO.PromptEnum("Race", p.Race);

        var sexChoice = EditorIO.PromptChoice("Sex", new[] { "M", "F" }, p.Sex.ToString(), allowCustom: false);
        if (!string.IsNullOrEmpty(sexChoice)) p.Sex = sexChoice[0];
        p.Age = EditorIO.PromptInt("Age", p.Age, min: 1, max: 2000);

        EditorIO.Info("— Alignment —");
        p.Chivalry = EditorIO.PromptLong("Chivalry (0-1000 in-game cap)", p.Chivalry, min: 0);
        p.Darkness = EditorIO.PromptLong("Darkness (0-1000 in-game cap)", p.Darkness, min: 0);

        EditorIO.Info("— Social standing —");
        p.Fame = EditorIO.PromptInt("Fame", p.Fame, min: 0);
        p.IsKnighted = EditorIO.PromptBool("Knighted (Sir/Dame prefix)", p.IsKnighted);
        p.NobleTitle = EditorIO.PromptString("Noble title (blank = auto)", p.NobleTitle ?? "");
        if (string.IsNullOrWhiteSpace(p.NobleTitle)) p.NobleTitle = null;
        p.King = EditorIO.PromptBool("Is the current king?", p.King);
        p.Immortal = EditorIO.PromptBool("Immortal (ascended, online pantheon)", p.Immortal);

        EditorIO.Info("— Difficulty —");
        p.Difficulty = EditorIO.PromptEnum("Difficulty", p.Difficulty);
    }

    #endregion

    #region Stats & Progression

    private static void EditStats(PlayerData p)
    {
        EditorIO.Section("Stats & Progression");
        EditorIO.Warn("Changing level doesn't retroactively grant per-class stat gains.");
        p.Level = EditorIO.PromptInt("Level", p.Level, min: 1, max: 100);
        p.Experience = EditorIO.PromptLong("Experience", p.Experience, min: 0);

        EditorIO.Info("— Core stats (total = base + equipment bonuses; editor edits total) —");
        p.Strength = EditorIO.PromptLong("STR", p.Strength, min: 0);
        p.Dexterity = EditorIO.PromptLong("DEX", p.Dexterity, min: 0);
        p.Constitution = EditorIO.PromptLong("CON", p.Constitution, min: 0);
        p.Intelligence = EditorIO.PromptLong("INT", p.Intelligence, min: 0);
        p.Wisdom = EditorIO.PromptLong("WIS", p.Wisdom, min: 0);
        p.Charisma = EditorIO.PromptLong("CHA", p.Charisma, min: 0);
        p.Defence = EditorIO.PromptLong("DEF", p.Defence, min: 0);
        p.Agility = EditorIO.PromptLong("AGI", p.Agility, min: 0);
        p.Stamina = EditorIO.PromptLong("STA", p.Stamina, min: 0);

        EditorIO.Info("— HP / Mana —");
        p.MaxHP = EditorIO.PromptLong("MaxHP", p.MaxHP, min: 1);
        p.HP = EditorIO.PromptLong("HP", p.HP, min: 0, max: p.MaxHP);
        p.MaxMana = EditorIO.PromptLong("MaxMana", p.MaxMana, min: 0);
        p.Mana = EditorIO.PromptLong("Mana", p.Mana, min: 0, max: p.MaxMana);

        EditorIO.Info("— Combat power —");
        p.WeapPow = EditorIO.PromptLong("WeaponPower (flat weapon damage)", p.WeapPow, min: 0);
        p.ArmPow = EditorIO.PromptLong("ArmorPower (flat armor)", p.ArmPow, min: 0);

        EditorIO.Info("— Resurrections —");
        p.Resurrections = EditorIO.PromptInt("Resurrections available", p.Resurrections, min: 0);
        p.MaxResurrections = EditorIO.PromptInt("Max resurrections", p.MaxResurrections, min: 0);
        p.ResurrectionsUsed = EditorIO.PromptInt("Resurrections used (lifetime)", p.ResurrectionsUsed, min: 0);

        EditorIO.Info("— Training —");
        p.Trains = EditorIO.PromptInt("Unspent training sessions", p.Trains, min: 0);
        p.TrainingPoints = EditorIO.PromptInt("Training points", p.TrainingPoints, min: 0);
    }

    #endregion

    #region Gold & Economy

    private static void EditGold(PlayerData p)
    {
        EditorIO.Section("Gold & Economy");
        p.Gold = EditorIO.PromptLong("Gold on hand", p.Gold);
        p.BankGold = EditorIO.PromptLong("Bank gold", p.BankGold);
        p.BankLoan = EditorIO.PromptLong("Bank loan owed", p.BankLoan);
        p.BankInterest = EditorIO.PromptLong("Bank interest earned", p.BankInterest);
        p.BankWage = EditorIO.PromptLong("Bank wage", p.BankWage);
        p.RoyalLoanAmount = EditorIO.PromptLong("Royal loan amount", p.RoyalLoanAmount);
        p.RoyTaxPaid = EditorIO.PromptLong("Royal tax paid (lifetime)", p.RoyTaxPaid, min: 0);
    }

    #endregion

    #region Inventory & Equipment

    private static void EditInventoryAndEquipment(PlayerData p)
    {
        while (true)
        {
            int choice = EditorIO.Menu("Inventory & Equipment", new[]
            {
                $"View inventory ({p.Inventory?.Count ?? 0} items)",
                "Add item to inventory (by ID)",
                "Remove item from inventory",
                "Clear entire inventory",
                $"View equipped slots ({p.EquippedItems?.Count ?? 0} equipped)",
                "Equip item in slot (by ID)",
                "Unequip a slot",
                "Clear all equipped items",
                "Uncurse equipped items (weapon/armor/shield flags)",
                $"Potions (heal: {p.Healing}, mana: {p.ManaPotions}, antidote: {p.Antidotes})",
            });
            if (choice == 0) return;
            switch (choice)
            {
                case 1: ListInventory(p); break;
                case 2: AddInventoryItem(p); break;
                case 3: RemoveInventoryItem(p); break;
                case 4:
                    if (EditorIO.Confirm("Clear ALL inventory items?"))
                    { p.Inventory?.Clear(); EditorIO.Success("Inventory cleared."); EditorIO.Pause(); }
                    break;
                case 5: ListEquipped(p); break;
                case 6: EquipItemInSlot(p); break;
                case 7: UnequipSlot(p); break;
                case 8:
                    if (EditorIO.Confirm("Unequip every slot?"))
                    { p.EquippedItems?.Clear(); EditorIO.Success("All slots empty."); EditorIO.Pause(); }
                    break;
                case 9:
                    p.WeaponCursed = false; p.ArmorCursed = false; p.ShieldCursed = false;
                    EditorIO.Success("Curse flags cleared on weapon/armor/shield.");
                    EditorIO.Pause();
                    break;
                case 10: EditPotions(p); break;
            }
        }
    }

    private static void ListInventory(PlayerData p)
    {
        EditorIO.Section($"Inventory ({p.Inventory?.Count ?? 0})");
        if (p.Inventory == null || p.Inventory.Count == 0)
        {
            EditorIO.Info("  (empty)");
            EditorIO.Pause();
            return;
        }
        // Inventory stores full item copies (legacy Pascal Item model), not
        // references to EquipmentDatabase IDs. Show the fields users actually
        // care about.
        for (int i = 0; i < p.Inventory.Count && i < 200; i++)
        {
            var inv = p.Inventory[i];
            EditorIO.Info($"  [{i + 1,3}] {inv.Name,-38} type={inv.Type,-10} val={inv.Value,-7} cursed={inv.IsCursed} identified={inv.IsIdentified}");
        }
        if (p.Inventory.Count > 200) EditorIO.Info($"  ...and {p.Inventory.Count - 200} more (use the JSON for full audit).");
        EditorIO.Pause();
    }

    private static void AddInventoryItem(PlayerData p)
    {
        // The inventory uses the legacy Pascal Item model — each entry is a full
        // copy of an item's stats, not a reference to EquipmentDatabase. So
        // "add by ID" here means: look the ID up in EquipmentDatabase, copy its
        // stats into a new InventoryItemData. The resulting inventory entry is
        // a standalone stat block that doesn't depend on the database existing
        // on load, which also means deleting a mod won't orphan the save.
        int id = EditorIO.PromptInt("Equipment ID to copy into inventory (built-ins start at 1000, custom at 200000)", 1000);
        var eq = EquipmentDatabase.GetById(id);
        if (eq == null)
        {
            EditorIO.Warn($"No equipment found with ID {id}.");
            EditorIO.Pause();
            return;
        }
        EditorIO.Info($"Found: {eq.Name} ({eq.Slot}, rarity={eq.Rarity}, value={eq.Value})");
        p.Inventory ??= new List<InventoryItemData>();
        p.Inventory.Add(new InventoryItemData
        {
            Name = eq.Name,
            Value = eq.Value,
            Attack = eq.WeaponPower,
            Armor = eq.ArmorClass,
            Strength = eq.StrengthBonus,
            Dexterity = eq.DexterityBonus,
            Wisdom = eq.WisdomBonus,
            Defence = eq.DefenceBonus,
            BlockChance = eq.BlockChance,
            ShieldBonus = eq.ShieldBonus,
            HP = eq.MaxHPBonus,
            Mana = eq.MaxManaBonus,
            Charisma = eq.CharismaBonus,
            Agility = eq.AgilityBonus,
            Stamina = eq.StaminaBonus,
            MinLevel = eq.MinLevel,
            IsCursed = eq.IsCursed,
            IsIdentified = true,
        });
        EditorIO.Success($"Added \"{eq.Name}\" to inventory.");
        EditorIO.Pause();
    }

    private static void RemoveInventoryItem(PlayerData p)
    {
        if (p.Inventory == null || p.Inventory.Count == 0)
        { EditorIO.Warn("Inventory is empty."); EditorIO.Pause(); return; }
        int idx = EditorIO.PromptInt($"Entry number to remove (1..{p.Inventory.Count})", 1, min: 1, max: p.Inventory.Count);
        var match = p.Inventory[idx - 1];
        p.Inventory.RemoveAt(idx - 1);
        EditorIO.Success($"Removed \"{match.Name}\".");
        EditorIO.Pause();
    }

    private static void ListEquipped(PlayerData p)
    {
        EditorIO.Section($"Equipped slots ({p.EquippedItems?.Count ?? 0})");
        if (p.EquippedItems == null || p.EquippedItems.Count == 0)
        { EditorIO.Info("  (nothing equipped)"); EditorIO.Pause(); return; }
        foreach (var kv in p.EquippedItems)
        {
            string slotName = ((EquipmentSlot)kv.Key).ToString();
            string itemName = ResolveItemName(kv.Value) ?? "<unknown>";
            EditorIO.Info($"  {slotName,-12} ID:{kv.Value,-7} {itemName}");
        }
        EditorIO.Info($"  WeaponCursed={p.WeaponCursed} ArmorCursed={p.ArmorCursed} ShieldCursed={p.ShieldCursed}");
        EditorIO.Pause();
    }

    private static void EquipItemInSlot(PlayerData p)
    {
        var slot = EditorIO.PromptEnum<EquipmentSlot>("Slot to equip", EquipmentSlot.MainHand);
        int id = EditorIO.PromptInt("Item ID to equip", 1000);
        var eq = EquipmentDatabase.GetById(id);
        if (eq == null)
        {
            EditorIO.Warn($"No item #{id} registered. The equip will be written, but the game may reject it on load.");
            if (!EditorIO.Confirm("Continue?")) return;
        }
        p.EquippedItems ??= new Dictionary<int, int>();
        p.EquippedItems[(int)slot] = id;
        EditorIO.Success($"{slot} = #{id} ({eq?.Name ?? "?"})");
        EditorIO.Pause();
    }

    private static void UnequipSlot(PlayerData p)
    {
        if (p.EquippedItems == null || p.EquippedItems.Count == 0)
        { EditorIO.Warn("Nothing equipped."); EditorIO.Pause(); return; }
        var slot = EditorIO.PromptEnum<EquipmentSlot>("Slot to clear", EquipmentSlot.MainHand);
        if (p.EquippedItems.Remove((int)slot))
            EditorIO.Success($"{slot} cleared.");
        else
            EditorIO.Warn("Slot was already empty.");
        EditorIO.Pause();
    }

    private static void EditPotions(PlayerData p)
    {
        p.Healing = EditorIO.PromptLong("Healing potions", p.Healing, min: 0);
        p.ManaPotions = EditorIO.PromptLong("Mana potions", p.ManaPotions, min: 0);
        p.Antidotes = EditorIO.PromptInt("Antidotes", p.Antidotes, min: 0);
    }

    private static string? ResolveItemName(int id)
    {
        var eq = EquipmentDatabase.GetById(id);
        return eq?.Name;
    }

    #endregion

    #region Spells & Abilities

    private static void EditSpellsAndAbilities(PlayerData p)
    {
        while (true)
        {
            int choice = EditorIO.Menu("Spells & Abilities", new[]
            {
                $"View learned spells ({p.Spells?.Count(s => s != null && s.Count > 0 && s[0]) ?? 0} known)",
                "Learn ALL spells (known, not mastered)",
                "Master ALL spells",
                "Clear all spells",
                $"View learned abilities ({p.LearnedAbilities?.Count ?? 0})",
                "Add ability by ID",
                "Remove ability",
                "Clear all abilities",
                $"View quickbar ({p.Quickbar?.Count ?? 0} slots)",
                "Clear quickbar",
            });
            if (choice == 0) return;
            switch (choice)
            {
                case 1:
                    ListSpells(p); break;
                case 2:
                    GrantAllSpells(p, mastered: false); break;
                case 3:
                    GrantAllSpells(p, mastered: true); break;
                case 4:
                    if (EditorIO.Confirm("Forget ALL spells?")) { p.Spells?.Clear(); EditorIO.Success("Cleared."); EditorIO.Pause(); }
                    break;
                case 5:
                    if (p.LearnedAbilities == null || p.LearnedAbilities.Count == 0)
                        EditorIO.Info("(none)");
                    else
                        foreach (var a in p.LearnedAbilities) EditorIO.Info($"  {a}");
                    EditorIO.Pause();
                    break;
                case 6:
                    {
                        // Pick from the live ClassAbilitySystem registry so the user sees
                        // ability names (not raw IDs) and can't grant something that
                        // doesn't exist.
                        var all = ClassAbilitySystem.GetAllAbilities();
                        var labels = all.Select(x => $"{x.Id,-24} ({x.Name}, L{x.LevelRequired})").ToList();
                        int pick = EditorIO.Menu("Ability to grant", labels);
                        if (pick == 0) break;
                        var chosen = all[pick - 1];
                        p.LearnedAbilities ??= new List<string>();
                        if (!p.LearnedAbilities.Contains(chosen.Id))
                        { p.LearnedAbilities.Add(chosen.Id); EditorIO.Success($"Granted {chosen.Name}."); }
                        else
                            EditorIO.Info($"{chosen.Name} already known.");
                        EditorIO.Pause();
                        break;
                    }
                case 7:
                    {
                        if (p.LearnedAbilities == null || p.LearnedAbilities.Count == 0)
                        { EditorIO.Warn("No abilities to remove."); EditorIO.Pause(); break; }
                        int pick = EditorIO.Menu("Ability to remove", p.LearnedAbilities.ToList());
                        if (pick == 0) break;
                        var removed = p.LearnedAbilities[pick - 1];
                        p.LearnedAbilities.RemoveAt(pick - 1);
                        EditorIO.Success($"Removed {removed}.");
                        EditorIO.Pause();
                        break;
                    }
                case 8:
                    if (EditorIO.Confirm("Clear all abilities?"))
                    { p.LearnedAbilities?.Clear(); EditorIO.Success("Cleared."); EditorIO.Pause(); }
                    break;
                case 9:
                    if (p.Quickbar == null || p.Quickbar.Count == 0)
                        EditorIO.Info("(empty)");
                    else
                        for (int i = 0; i < p.Quickbar.Count; i++) EditorIO.Info($"  [{i + 1}] {p.Quickbar[i] ?? "(empty)"}");
                    EditorIO.Pause();
                    break;
                case 10:
                    if (EditorIO.Confirm("Clear quickbar?")) { p.Quickbar?.Clear(); EditorIO.Success("Cleared."); EditorIO.Pause(); }
                    break;
            }
        }
    }

    private static void ListSpells(PlayerData p)
    {
        if (p.Spells == null || p.Spells.Count == 0) { EditorIO.Info("(no spell data)"); EditorIO.Pause(); return; }
        int known = 0, mastered = 0;
        for (int i = 0; i < p.Spells.Count; i++)
        {
            var row = p.Spells[i];
            if (row == null || row.Count == 0) continue;
            if (row[0]) { known++; EditorIO.Info($"  Spell[{i}] known{(row.Count > 1 && row[1] ? ", mastered" : "")}"); }
            if (row.Count > 1 && row[1]) mastered++;
        }
        EditorIO.Info($"  Total known: {known}, mastered: {mastered}");
        EditorIO.Pause();
    }

    private static void GrantAllSpells(PlayerData p, bool mastered)
    {
        // Fill spell matrix with [known=true, mastered=mastered] for a reasonable spell count.
        // Actual spell count is class-dependent and not trivially discoverable from save data,
        // so we set a healthy ceiling of 60 which covers every current caster class's spell list.
        p.Spells ??= new List<List<bool>>();
        while (p.Spells.Count < 60) p.Spells.Add(new List<bool> { false, false });
        for (int i = 0; i < p.Spells.Count; i++)
        {
            var row = p.Spells[i] ?? new List<bool>();
            while (row.Count < 2) row.Add(false);
            row[0] = true;
            row[1] = mastered;
            p.Spells[i] = row;
        }
        EditorIO.Success($"All spells {(mastered ? "mastered" : "learned")}.");
        EditorIO.Pause();
    }

    #endregion

    #region Companions

    private static void EditCompanions(SaveGameData data)
    {
        data.StorySystems ??= new StorySystemsData();
        data.StorySystems.Companions ??= new List<CompanionSaveInfo>();
        while (true)
        {
            int choice = EditorIO.Menu("Companions", new[]
            {
                $"List companions ({data.StorySystems.Companions.Count})",
                "Revive a fallen companion",
                "Set loyalty / trust / romance level",
                "Recruit a companion by ID",
                "Dismiss (un-recruit) a companion",
                "Restore full HP + potions on all active companions (not directly, but set IsDead=false)",
            });
            if (choice == 0) return;
            switch (choice)
            {
                case 1:
                    foreach (var c in data.StorySystems.Companions)
                        EditorIO.Info($"  ID:{c.Id}  recruited:{c.IsRecruited} active:{c.IsActive} dead:{c.IsDead}  L{c.Level}  loyalty:{c.LoyaltyLevel} trust:{c.TrustLevel} romance:{c.RomanceLevel}");
                    EditorIO.Pause();
                    break;
                case 2:
                    ReviveCompanion(data.StorySystems.Companions);
                    break;
                case 3:
                    SetCompanionRelationship(data.StorySystems.Companions);
                    break;
                case 4:
                    {
                        var picked = EditorIO.PromptEnum("Companion to recruit", UsurperRemake.Systems.CompanionId.Aldric);
                        int id = (int)picked;
                        var ex = data.StorySystems.Companions.FirstOrDefault(c => c.Id == id);
                        if (ex == null) { ex = new CompanionSaveInfo { Id = id }; data.StorySystems.Companions.Add(ex); }
                        ex.IsRecruited = true; ex.IsDead = false; ex.IsActive = true;
                        EditorIO.Success($"{picked} set to recruited+active.");
                        EditorIO.Pause();
                        break;
                    }
                case 5:
                    {
                        var picked = EditorIO.PromptEnum("Companion to dismiss", UsurperRemake.Systems.CompanionId.Aldric);
                        int id = (int)picked;
                        var ex = data.StorySystems.Companions.FirstOrDefault(c => c.Id == id);
                        if (ex == null) { EditorIO.Warn("Not found."); EditorIO.Pause(); break; }
                        ex.IsRecruited = false; ex.IsActive = false;
                        EditorIO.Success($"{picked} dismissed.");
                        EditorIO.Pause();
                        break;
                    }
                case 6:
                    foreach (var c in data.StorySystems.Companions.Where(c => c.IsDead))
                        c.IsDead = false;
                    EditorIO.Success("All companions marked alive.");
                    EditorIO.Pause();
                    break;
            }
        }
    }

    private static void ReviveCompanion(List<CompanionSaveInfo> companions)
    {
        var picked = EditorIO.PromptEnum("Companion to revive", UsurperRemake.Systems.CompanionId.Aldric);
        int id = (int)picked;
        var c = companions.FirstOrDefault(x => x.Id == id);
        if (c == null) { EditorIO.Warn($"{picked} is not in the save. Use 'Recruit' first."); EditorIO.Pause(); return; }
        if (!c.IsDead) { EditorIO.Info($"{picked} is not dead."); EditorIO.Pause(); return; }
        c.IsDead = false;
        c.IsRecruited = true;
        EditorIO.Success($"{picked} revived.");
        EditorIO.Pause();
    }

    private static void SetCompanionRelationship(List<CompanionSaveInfo> companions)
    {
        var picked = EditorIO.PromptEnum("Companion", UsurperRemake.Systems.CompanionId.Aldric);
        int id = (int)picked;
        var c = companions.FirstOrDefault(x => x.Id == id);
        if (c == null) { EditorIO.Warn($"{picked} is not in the save. Recruit them first."); EditorIO.Pause(); return; }
        c.LoyaltyLevel = EditorIO.PromptInt("Loyalty (0-100)", c.LoyaltyLevel, min: 0, max: 100);
        c.TrustLevel = EditorIO.PromptInt("Trust (0-100)", c.TrustLevel, min: 0, max: 100);
        c.RomanceLevel = EditorIO.PromptInt("Romance (0-100)", c.RomanceLevel, min: 0, max: 100);
        EditorIO.Success("Updated.");
        EditorIO.Pause();
    }

    #endregion

    #region Quests

    private static void EditQuests(PlayerData p)
    {
        p.ActiveQuests ??= new List<QuestData>();
        while (true)
        {
            int choice = EditorIO.Menu("Quests", new[]
            {
                $"List quests ({p.ActiveQuests.Count})",
                "Mark a quest complete (sets Status)",
                "Cancel a quest",
                "Clear ALL quests",
            });
            if (choice == 0) return;
            switch (choice)
            {
                case 1:
                    if (p.ActiveQuests.Count == 0) { EditorIO.Info("(none)"); EditorIO.Pause(); break; }
                    foreach (var q in p.ActiveQuests)
                        EditorIO.Info($"  [{q.Id}] {q.Title}  status={q.Status}  reward={q.Reward}");
                    EditorIO.Pause();
                    break;
                case 2:
                    {
                        if (p.ActiveQuests.Count == 0) { EditorIO.Warn("No quests to complete."); EditorIO.Pause(); break; }
                        var q = PickQuest(p.ActiveQuests, "Quest to mark complete");
                        if (q == null) break;
                        q.Status = QuestStatus.Completed;
                        EditorIO.Success($"Marked \"{q.Title}\" complete.");
                        EditorIO.Pause();
                        break;
                    }
                case 3:
                    {
                        if (p.ActiveQuests.Count == 0) { EditorIO.Warn("No quests to cancel."); EditorIO.Pause(); break; }
                        var q = PickQuest(p.ActiveQuests, "Quest to cancel");
                        if (q == null) break;
                        q.Status = QuestStatus.Abandoned;
                        EditorIO.Success($"Cancelled \"{q.Title}\".");
                        EditorIO.Pause();
                        break;
                    }
                case 4:
                    if (EditorIO.Confirm("Remove ALL quests from the save?"))
                    { p.ActiveQuests.Clear(); EditorIO.Success("Cleared."); EditorIO.Pause(); }
                    break;
            }
        }
    }

    /// <summary>
    /// Pick a specific quest from the player's active list via an arrow-key
    /// selector. Shows title + status so users can tell them apart when a
    /// character has many quests. Returns null if the user backs out.
    /// </summary>
    private static QuestData? PickQuest(List<QuestData> quests, string title)
    {
        var labels = quests.Select(q => $"[{q.Status}] {q.Title}").ToList();
        int pick = EditorIO.Menu(title, labels);
        if (pick == 0) return null;
        return quests[pick - 1];
    }

    #endregion

    #region Achievements

    private static void EditAchievements(PlayerData p)
    {
        p.Achievements ??= new Dictionary<string, bool>();
        while (true)
        {
            int choice = EditorIO.Menu("Achievements", new[]
            {
                $"List unlocked ({p.Achievements.Count(kv => kv.Value)} of {p.Achievements.Count})",
                "Grant an achievement by ID",
                "Revoke an achievement",
                "Grant ALL known achievements (uses built-in registry)",
                "Revoke ALL",
            });
            if (choice == 0) return;
            switch (choice)
            {
                case 1:
                    foreach (var kv in p.Achievements.OrderBy(k => k.Key))
                        EditorIO.Info($"  {(kv.Value ? "[X]" : "[ ]")} {kv.Key}");
                    EditorIO.Pause();
                    break;
                case 2:
                    {
                        // Pick from the built-in achievement registry so the user sees
                        // human-readable names and tiers.
                        var all = AchievementSystem.GetBuiltInAchievements();
                        var labels = all.Select(a => $"[{a.Tier}] {a.Name,-40} ({a.Id})").ToList();
                        int pick = EditorIO.Menu("Achievement to grant", labels);
                        if (pick == 0) break;
                        p.Achievements[all[pick - 1].Id] = true;
                        EditorIO.Success($"Granted {all[pick - 1].Name}.");
                        EditorIO.Pause();
                        break;
                    }
                case 3:
                    {
                        var granted = p.Achievements.Where(kv => kv.Value).Select(kv => kv.Key).ToList();
                        if (granted.Count == 0) { EditorIO.Warn("No granted achievements to revoke."); EditorIO.Pause(); break; }
                        int pick = EditorIO.Menu("Achievement to revoke", granted);
                        if (pick == 0) break;
                        p.Achievements[granted[pick - 1]] = false;
                        EditorIO.Success($"Revoked {granted[pick - 1]}.");
                        EditorIO.Pause();
                        break;
                    }
                case 4:
                    {
                        foreach (var ach in AchievementSystem.GetBuiltInAchievements())
                            p.Achievements[ach.Id] = true;
                        EditorIO.Success($"Granted {p.Achievements.Count} achievements.");
                        EditorIO.Pause();
                        break;
                    }
                case 5:
                    if (EditorIO.Confirm("Revoke every achievement?"))
                    {
                        foreach (var k in p.Achievements.Keys.ToList()) p.Achievements[k] = false;
                        EditorIO.Success("Revoked.");
                        EditorIO.Pause();
                    }
                    break;
            }
        }
    }

    #endregion

    #region Old Gods & Story

    private static void EditStoryAndGods(SaveGameData data)
    {
        data.StorySystems ??= new StorySystemsData();
        var s = data.StorySystems;
        while (true)
        {
            int choice = EditorIO.Menu("Story & Old Gods", new[]
            {
                $"Old God states ({s.OldGodStates?.Count ?? 0} tracked)",
                "Set Old God status by ID",
                $"Collected seals ({s.CollectedSeals?.Count ?? 0}/7)",
                "Grant all seven seals",
                "Clear seals",
                $"Collected artifacts ({s.CollectedArtifacts?.Count ?? 0})",
                "Grant artifact by ID",
                $"NG+ cycle: {s.CurrentCycle}",
                "Set NG+ cycle",
                $"Completed endings: [{string.Join(",", s.CompletedEndings ?? new())}]",
                "Clear story flags",
            });
            if (choice == 0) return;
            switch (choice)
            {
                case 1:
                    foreach (var kv in s.OldGodStates ?? new())
                        EditorIO.Info($"  God#{kv.Key}  status={kv.Value}");
                    EditorIO.Pause();
                    break;
                case 2:
                    SetOldGodStatus(s);
                    break;
                case 3:
                    foreach (var id in s.CollectedSeals ?? new()) EditorIO.Info($"  Seal #{id}");
                    EditorIO.Pause();
                    break;
                case 4:
                    s.CollectedSeals = new List<int> { 1, 2, 3, 4, 5, 6, 7 };
                    EditorIO.Success("All 7 seals granted.");
                    EditorIO.Pause();
                    break;
                case 5:
                    s.CollectedSeals = new List<int>();
                    EditorIO.Success("Seals cleared.");
                    EditorIO.Pause();
                    break;
                case 6:
                    foreach (var id in s.CollectedArtifacts ?? new()) EditorIO.Info($"  Artifact #{id}");
                    EditorIO.Pause();
                    break;
                case 7:
                    {
                        s.CollectedArtifacts ??= new List<int>();
                        var artifact = EditorIO.PromptEnum("Artifact", ArtifactType.CreatorsEye);
                        if (!s.CollectedArtifacts.Contains((int)artifact)) s.CollectedArtifacts.Add((int)artifact);
                        EditorIO.Success($"Granted {artifact}.");
                        EditorIO.Pause();
                        break;
                    }
                case 8:
                    break; // display-only
                case 9:
                    s.CurrentCycle = EditorIO.PromptInt("NG+ cycle", s.CurrentCycle, min: 1);
                    break;
                case 10:
                    break;
                case 11:
                    if (EditorIO.Confirm("Clear StoryFlags (risky — may unstick or re-stick story)?"))
                    { s.StoryFlags?.Clear(); EditorIO.Success("Cleared."); EditorIO.Pause(); }
                    break;
            }
        }
    }

    private static void SetOldGodStatus(StorySystemsData s)
    {
        s.OldGodStates ??= new Dictionary<int, int>();
        // Use the existing enum names as the picker vocabulary — no more "which
        // integer is Manwe again?" guessing for the user.
        var god = EditorIO.PromptEnum("Old God", OldGodType.Maelketh);
        var status = EditorIO.PromptEnum("Status", GodStatus.Dormant);
        s.OldGodStates[(int)god] = (int)status;
        EditorIO.Success($"{god} = {status}.");
        EditorIO.Pause();
    }

    #endregion

    #region Relationships & Family

    private static void EditRelationshipsAndFamily(SaveGameData data)
    {
        var p = data.Player;
        p.Relationships ??= new Dictionary<string, float>();
        while (true)
        {
            int choice = EditorIO.Menu("Relationships & Family", new[]
            {
                $"List relationships ({p.Relationships.Count})",
                "Set a relationship score by NPC name",
                "Clear all relationships",
                $"Kids: {p.Kids}",
                "Set kid count (simple counter; full Children list editable via JSON)",
                $"Divine wrath level: {p.DivineWrathLevel}",
                "Clear divine wrath (forgive the betrayed god)",
            });
            if (choice == 0) return;
            switch (choice)
            {
                case 1:
                    foreach (var kv in p.Relationships.OrderByDescending(k => k.Value))
                        EditorIO.Info($"  {kv.Key,-25} {kv.Value:F1}");
                    EditorIO.Pause();
                    break;
                case 2:
                    {
                        string name = EditorIO.Prompt("NPC name (exact)");
                        if (string.IsNullOrWhiteSpace(name)) break;
                        float cur = p.Relationships.TryGetValue(name, out var v) ? v : 0;
                        var s = EditorIO.PromptString("Score (-100..100 typical)", cur.ToString("F1"));
                        if (float.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var f))
                        { p.Relationships[name] = f; EditorIO.Success($"{name} = {f}"); }
                        else EditorIO.Warn("Not a number.");
                        EditorIO.Pause();
                        break;
                    }
                case 3:
                    if (EditorIO.Confirm("Clear all relationships?"))
                    { p.Relationships.Clear(); EditorIO.Success("Cleared."); EditorIO.Pause(); }
                    break;
                case 4: break; // display
                case 5:
                    p.Kids = EditorIO.PromptInt("Kid count", p.Kids, min: 0);
                    break;
                case 6: break;
                case 7:
                    p.DivineWrathLevel = 0;
                    p.DivineWrathPending = false;
                    p.DivineWrathTurnsRemaining = 0;
                    p.AngeredGodName = "";
                    p.BetrayedForGodName = "";
                    EditorIO.Success("Divine wrath cleared.");
                    EditorIO.Pause();
                    break;
            }
        }
    }

    #endregion

    #region Status & Cleanup

    private static void EditStatusAndCleanup(PlayerData p)
    {
        while (true)
        {
            int choice = EditorIO.Menu("Status & Cleanup", new[]
            {
                $"Cure diseases (Blind={p.Blind} Plague={p.Plague} Smallpox={p.Smallpox} Measles={p.Measles} Leprosy={p.Leprosy} LoversBane={p.LoversBane})",
                $"Clear poison (Poison={p.Poison}, turns={p.PoisonTurns})",
                "Clear drug addiction / steroid effects",
                "Reset ALL daily counters (fights, brawls, thievery, etc.)",
                "Clear all active status effects",
                "Release from prison",
                "Clear wanted level",
                "Clear murder weight / perma-kill log",
            });
            if (choice == 0) return;
            switch (choice)
            {
                case 1:
                    p.Blind = p.Plague = p.Smallpox = p.Measles = p.Leprosy = p.LoversBane = false;
                    EditorIO.Success("All diseases cured.");
                    EditorIO.Pause();
                    break;
                case 2:
                    p.Poison = 0; p.PoisonTurns = 0; p.GnollP = 0;
                    EditorIO.Success("Poison cleared.");
                    EditorIO.Pause();
                    break;
                case 3:
                    p.Addict = 0; p.SteroidDays = 0; p.DrugEffectDays = 0; p.ActiveDrug = 0;
                    EditorIO.Success("Drug effects cleared.");
                    EditorIO.Pause();
                    break;
                case 4:
                    ResetDailyCounters(p);
                    break;
                case 5:
                    p.ActiveStatuses?.Clear();
                    EditorIO.Success("Status effects cleared.");
                    EditorIO.Pause();
                    break;
                case 6:
                    p.DaysInPrison = 0;
                    p.IsMurderConvict = false;
                    p.CellDoorOpen = false;
                    p.PrisonEscapes = 3;
                    EditorIO.Success("Released from prison.");
                    EditorIO.Pause();
                    break;
                case 7:
                    p.WantedLvl = 0;
                    EditorIO.Success("Wanted level = 0.");
                    EditorIO.Pause();
                    break;
                case 8:
                    p.MurderWeight = 0;
                    p.PermakillLog?.Clear();
                    EditorIO.Success("Murder weight cleared.");
                    EditorIO.Pause();
                    break;
            }
        }
    }

    private static void ResetDailyCounters(PlayerData p)
    {
        EditorIO.Info("Resetting all daily limits to fresh values...");
        p.Fights = GameConfig.DefaultDungeonFights;
        p.PFights = GameConfig.DefaultPlayerFights;
        p.TFights = GameConfig.DefaultTeamFights;
        p.Thiefs = GameConfig.DefaultThiefAttempts;
        p.Brawls = GameConfig.DefaultBrawls;
        p.Assa = GameConfig.DefaultAssassinAttempts;
        p.DarkNr = 0;
        p.ChivNr = 0;
        p.ThroneChallengedToday = false;
        p.ExecutionsToday = 0;
        p.NPCsImprisonedToday = 0;
        p.PlayerImprisonedToday = false;
        p.BankRobberyAttempts = 0;
        p.TempleResurrectionsUsed = 0;
        EditorIO.Success("Daily counters reset. Play as if a new day began.");
        EditorIO.Pause();
    }

    #endregion

    #region Summary

    private static void ShowSummary(PlayerData p)
    {
        EditorIO.Section($"{p.Name2}  —  L{p.Level} {p.Race} {p.Class}");
        EditorIO.Info($"  HP:   {p.HP} / {p.MaxHP}   Mana: {p.Mana} / {p.MaxMana}");
        EditorIO.Info($"  XP:   {p.Experience}   Fame: {p.Fame}{(p.IsKnighted ? " (knighted)" : "")}{(p.King ? " — CURRENT KING" : "")}");
        EditorIO.Info($"  Gold: {p.Gold} (bank: {p.BankGold}, loan: {p.BankLoan})");
        EditorIO.Info($"  STR {p.Strength}  DEX {p.Dexterity}  CON {p.Constitution}  INT {p.Intelligence}  WIS {p.Wisdom}  CHA {p.Charisma}");
        EditorIO.Info($"  DEF {p.Defence}  AGI {p.Agility}  STA {p.Stamina}   WeapPow {p.WeapPow}  ArmPow {p.ArmPow}");
        EditorIO.Info($"  Chivalry {p.Chivalry}  Darkness {p.Darkness}");
        EditorIO.Info($"  Resurrections: {p.Resurrections}/{p.MaxResurrections} (used {p.ResurrectionsUsed})");
        EditorIO.Info($"  Potions: heal={p.Healing}  mana={p.ManaPotions}  antidote={p.Antidotes}");
        EditorIO.Info($"  Inventory: {p.Inventory?.Count ?? 0} items   Equipped slots: {p.EquippedItems?.Count ?? 0}");
        EditorIO.Info($"  Abilities: {p.LearnedAbilities?.Count ?? 0}   Quests: {p.ActiveQuests?.Count ?? 0}   Achievements: {p.Achievements?.Count(kv => kv.Value) ?? 0}");
        bool anyDisease = p.Blind || p.Plague || p.Smallpox || p.Measles || p.Leprosy || p.LoversBane;
        if (anyDisease) EditorIO.Warn($"  Has diseases: Blind={p.Blind} Plague={p.Plague} Smallpox={p.Smallpox} Measles={p.Measles} Leprosy={p.Leprosy} LoversBane={p.LoversBane}");
        if (p.Poison > 0) EditorIO.Warn($"  Poisoned ({p.PoisonTurns} turns remain)");
        if (p.DaysInPrison > 0) EditorIO.Warn($"  In prison ({p.DaysInPrison} days)");
        if (p.WantedLvl > 0) EditorIO.Warn($"  Wanted level: {p.WantedLvl}");
        EditorIO.Pause();
    }

    #endregion

    #region Appearance & Flavor

    private static void EditAppearance(PlayerData p)
    {
        EditorIO.Section("Appearance & Flavor");
        p.Height = EditorIO.PromptInt("Height (inches / cosmetic)", p.Height, min: 0, max: 400);
        p.Weight = EditorIO.PromptInt("Weight", p.Weight, min: 0, max: 1000);
        p.Eyes = EditorIO.PromptInt("Eyes (index into eye-color table)", p.Eyes, min: 0);
        p.Hair = EditorIO.PromptInt("Hair (index)", p.Hair, min: 0);
        p.Skin = EditorIO.PromptInt("Skin (index)", p.Skin, min: 0);

        EditorIO.Info("— Combat phrases (6 lines; shown in some victory/taunt events) —");
        p.Phrases ??= new List<string>();
        while (p.Phrases.Count < 6) p.Phrases.Add("");
        for (int i = 0; i < 6; i++)
            p.Phrases[i] = EditorIO.PromptString($"Phrase {i + 1}", p.Phrases[i]);

        EditorIO.Info("— Character description (4 lines; shown on character sheets) —");
        p.Description ??= new List<string>();
        while (p.Description.Count < 4) p.Description.Add("");
        for (int i = 0; i < 4; i++)
            p.Description[i] = EditorIO.PromptString($"Desc line {i + 1}", p.Description[i]);

        p.BattleCry = EditorIO.PromptString("Battle cry (short slogan)", p.BattleCry);
    }

    #endregion

    #region Skills & Training

    private static void EditSkillsAndTraining(PlayerData p)
    {
        while (true)
        {
            p.SkillProficiencies ??= new Dictionary<string, int>();
            p.StatTrainingCounts ??= new Dictionary<string, int>();
            p.CraftingMaterials ??= new Dictionary<string, int>();
            int choice = EditorIO.Menu("Skills & Training", new[]
            {
                $"Unspent training sessions: {p.Trains}",
                $"Training points: {p.TrainingPoints}",
                $"Skill proficiencies ({p.SkillProficiencies.Count})",
                $"Gold-based stat training counts ({p.StatTrainingCounts.Count})",
                $"Crafting materials ({p.CraftingMaterials.Count})",
                "Set a skill proficiency level",
                "Clear all skill proficiencies",
                "Set stat training count (resets the 'too expensive' progression)",
                "Add crafting material by name",
            });
            switch (choice)
            {
                case 0: return;
                case 1: p.Trains = EditorIO.PromptInt("Training sessions", p.Trains, min: 0); break;
                case 2: p.TrainingPoints = EditorIO.PromptInt("Training points", p.TrainingPoints, min: 0); break;
                case 3:
                    foreach (var kv in p.SkillProficiencies.OrderBy(k => k.Key))
                        EditorIO.Info($"  {kv.Key,-20} level {kv.Value}");
                    EditorIO.Pause();
                    break;
                case 4:
                    foreach (var kv in p.StatTrainingCounts.OrderBy(k => k.Key))
                        EditorIO.Info($"  {kv.Key,-20} trained {kv.Value} times");
                    EditorIO.Pause();
                    break;
                case 5:
                    foreach (var kv in p.CraftingMaterials.OrderBy(k => k.Key))
                        EditorIO.Info($"  {kv.Key,-25} x{kv.Value}");
                    EditorIO.Pause();
                    break;
                case 6:
                    {
                        string name = EditorIO.PromptChoice("Skill name", EditorVocab.CombatSkillNames, "");
                        if (!string.IsNullOrWhiteSpace(name))
                        {
                            int cur = p.SkillProficiencies.TryGetValue(name, out var v) ? v : 0;
                            p.SkillProficiencies[name] = EditorIO.PromptInt("Level (0-10 typical)", cur, min: 0);
                            EditorIO.Success("Set.");
                            EditorIO.Pause();
                        }
                        break;
                    }
                case 7:
                    if (EditorIO.Confirm("Forget all skill proficiencies?"))
                    { p.SkillProficiencies.Clear(); EditorIO.Success("Cleared."); EditorIO.Pause(); }
                    break;
                case 8:
                    {
                        string stat = EditorIO.PromptChoice("Stat", EditorVocab.CoreStatNames, "", allowCustom: false);
                        if (!string.IsNullOrWhiteSpace(stat))
                        {
                            int cur = p.StatTrainingCounts.TryGetValue(stat, out var v) ? v : 0;
                            p.StatTrainingCounts[stat] = EditorIO.PromptInt("Training count", cur, min: 0);
                            EditorIO.Success("Set.");
                            EditorIO.Pause();
                        }
                        break;
                    }
                case 9:
                    {
                        string mat = EditorIO.Prompt("Material name");
                        if (!string.IsNullOrWhiteSpace(mat))
                        {
                            int cur = p.CraftingMaterials.TryGetValue(mat, out var v) ? v : 0;
                            p.CraftingMaterials[mat] = EditorIO.PromptInt("Quantity", cur, min: 0);
                            EditorIO.Success("Set.");
                            EditorIO.Pause();
                        }
                        break;
                    }
            }
        }
    }

    #endregion

    #region Team / Guild / Factions

    private static void EditTeamAndGuild(PlayerData p)
    {
        EditorIO.Section("Team / Guild");
        p.Team = EditorIO.PromptString("Team name (blank = no team)", p.Team);
        p.TeamPassword = EditorIO.PromptString("Team password", p.TeamPassword);
        p.IsTeamLeader = EditorIO.PromptBool("Is team leader", p.IsTeamLeader);
        p.TeamRec = EditorIO.PromptInt("Team record (days held turf)", p.TeamRec, min: 0);
        p.BGuard = EditorIO.PromptInt("Door guard type", p.BGuard, min: 0);
        p.BGuardNr = EditorIO.PromptInt("Number of door guards", p.BGuardNr, min: 0);

        EditorIO.Info("— Unpaid NPC team wages —");
        p.UnpaidWageDays ??= new Dictionary<string, int>();
        if (p.UnpaidWageDays.Count == 0)
            EditorIO.Info("  (none)");
        else
            foreach (var kv in p.UnpaidWageDays)
                EditorIO.Info($"  {kv.Key,-20} {kv.Value} days unpaid");
        if (p.UnpaidWageDays.Count > 0 && EditorIO.Confirm("Clear all unpaid wages?"))
        {
            p.UnpaidWageDays.Clear();
            EditorIO.Success("Cleared.");
        }
    }

    #endregion

    #region Settings & Preferences

    private static void EditSettings(PlayerData p)
    {
        EditorIO.Section("Settings & Preferences");
        p.AutoHeal = EditorIO.PromptBool("AutoHeal in battle", p.AutoHeal);
        p.CombatSpeed = EditorIO.PromptEnum("CombatSpeed", p.CombatSpeed);
        p.SkipIntimateScenes = EditorIO.PromptBool("Skip intimate scenes (fade to black)", p.SkipIntimateScenes);
        p.ScreenReaderMode = EditorIO.PromptBool("Screen reader mode", p.ScreenReaderMode);
        p.CompactMode = EditorIO.PromptBool("Compact mode (mobile/small-screen menus)", p.CompactMode);
        p.Language = EditorIO.PromptString("Language code (en, es, fr, it, hu)", p.Language);
        p.ColorTheme = EditorIO.PromptEnum("ColorTheme", p.ColorTheme);
        p.AutoLevelUp = EditorIO.PromptBool("AutoLevelUp on XP threshold", p.AutoLevelUp);
        p.AutoEquipDisabled = EditorIO.PromptBool("AutoEquipDisabled (shop purchases go to inventory)", p.AutoEquipDisabled);
        p.DateFormatPreference = EditorIO.PromptInt("DateFormat (0=MM/DD, 1=DD/MM, 2=YYYY-MM-DD)", p.DateFormatPreference, min: 0, max: 2);
        p.AutoRedistributeXP = EditorIO.PromptBool("Auto-redistribute XP when teammates die", p.AutoRedistributeXP);
    }

    #endregion

    #region World State

    private static void EditWorldState(SaveGameData data)
    {
        data.WorldState ??= new WorldStateData();
        var w = data.WorldState;
        EditorIO.Section("World State (single-player world)");
        w.CurrentRuler = EditorIO.PromptString("Current ruler name (blank = no king)", w.CurrentRuler ?? "");
        if (string.IsNullOrWhiteSpace(w.CurrentRuler)) w.CurrentRuler = null;
        w.BankInterestRate = EditorIO.PromptInt("BankInterestRate (percent)", w.BankInterestRate, min: 0, max: 100);
        w.TownPotValue = EditorIO.PromptInt("TownPot value (gold)", w.TownPotValue, min: 0);

        EditorIO.Info("— Day / calendar —");
        data.CurrentDay = EditorIO.PromptInt("CurrentDay", data.CurrentDay, min: 1);
        data.Player.TurnCount = EditorIO.PromptInt("TurnCount (world sim counter)", data.Player.TurnCount, min: 0);
        data.Player.GameTimeMinutes = EditorIO.PromptInt("GameTimeMinutes (0-1439)", data.Player.GameTimeMinutes, min: 0, max: 1439);

        EditorIO.Info("— Clean-up options —");
        if (w.ActiveEvents?.Count > 0 && EditorIO.Confirm($"Clear {w.ActiveEvents.Count} active world events?"))
        {
            w.ActiveEvents.Clear();
            EditorIO.Success("Cleared.");
        }
        if (w.RecentNews?.Count > 0 && EditorIO.Confirm($"Clear {w.RecentNews.Count} news entries?"))
        {
            w.RecentNews.Clear();
            EditorIO.Success("Cleared.");
        }
    }

    #endregion
}
