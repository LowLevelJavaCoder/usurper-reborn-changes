using Xunit;
using FluentAssertions;

namespace UsurperReborn.Tests;

/// <summary>
/// Smoke tests for CombatEngine and related combat data structures.
///
/// NOTE: Full combat flow tests (PlayerVsMonster, PlayerVsMonsters) require
/// a TerminalEmulator with mocked I/O for player input. These smoke tests
/// cover the testable surface: construction, data structures, helper methods,
/// and boss phase logic.
/// </summary>
public class CombatEngineTests
{
    #region Construction Tests

    [Fact]
    public void CombatEngine_CanBeConstructed_WithoutTerminal()
    {
        var engine = new CombatEngine();

        engine.Should().NotBeNull();
    }

    [Fact]
    public void CombatEngine_CanBeConstructed_WithNullTerminal()
    {
        var engine = new CombatEngine(term: null);

        engine.Should().NotBeNull();
    }

    [Fact]
    public void CombatEngine_BossContext_IsNullByDefault()
    {
        var engine = new CombatEngine();

        engine.BossContext.Should().BeNull();
    }

    [Fact]
    public void CombatEngine_BossContext_CanBeSet()
    {
        var engine = new CombatEngine();
        var ctx = new BossCombatContext();

        engine.BossContext = ctx;

        engine.BossContext.Should().BeSameAs(ctx);
    }

    #endregion

    #region CombatResult Tests

    [Fact]
    public void CombatResult_DefaultValues_AreReasonable()
    {
        var result = new CombatResult();

        result.Outcome.Should().Be(CombatOutcome.Victory, "default enum value is 0 = Victory");
        result.ExperienceGained.Should().Be(0);
        result.GoldGained.Should().Be(0);
        result.TotalDamageDealt.Should().Be(0);
        result.TotalDamageTaken.Should().Be(0);
        result.Monsters.Should().NotBeNull();
        result.Monsters.Should().BeEmpty();
        result.DefeatedMonsters.Should().NotBeNull();
        result.DefeatedMonsters.Should().BeEmpty();
        result.CombatLog.Should().NotBeNull();
        result.ItemsFound.Should().NotBeNull();
        result.Teammates.Should().NotBeNull();
    }

    [Fact]
    public void CombatResult_CanSetOutcome_PlayerDied()
    {
        var result = new CombatResult
        {
            Outcome = CombatOutcome.PlayerDied
        };

        result.Outcome.Should().Be(CombatOutcome.PlayerDied);
    }

    [Fact]
    public void CombatResult_CanSetOutcome_PlayerEscaped()
    {
        var result = new CombatResult
        {
            Outcome = CombatOutcome.PlayerEscaped
        };

        result.Outcome.Should().Be(CombatOutcome.PlayerEscaped);
    }

    [Fact]
    public void CombatResult_CanTrackXPAndGold()
    {
        var result = new CombatResult
        {
            ExperienceGained = 5000,
            GoldGained = 1200
        };

        result.ExperienceGained.Should().Be(5000);
        result.GoldGained.Should().Be(1200);
    }

    [Fact]
    public void CombatResult_CanTrackDamage()
    {
        var result = new CombatResult
        {
            TotalDamageDealt = 15000,
            TotalDamageTaken = 3000
        };

        result.TotalDamageDealt.Should().Be(15000);
        result.TotalDamageTaken.Should().Be(3000);
    }

    [Fact]
    public void CombatResult_MonsterProperty_ReturnsFirstMonster()
    {
        var monster1 = CreateTestMonster("Goblin", 50);
        var monster2 = CreateTestMonster("Orc", 100);

        var result = new CombatResult();
        result.Monsters.Add(monster1);
        result.Monsters.Add(monster2);

        result.Monster.Should().BeSameAs(monster1,
            "Monster property should return the first monster in the list");
    }

    [Fact]
    public void CombatResult_MonsterProperty_ReturnsNull_WhenEmpty()
    {
        var result = new CombatResult();

        result.Monster.Should().BeNull();
    }

    [Fact]
    public void CombatResult_MonsterSetter_AddsToList()
    {
        var monster = CreateTestMonster("Dragon", 500);
        var result = new CombatResult();

        result.Monster = monster;

        result.Monsters.Should().Contain(monster);
    }

