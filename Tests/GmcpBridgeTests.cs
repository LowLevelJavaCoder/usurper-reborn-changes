using Xunit;
using FluentAssertions;
using System;
using System.Linq;
using System.Text;
using UsurperRemake.Server;

namespace UsurperReborn.Tests;

/// <summary>
/// v0.57.21 — GMCP framing tests. Verifies the wire-format produced by GmcpBridge.BuildFrame
/// matches the GMCP spec exactly: IAC SB GMCP &lt;package&gt; SP &lt;json&gt; IAC SE, with
/// proper 0xFF doubling inside the SB block. Mudlet/MUSHclient/TT++ parsers are strict
/// about this — a missing escape or extra byte breaks the whole subnegotiation.
/// </summary>
public class GmcpBridgeTests
{
    // Telnet protocol bytes (RFC 854 + GMCP spec).
    private const byte IAC = 0xFF;
    private const byte SB = 0xFA;
    private const byte SE = 0xF0;
    private const byte GMCP = 0xC9;

    [Fact]
    public void BuildFrame_NullPayload_OmitsBodyAndSpace()
    {
        // Char.LoginPing-style signal — package only, no JSON body.
        var frame = GmcpBridge.BuildFrame("Test.Ping", null);

        // Expected: IAC SB GMCP "Test.Ping" IAC SE  (no space, no body)
        frame[0].Should().Be(IAC);
        frame[1].Should().Be(SB);
        frame[2].Should().Be(GMCP);

        var pkgBytes = Encoding.UTF8.GetBytes("Test.Ping");
        for (int i = 0; i < pkgBytes.Length; i++)
            frame[3 + i].Should().Be(pkgBytes[i]);

        // Trailer: IAC SE
        frame[^2].Should().Be(IAC);
        frame[^1].Should().Be(SE);
    }

    [Fact]
    public void BuildFrame_SimplePayload_ProducesExpectedShape()
    {
        // Char.Vitals-style payload.
        var frame = GmcpBridge.BuildFrame("Char.Vitals", new { hp = 50, maxHp = 100 });

        // Header: IAC SB GMCP
        frame[0].Should().Be(IAC);
        frame[1].Should().Be(SB);
        frame[2].Should().Be(GMCP);

        // Trailer: IAC SE
        frame[^2].Should().Be(IAC);
        frame[^1].Should().Be(SE);

        // Verify a single space separates package from JSON.
        // Package "Char.Vitals" is 11 bytes (positions 3-13). Position 14 should be SP.
        var pkgBytes = Encoding.UTF8.GetBytes("Char.Vitals");
        for (int i = 0; i < pkgBytes.Length; i++)
            frame[3 + i].Should().Be(pkgBytes[i]);
        frame[3 + pkgBytes.Length].Should().Be((byte)0x20); // SP

        // JSON payload starts after the space.
        int jsonStart = 3 + pkgBytes.Length + 1;
        int jsonEnd = frame.Length - 2; // exclude IAC SE
        var jsonBytes = frame[jsonStart..jsonEnd];
        var json = Encoding.UTF8.GetString(jsonBytes);
        json.Should().Contain("\"hp\":50");
        json.Should().Contain("\"maxHp\":100");
    }

    [Fact]
    public void BuildFrame_PayloadWithFFByte_DoublesIacInsideSb()
    {
        // Construct a payload whose UTF-8 encoding contains 0xFF. UTF-8 never produces
        // a single 0xFF byte for any valid Unicode codepoint, so we exercise this via
        // the EscapeIacBytes helper directly — that's the only place 0xFF could land
        // in a real GMCP frame (e.g. malformed package name with 0xFF byte).
        var input = new byte[] { 0x41, 0xFF, 0x42, 0xFF, 0xFF, 0x43 };
        var escaped = GmcpBridge.EscapeIacBytes(input);

        // Expected: 0x41, 0xFF, 0xFF, 0x42, 0xFF, 0xFF, 0xFF, 0xFF, 0x43
        // Each 0xFF in the input becomes two 0xFF bytes in the output.
        escaped.Should().Equal(new byte[] { 0x41, 0xFF, 0xFF, 0x42, 0xFF, 0xFF, 0xFF, 0xFF, 0x43 });
    }

