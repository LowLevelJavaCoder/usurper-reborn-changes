public class PlayerDistrictLocation : BaseLocation
{
    public PlayerDistrictLocation() : base (
        GameLocation.PlayerDistrict,
        "Player District",
        "You are standing in a place of construction and of places built by those controled by the beings known as 'Players'" // Feel free to change description. Describe it however you want. The mechanics itself are what I care
        
    ) {}

    protected override void SetupLocation()
    {
        base.SetupLocation();
        // Whatever else I may need to do.
    }

    protected override string GetMudPromptName() => "Player District";

    protected override string[]? GetAmbientMessages() => new[]
    {
      "The WORLD trembles as beings known as Players construct their growing buisnesses to support their avatars.",
      "Someone walks by and tells you to join the discord chat.",
      "You a player or an NPC? OR A player like an NPC who is on mud abusing automation?",
      "Your internet is slow so your playing a text based MMORPG.",
      "Whats your operating system? I bet manwe uses Linux, you should too.",
      "Maelketh uses Windows because it really helps him keep his rage high.",
      "Did you die from beta? oof.",
      "I am bored of writing these ambient messages",
      "Ambient Message",
      "You feel ambience",
      "1 gold bounty on Coosh",
      "*2487#(#$&*97284#*(&$*(^#(^&*676(&*^7^75&%76%7(5^8)&^789)))))",
      "This game was coded in C#, you know whats better? The programmable programming language."
    };

    protected override void DisplayLocation()
    {
        if (IsScreenReader && currentPlayer != null)
        {
            DisplayLocationSR();
            return;
        }
        if (IsBBSSession) { DisplayLocationBBS(); return; }
        DisplayLocationBoring(currentPlayer);
    }

    private void DisplayLocationSR()
    {
        terminal.ClearScreen();
    }
}