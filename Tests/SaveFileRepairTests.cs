using Xunit;
using FluentAssertions;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using UsurperRemake.Systems;

namespace UsurperReborn.Tests;

/// <summary>
/// v0.57.19 — repair pass tests. Synthetic JSON exercising each cap path so we
/// know the repair code actually clips the right arrays/dicts and writes valid
/// output. These don't need a full SaveGameData object graph; they test the
/// raw JSON-to-JSON transformation.
/// </summary>
public class SaveFileRepairTests : IDisposable
{
    private readonly string _tempDir;
    private readonly JsonSerializerOptions _writeOpts = new() { WriteIndented = true };

    public SaveFileRepairTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "usurper_repair_tests_" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(_tempDir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    private string WriteSaveFile(string content)
    {
        string path = Path.Combine(_tempDir, "test.json");
        File.WriteAllText(path, content);
        return path;
    }

    [Fact]
    public void Repair_NonExistentFile_ReturnsFailure()
    {
        var result = SaveFileRepair.RepairInPlace(Path.Combine(_tempDir, "missing.json"), _writeOpts);
        result.Success.Should().BeFalse();
        result.ErrorMessage.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public void Repair_EmptyJsonObject_PreservesStructure()
    {
        var path = WriteSaveFile("{}");
        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        result.TrimmedFields.Should().BeEmpty();
        File.ReadAllText(path).Trim().Should().Be("{}");
    }

    [Fact]
    public void Repair_NpcMemoriesArrayOverCap_TrimmedToCap()
    {
        // 100 fake memory entries — cap is 30 (matches MAX_MEMORIES from v0.57.16).
        var memories = new List<object>();
        for (int i = 0; i < 100; i++)
            memories.Add(new { type = "Combat", description = $"mem{i}", importance = i });

        var save = new
        {
            npcs = new[]
            {
                new { name = "TestNPC", memories = memories.ToArray() }
            }
        };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        result.TrimmedFields.Should().Contain(s => s.Contains("memories"));

        // Verify the trimmed file has exactly 30 entries and they're the LAST 30 (mem70..mem99).
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        var trimmed = doc.RootElement.GetProperty("npcs")[0].GetProperty("memories");
        trimmed.GetArrayLength().Should().Be(30);
        trimmed[0].GetProperty("description").GetString().Should().Be("mem70");
        trimmed[29].GetProperty("description").GetString().Should().Be("mem99");
    }

    [Fact]
    public void Repair_RoyalCourtPrisoners_TrimmedToCap()
    {
        var prisoners = new List<object>();
        for (int i = 0; i < 200; i++)
            prisoners.Add(new { characterName = $"prisoner{i}", crime = "test", sentence = 5, daysServed = 0 });

        var save = new { royalCourt = new { prisoners = prisoners.ToArray() } };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        doc.RootElement.GetProperty("royalCourt").GetProperty("prisoners")
            .GetArrayLength().Should().Be(GameConfig.MaxSerializedRoyalCourtPrisoners);
    }

    [Fact]
    public void Repair_RomanceEncounterHistory_TrimmedToCap()
    {
        var encounters = new List<object>();
        for (int i = 0; i < 500; i++)
            encounters.Add(new { date = "2025-01-01", location = "test", type = 0, mood = 0 });

        var save = new { player = new { romanceData = new { encounterHistory = encounters.ToArray() } } };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        doc.RootElement.GetProperty("player").GetProperty("romanceData").GetProperty("encounterHistory")
            .GetArrayLength().Should().Be(GameConfig.MaxSerializedEncounterHistory);
    }

    [Fact]
    public void Repair_StrangerEncountersUsedDialogueIds_TrimmedToCap()
    {
        var ids = new List<string>();
        for (int i = 0; i < 200; i++) ids.Add($"dlg_{i}");

        var save = new { strangerEncounters = new { usedDialogueIds = ids.ToArray() } };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        doc.RootElement.GetProperty("strangerEncounters").GetProperty("usedDialogueIds")
            .GetArrayLength().Should().Be(GameConfig.MaxSerializedStrangerDialogueIds);
    }

    [Fact]
    public void Repair_NpcRelationshipsDictionary_TrimmedToCap()
    {
        // Relationships is Dictionary<string, float> — serialized as a JSON object
        // with arbitrary keys. Repair should trim object property count.
        var relationships = new Dictionary<string, float>();
        for (int i = 0; i < 300; i++) relationships["npc_" + i] = i * 0.1f;

        var save = new
        {
            npcs = new[]
            {
                new { name = "TestNPC", relationships = relationships }
            }
        };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        result.TrimmedFields.Should().Contain(s => s.Contains("relationships"));

        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        var trimmedRelations = doc.RootElement.GetProperty("npcs")[0].GetProperty("relationships");
        int count = 0;
        foreach (var _ in trimmedRelations.EnumerateObject()) count++;
        count.Should().Be(GameConfig.MaxSerializedRelationshipsPerNpc);
    }

    [Fact]
    public void Repair_AffairsTopLevelArray_TrimmedToCap()
    {
        var affairs = new List<object>();
        for (int i = 0; i < 200; i++)
            affairs.Add(new { marriedNpcId = $"npc{i}", seducerId = "player", affairProgress = i, isActive = false });

        var save = new { affairs = affairs.ToArray() };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        doc.RootElement.GetProperty("affairs").GetArrayLength()
            .Should().Be(GameConfig.MaxSerializedAffairs);
    }

    [Fact]
    public void Repair_NestedTopicsDiscussedPerConversation_TrimmedPerEntry()
    {
        // conversationStates[*].topicsDiscussed cap = 30. Test a conversation with
        // 100 topics gets trimmed correctly even when the parent array is small.
        var topics = new List<string>();
        for (int i = 0; i < 100; i++) topics.Add($"topic_{i}");

        var save = new
        {
            player = new
            {
                romanceData = new
                {
                    conversationStates = new[]
                    {
                        new { npcId = "alice", topicsDiscussed = topics.ToArray() }
                    }
                }
            }
        };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        doc.RootElement.GetProperty("player").GetProperty("romanceData")
            .GetProperty("conversationStates")[0].GetProperty("topicsDiscussed")
            .GetArrayLength().Should().Be(GameConfig.MaxSerializedTopicsDiscussedPerConvo);
    }

    [Fact]
    public void Repair_NonBloatedFile_NoChangesMade()
    {
        // Small save with all arrays under cap — should round-trip identically
        // (modulo whitespace/property-order, which Utf8JsonWriter preserves).
        var save = new
        {
            player = new { name = "TestPlayer", level = 50, gold = 1000L },
            npcs = new[]
            {
                new
                {
                    name = "Alice",
                    memories = new[] { new { type = "Combat", description = "won", importance = 5 } },
                    enemies = new[] { "Bob" }
                }
            }
        };
        var originalContent = JsonSerializer.Serialize(save, _writeOpts);
        var path = WriteSaveFile(originalContent);

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        result.TrimmedFields.Should().BeEmpty();

        // Verify content semantically equivalent (parse both back).
        using var origDoc = JsonDocument.Parse(originalContent);
        using var newDoc = JsonDocument.Parse(File.ReadAllBytes(path));
        newDoc.RootElement.GetProperty("player").GetProperty("name").GetString()
            .Should().Be("TestPlayer");
        newDoc.RootElement.GetProperty("npcs")[0].GetProperty("memories").GetArrayLength()
            .Should().Be(1);
    }

    [Fact]
    public void Repair_PrimitiveFieldsPreserved()
    {
        // Ensure non-collection fields (strings, numbers, booleans, nulls) survive.
        var save = new
        {
            player = new
            {
                name = "Lin",
                level = 99,
                gold = 1234567890L,
                isImmortal = true,
                lastLoginDate = (string?)null
            }
        };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        var p = doc.RootElement.GetProperty("player");
        p.GetProperty("name").GetString().Should().Be("Lin");
        p.GetProperty("level").GetInt32().Should().Be(99);
        p.GetProperty("gold").GetInt64().Should().Be(1234567890L);
        p.GetProperty("isImmortal").GetBoolean().Should().BeTrue();
        p.GetProperty("lastLoginDate").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public void Repair_OutputIsValidJson()
    {
        // Whatever the repair writes, the result must be parseable. This catches
        // any malformed Utf8JsonWriter sequences (mismatched start/end, etc.).
        var memories = new List<object>();
        for (int i = 0; i < 100; i++)
            memories.Add(new { type = "X", description = $"m{i}", importance = i });

        var save = new
        {
            npcs = new object[]
            {
                new { name = "A", memories = memories.ToArray() },
                new { name = "B", memories = memories.ToArray() },
                new { name = "C" }
            },
            royalCourt = new
            {
                prisoners = Enumerable.Range(0, 100).Select(i => new { characterName = $"p{i}" }).ToArray()
            }
        };
        var path = WriteSaveFile(JsonSerializer.Serialize(save, _writeOpts));

        var result = SaveFileRepair.RepairInPlace(path, _writeOpts);

        result.Success.Should().BeTrue();

        // Should parse without throwing.
        Action parseAction = () =>
        {
            using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        };
        parseAction.Should().NotThrow();
    }
}