    [Fact]
    public void CombatResult_CanTrackDefeatedMonsters()
    {
        var monster = CreateTestMonster("Slime", 10);
        monster.HP = 0;

        var result = new CombatResult();
        result.DefeatedMonsters.Add(monster);

        result.DefeatedMonsters.Should().HaveCount(1);
        result.DefeatedMonsters[0].IsAlive.Should().BeFalse();
    }

    #endregion

    #region BossCombatContext Phase Tests

    [Fact]
    public void CheckPhase_FullHP_ReturnsPhase1()
    {
        var ctx = new BossCombatContext();

        var phase = ctx.CheckPhase(1000, 1000);

        phase.Should().Be(1);
    }

    [Fact]
    public void CheckPhase_AboveHalfHP_ReturnsPhase1()
    {
        var ctx = new BossCombatContext();

        var phase = ctx.CheckPhase(600, 1000);

        phase.Should().Be(1);
    }

    [Fact]
    public void CheckPhase_AtHalfHP_ReturnsPhase2()
    {
        var ctx = new BossCombatContext();

        var phase = ctx.CheckPhase(500, 1000);

        phase.Should().Be(2);
    }

    [Fact]
    public void CheckPhase_BelowHalfHP_ReturnsPhase2()
    {
        var ctx = new BossCombatContext();

        var phase = ctx.CheckPhase(400, 1000);

        phase.Should().Be(2);
    }

    [Fact]
    public void CheckPhase_At20PercentHP_ReturnsPhase3()
    {
        var ctx = new BossCombatContext();

        var phase = ctx.CheckPhase(200, 1000);

        phase.Should().Be(3);
    }

    [Fact]
    public void CheckPhase_Below20PercentHP_ReturnsPhase3()
    {
        var ctx = new BossCombatContext();

        var phase = ctx.CheckPhase(100, 1000);

        phase.Should().Be(3);
    }

    [Fact]
    public void CheckPhase_AtZeroHP_ReturnsPhase3()
    {
        var ctx = new BossCombatContext();

        var phase = ctx.CheckPhase(0, 1000);

        phase.Should().Be(3);
    }

    [Fact]
    public void CheckPhase_ZeroMaxHP_DoesNotCrash()
    {
        var ctx = new BossCombatContext();

        // Should not throw - Math.Max(1, maxHP) prevents division by zero
        var phase = ctx.CheckPhase(0, 0);

        phase.Should().Be(3, "0/1 = 0.0 which is below both thresholds");
    }

    [Fact]
    public void CheckPhase_CustomThresholds_FromBossData()
    {
        // Some bosses like Manwe have custom phase thresholds
        var bossData = new UsurperRemake.Data.OldGodBossData
        {
            Phase2Threshold = 0.60f,  // Phase 2 at 60% HP instead of 50%
            Phase3Threshold = 0.10f   // Phase 3 at 10% HP instead of 20%
        };

        var ctx = new BossCombatContext
        {
            BossData = bossData
        };

        // At 55% HP: below custom 60% threshold, should be Phase 2
        ctx.CheckPhase(550, 1000).Should().Be(2);

        // At 15% HP: above custom 10% threshold, should still be Phase 2
        ctx.CheckPhase(150, 1000).Should().Be(2);

        // At 8% HP: below custom 10% threshold, should be Phase 3
        ctx.CheckPhase(80, 1000).Should().Be(3);
    }

    #endregion

    #region BossCombatContext Defaults

    [Fact]
    public void BossCombatContext_DefaultValues()
    {
        var ctx = new BossCombatContext();

        ctx.CurrentPhase.Should().Be(1);
        ctx.AttacksPerRound.Should().Be(2);
        ctx.CanSave.Should().BeFalse();
        ctx.BossSaved.Should().BeFalse();
        ctx.DamageMultiplier.Should().Be(1.0);
        ctx.DefenseMultiplier.Should().Be(1.0);
        ctx.CriticalChance.Should().Be(0.05);
        ctx.HasRageBoost.Should().BeFalse();
        ctx.HasInsight.Should().BeFalse();
        ctx.BossDamageMultiplier.Should().Be(1.0);
        ctx.BossDefenseMultiplier.Should().Be(1.0);
        ctx.TankAbsorptionRate.Should().Be(0.6);
        ctx.DivineArmorReduction.Should().Be(0);
    }

    #endregion

    #region CombatOutcome Enum Coverage