    [Fact]
    public void BuildFrame_AsciiOnlyPayload_NoEscapingNeeded()
    {
        // Fast path: input has no 0xFF, output should be identical to input
        // (zero allocations in the helper, return original reference).
        var input = Encoding.UTF8.GetBytes("Hello, MUD!");
        var escaped = GmcpBridge.EscapeIacBytes(input);

        // Should be the same content.
        escaped.Should().Equal(input);
    }

    [Fact]
    public void BuildFrame_EmptyPackageName_StillValidFraming()
    {
        // Edge case — empty string package name. Spec doesn't strictly require
        // non-empty package, and we should produce a valid frame either way.
        var frame = GmcpBridge.BuildFrame("", new { x = 1 });

        frame[0].Should().Be(IAC);
        frame[1].Should().Be(SB);
        frame[2].Should().Be(GMCP);
        // Position 3 should be SP (no package bytes).
        frame[3].Should().Be((byte)0x20);
        frame[^2].Should().Be(IAC);
        frame[^1].Should().Be(SE);
    }

    [Fact]
    public void BuildFrame_PayloadIsCamelCase()
    {
        // Mudlet scripts conventionally expect camelCase keys (matches Achaea
        // GMCP convention). PascalCase would break off-the-shelf chat capture
        // and Char.Vitals scripts.
        var frame = GmcpBridge.BuildFrame("Char.Vitals", new
        {
            HP = 50,         // PascalCase input
            MaxHP = 100,
            ManaPower = 25
        });

        var jsonBytes = ExtractPayloadJson(frame);
        var json = Encoding.UTF8.GetString(jsonBytes);

        // Should serialize as camelCase, not PascalCase.
        json.Should().Contain("\"hp\":50");           // not "HP"
        json.Should().Contain("\"maxHP\":100");       // PascalCase letter following lowercase preserved per JsonNamingPolicy.CamelCase
        json.Should().Contain("\"manaPower\":25");
        json.Should().NotContain("\"HP\":");
        json.Should().NotContain("\"MaxHP\":");
    }

    [Fact]
    public void BuildFrame_PayloadIsCompactNotIndented()
    {
        // Conventional GMCP servers send compact JSON. WriteIndented would balloon
        // every frame with whitespace and break some strict parsers.
        var frame = GmcpBridge.BuildFrame("Char.Status", new
        {
            level = 100,
            gold = 12345L
        });

        var jsonBytes = ExtractPayloadJson(frame);
        var json = Encoding.UTF8.GetString(jsonBytes);

        // Compact form: no newlines, no leading whitespace.
        json.Should().NotContain("\n");
        json.Should().NotContain("  ");
        json.Should().StartWith("{");
        json.Should().EndWith("}");
    }

    [Fact]
    public void BuildFrame_LongPackageNameAndPayload_StillFramedCorrectly()
    {
        // Stress test — make sure the byte-array offset arithmetic in BuildFrame
        // handles non-trivial sizes correctly.
        string longPackage = "Comm.Channel.Text";
        var payload = new
        {
            channel = "gossip",
            talker = "PlayerWithVeryLongName",
            text = new string('A', 500) // long message body
        };

        var frame = GmcpBridge.BuildFrame(longPackage, payload);

        // Header still present.
        frame[0].Should().Be(IAC);
        frame[1].Should().Be(SB);
        frame[2].Should().Be(GMCP);
        // Trailer still present.
        frame[^2].Should().Be(IAC);
        frame[^1].Should().Be(SE);

        // Total length sanity: header (3) + package (17) + space (1) + payload + trailer (2)
        // Should be ~565 bytes given the 500-char text.
        frame.Length.Should().BeGreaterThan(500);

        // No extra IAC SE pair somewhere in the middle (would terminate prematurely).
        // Walk the body from offset 3 to end-2 and verify no IAC followed by SE.
        for (int i = 3; i < frame.Length - 2; i++)
        {
            if (frame[i] == IAC && frame[i + 1] == SE)
                Assert.Fail($"Found premature IAC SE at offset {i} — would break subnegotiation");
        }
    }

    /// <summary>Extract just the JSON payload bytes (between the SP separator and the trailing IAC SE).</summary>
    private static byte[] ExtractPayloadJson(byte[] frame)
    {
        // Find the space (0x20) that separates package from JSON.
        int spIdx = -1;
        for (int i = 3; i < frame.Length - 2; i++)
        {
            if (frame[i] == 0x20) { spIdx = i; break; }
        }
        spIdx.Should().BeGreaterThan(0, "frame should contain a space separator");

        return frame[(spIdx + 1)..^2];
    }
}
