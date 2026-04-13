# v0.55.0 - The Specialist

## NPC Class Specialization System

This update adds a dual specialization system for NPC teammates, letting players assign combat roles like Healer, Tank, DPS, Utility, or Debuff to their team members. Each of the 12 base classes gets 2 specializations (24 total), changing how the NPC behaves in combat and what stats they gain on future level-ups.

**Specializations:**

| Class | Spec 1 (Offensive) | Spec 2 (Defensive/Support) |
|-------|-------------------|---------------------------|
| Warrior | Arms (DPS) | Protection (Tank) |
| Paladin | Retribution (DPS) | Holy (Healer) |
| Ranger | Marksmanship (DPS) | Survival (Utility) |
| Assassin | Subtlety (DPS) | Toxicology (Debuff) |
| Barbarian | Berserker (DPS) | Juggernaut (Tank) |
| Cleric | Smite (DPS) | Restoration (Healer) |
| Magician | Destruction (DPS) | Arcane (Utility) |
| Sage | Elementalist (DPS) | Mystic (Healer) |
| Bard | Virtuoso (DPS) | Minstrel (Healer) |
| Alchemist | Demolition (DPS) | Apothecary (Healer) |
| Jester | Chaos (DPS) | Trickster (Debuff) |
| Mystic Shaman | Elemental (DPS) | Spiritwalker (Healer) |

**How it works:**

- **NPC teammates only** -- does not affect the player character or companions (Aldric, Vex, Lyris, Mira, Melodia)
- **Free to swap anytime** from Team Corner via `[X] Specialize`
- **Additive stat growth** -- specs add bonus stats on future level-ups (not retroactive). A Holy Paladin gains +2 WIS, +1 CON, +4 Mana, +3 HP per level on top of base Paladin growth
- **No new abilities** -- specs filter and prioritize existing class abilities. A Minstrel Bard uses the same Bard abilities but prioritizes heals/buffs (75% chance) over attacks
- **Combat AI changes:**
  - Healer specs (Holy, Restoration, Mystic, Minstrel, Apothecary, Spiritwalker) heal allies aggressively at 75-80% HP instead of the default 50-70%
  - DPS Cleric (Smite) becomes emergency-only healer at 30% HP
  - Tank specs (Protection, Juggernaut) prioritize taunts and defensive abilities
  - Ability use chance varies by spec (55-70% instead of flat 50%)
  - Restricted ability types: e.g., Restoration Cleric deprioritizes attack abilities, Minstrel Bard deprioritizes attacks
- **`None` is valid** -- unspecialized NPCs work exactly as before. All combat code falls through to existing behavior when spec is None
- **Spec badges** -- team member listings show `[Arms]`, `[Holy]`, etc. next to class name
- **Examine member** -- detail screen shows current specialization and role
- **Data-driven** -- all 24 specs defined in a single `SpecializationData.cs` file with no per-spec switch statements in combat code
- **Save compatible** -- missing field defaults to `None` (0), so existing saves load without issues
- **Persists in online mode** -- spec survives save/load and world state synchronization

**New healers available:** Holy Paladin, Mystic Sage, Minstrel Bard, Apothecary Alchemist, Spiritwalker Shaman -- all heal allies at 75-80% HP, dramatically improving party healing options beyond Cleric.

**New tanks available:** Protection Warrior and Juggernaut Barbarian both prioritize taunt abilities and gain massive HP/DEF bonuses per level.

---

### Files Changed

- `Scripts/Core/GameConfig.cs` -- Version 0.55.0 "The Specialist"
- `Scripts/Core/Character.cs` -- `ClassSpecialization` enum (24 values + `None = 0`)
- `Scripts/Core/NPC.cs` -- `Specialization` property (`ClassSpecialization.None` default)
- `Scripts/Data/SpecializationData.cs` -- **NEW** -- `SpecDefinition` class and `SpecializationData` static data with all 24 spec definitions; `SpecRole` enum (DPS/Tank/Healer/Utility/Debuff); helper methods `GetSpec()`, `GetSpecsForClass()`, `IsValidSpecForClass()`, `IsHealerSpec()`, `IsTankSpec()`
- `Scripts/Systems/SaveDataStructures.cs` -- `NPCData.Specialization` field
- `Scripts/Systems/SaveSystem.cs` -- Specialization serialization in `SerializeNPCs()`
- `Scripts/Core/GameEngine.cs` -- Specialization restore in `RestoreNPCs()`
- `Scripts/Systems/WorldSimService.cs` -- Specialization restore in `RestoreNPCsFromData()`
- `Scripts/Systems/OnlineStateManager.cs` -- Specialization in shared NPC state serialization
- `Scripts/Locations/LevelMasterLocation.cs` -- Spec stat growth bonuses applied in `ApplyClassStatIncreases()` after base class switch (additive, NPC teammates only)
- `Scripts/Systems/CombatEngine.cs` -- Spec-aware healing in `TryTeammateHealAction()` (override `isHealerClass` and `healThreshold` from spec); spec-based ability filtering in `TryTeammateClassAbility()` (restricted types, disabled IDs, 75% preferred type weighting); spec-based tank detection (Protection/Juggernaut) for taunt priority; spec-based ability use chance override; `IsHealerClass()` updated to check spec role
- `Scripts/Locations/TeamCornerLocation.cs` -- `[X] Specialize` menu option (visual + SR menus); `SpecializeMember()` method with numbered NPC selection and current spec display; `ShowSpecOptions()` with stat growth comparison, role description, heal threshold info; spec badges in `ShowTeamMembers()` detailed and simple views; spec display in `ExamineMember()` detail screen; `SaveAllSharedState()` after spec changes in online mode
- `Localization/en.json` -- ~45 new keys (spec UI prompts, 24 spec descriptions)
- `Localization/es.json` -- Spanish translations for all spec keys
- `Localization/fr.json` -- French translations for all spec keys
- `Localization/hu.json` -- Hungarian translations for all spec keys
- `Localization/it.json` -- Italian translations for all spec keys