    [Theory]
    [InlineData(CombatOutcome.Victory)]
    [InlineData(CombatOutcome.PlayerDied)]
    [InlineData(CombatOutcome.PlayerEscaped)]
    [InlineData(CombatOutcome.Stalemate)]
    [InlineData(CombatOutcome.Interrupted)]
    public void CombatOutcome_AllValues_CanBeAssigned(CombatOutcome outcome)
    {
        var result = new CombatResult { Outcome = outcome };

        result.Outcome.Should().Be(outcome);
    }

    #endregion

    #region Monster Combat State Tests

    [Fact]
    public void Monster_IsAlive_WhenHPPositive()
    {
        var monster = CreateTestMonster("Goblin", 50);

        monster.IsAlive.Should().BeTrue();
    }

    [Fact]
    public void Monster_IsDead_WhenHPZero()
    {
        var monster = CreateTestMonster("Goblin", 50);
        monster.HP = 0;

        monster.IsAlive.Should().BeFalse();
    }

    [Fact]
    public void Monster_IsDead_WhenHPNegative()
    {
        var monster = CreateTestMonster("Goblin", 50);
        monster.HP = -10;

        monster.IsAlive.Should().BeFalse();
    }

    [Fact]
    public void Monster_CombatState_Defaults()
    {
        var monster = new Monster();

        monster.Stunned.Should().BeFalse();
        monster.Poisoned.Should().BeFalse();
        monster.IsBurning.Should().BeFalse();
        monster.Distracted.Should().BeFalse();
        monster.Charmed.Should().BeFalse();
        monster.InCombat.Should().BeFalse();
        monster.IsBoss.Should().BeFalse();
        monster.IsMiniBoss.Should().BeFalse();
    }

    [Fact]
    public void Monster_TauntState_DefaultsToNull()
    {
        var monster = new Monster();

        monster.TauntedBy.Should().BeNull();
        monster.TauntRoundsLeft.Should().Be(0);
    }

    [Fact]
    public void Monster_TauntState_CanBeSet()
    {
        var monster = CreateTestMonster("Dragon", 500);

        monster.TauntedBy = "WarriorPlayer";
        monster.TauntRoundsLeft = 3;

        monster.TauntedBy.Should().Be("WarriorPlayer");
        monster.TauntRoundsLeft.Should().Be(3);
    }

    #endregion

    #region MonsterGenerator Integration

    [Fact]
    public void MonsterGenerator_CreatesViableMonster_ForCombat()
    {
        var monster = MonsterGenerator.GenerateMonster(5);

        monster.Should().NotBeNull();
        monster.HP.Should().BeGreaterThan(0, "monster needs HP to participate in combat");
        monster.Strength.Should().BeGreaterThan(0, "monster needs strength for attacks");
        monster.Name.Should().NotBeNullOrEmpty("monster needs a name for combat messages");
    }

    [Fact]
    public void MonsterGenerator_BossMonster_HasHigherStats()
    {
        var normalMonster = MonsterGenerator.GenerateMonster(25);
        var bossMonster = MonsterGenerator.GenerateMonster(25, isBoss: true);

        bossMonster.IsBoss.Should().BeTrue();
        bossMonster.HP.Should().BeGreaterThan(normalMonster.HP,
            "boss monsters should have more HP than normal monsters at the same level");
    }

    [Fact]
    public void MonsterGenerator_MiniBoss_HasHigherStats()
    {
        var normalMonster = MonsterGenerator.GenerateMonster(25);
        var miniBossMonster = MonsterGenerator.GenerateMonster(25, isMiniBoss: true);

        miniBossMonster.IsMiniBoss.Should().BeTrue();
        miniBossMonster.HP.Should().BeGreaterThan(normalMonster.HP,
            "mini-boss monsters should have more HP than normal monsters");
    }

    #endregion

    #region Player Combat Properties

    [Fact]
    public void Player_CombatStatusEffects_DefaultToInactive()
    {
        var player = CreateTestPlayer(10);

        player.IsRaging.Should().BeFalse();
        player.TempAttackBonus.Should().Be(0);
        player.TempDefenseBonus.Should().Be(0);
        player.MagicACBonus.Should().Be(0);
        player.DodgeNextAttack.Should().BeFalse();
        player.HasBloodlust.Should().BeFalse();
    }

