using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

public sealed class NbaPluginFactory : IGamePluginFactory
{
    // A null directory retains the existing per-user NBA profile store and IDs.
    public IVisionGamePlugin Create(GamePluginContext context) => new Nba2K27VisionPlugin(context.ProfileDirectory);
}