    [Fact]
    public void Player_CombatBuffs_CanBeModified()
    {
        var player = CreateTestPlayer(10);

        player.TempAttackBonus = 50;
        player.TempAttackBonusDuration = 3;
        player.TempDefenseBonus = 30;
        player.TempDefenseBonusDuration = 3;
        player.MagicACBonus = 25;

        player.TempAttackBonus.Should().Be(50);
        player.TempAttackBonusDuration.Should().Be(3);
        player.TempDefenseBonus.Should().Be(30);
        player.TempDefenseBonusDuration.Should().Be(3);
        player.MagicACBonus.Should().Be(25);
    }

    [Fact]
    public void Player_GodSlayerBuff_TracksCorrectly()
    {
        var player = CreateTestPlayer(50);

        player.GodSlayerCombats = 20;
        player.GodSlayerDamageBonus = 0.20f;
        player.GodSlayerDefenseBonus = 0.10f;

        player.HasGodSlayerBuff.Should().BeTrue();

        player.GodSlayerCombats = 0;
        player.HasGodSlayerBuff.Should().BeFalse();
    }

    [Fact]
    public void Player_SongBuff_TracksCorrectly()
    {
        var player = CreateTestPlayer(10);

        player.SongBuffType = 1;
        player.SongBuffCombats = 5;
        player.SongBuffValue = 0.15f;

        player.HasActiveSongBuff.Should().BeTrue();

        player.SongBuffCombats = 0;
        player.HasActiveSongBuff.Should().BeFalse();
    }

    #endregion

    #region CombatAction Tests

    [Fact]
    public void CombatAction_DefaultType_IsNone()
    {
        var action = new CombatAction();

        action.Type.Should().Be(CombatActionType.None,
            "default enum value is 0 = None (stunned/incapacitated)");
    }

    [Theory]
    [InlineData(CombatActionType.Attack)]
    [InlineData(CombatActionType.Defend)]
    [InlineData(CombatActionType.Retreat)]
    [InlineData(CombatActionType.CastSpell)]
    [InlineData(CombatActionType.UseItem)]
    [InlineData(CombatActionType.UseAbility)]
    [InlineData(CombatActionType.PowerAttack)]
    [InlineData(CombatActionType.PreciseStrike)]
    [InlineData(CombatActionType.Disarm)]
    [InlineData(CombatActionType.Taunt)]
    [InlineData(CombatActionType.Hide)]
    [InlineData(CombatActionType.HealAlly)]
    [InlineData(CombatActionType.UseHerb)]
    public void CombatAction_AllTypes_CanBeAssigned(CombatActionType actionType)
    {
        var action = new CombatAction { Type = actionType };

        action.Type.Should().Be(actionType);
    }

    [Fact]
    public void CombatAction_CanSpecifyTarget()
    {
        var action = new CombatAction
        {
            Type = CombatActionType.CastSpell,
            SpellIndex = 5,
            TargetIndex = 2,
            TargetAllMonsters = false
        };

        action.SpellIndex.Should().Be(5);
        action.TargetIndex.Should().Be(2);
        action.TargetAllMonsters.Should().BeFalse();
    }

    [Fact]
    public void CombatAction_CanSpecifyAoE()
    {
        var action = new CombatAction
        {
            Type = CombatActionType.UseAbility,
            AbilityId = "thundering_roar",
            TargetAllMonsters = true
        };

        action.AbilityId.Should().Be("thundering_roar");
        action.TargetAllMonsters.Should().BeTrue();
    }

    [Fact]
    public void CombatAction_CanSpecifyAllyTarget()
    {
        var action = new CombatAction
        {
            Type = CombatActionType.HealAlly,
            AllyTargetIndex = 1
        };

        action.AllyTargetIndex.Should().Be(1);
    }

    #endregion

    #region Helper Methods

    private static Monster CreateTestMonster(string name, long hp)
    {
        return new Monster
        {
            Name = name,
            HP = hp,
            Strength = 20,
            Defence = 10,
            WeapPow = 15,
            ArmPow = 10,
            Level = 5
        };
    }

    private static Character CreateTestPlayer(int level)
    {
        return new Character
        {
            Name2 = "TestPlayer",
            Class = CharacterClass.Warrior,
            Race = CharacterRace.Human,
            Level = level,
            HP = 200 + level * 10,
            MaxHP = 200 + level * 10,
            Strength = 50 + level * 3,
            Defence = 30 + level * 2,
            Dexterity = 20 + level,
            Agility = 15 + level,
            Constitution = 20 + level,
            Gold = 1000,
            Mana = 0,
            MaxMana = 0,
            Stamina = 100
        };
    }

    #endregion
}
