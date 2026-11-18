using System.Text.Json;

namespace EliteScriptStudio.Packs.Nba2K27;

// This cache holds milliseconds at observed meter fill levels. A different player setup,
// capture route or picture size has a separate entry. It never arms the controller.
internal sealed class NbaMeterTimingStore(string profileDirectory, Guid profileId, string contextKey)
{
    private sealed record Document(int Version, string ContextKey, int Width, int Height,
        double[][]? Sweeps = null, NbaMeterSweep[]? References = null);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private string PathFor(int width, int height) => Path.Combine(profileDirectory, "MeterTiming",
        $"{profileId:N}.{contextKey}.{width}x{height}.json");

    internal NbaMeterSweep[] Load(int width, int height)
    {
        try
        {
            using var input = new FileStream(PathFor(width, height), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
            if (input.Length is <= 0 or > 16384) return [];
            var doc = JsonSerializer.Deserialize<Document>(input, Json);
            if (doc is null || doc.ContextKey != contextKey || doc.Width != width || doc.Height != height) return [];
            var references = doc switch
            {
                { Version: 1, Sweeps.Length: > 0 and <= NbaMeterSweepTiming.Capacity } =>
                    doc.Sweeps.Select(NbaMeterSweep.FromLegacy).ToArray(),
                { Version: 2, References.Length: > 0 and <= NbaMeterSweepTiming.Capacity } => doc.References,
                _ => []
            };
            return references.All(NbaMeterSweep.IsValid) ? references : [];
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { return []; }
    }

    internal void Save(int width, int height, NbaMeterSweep[] sweeps)
    {
        if (sweeps.Length is 0 or > NbaMeterSweepTiming.Capacity || !sweeps.All(NbaMeterSweep.IsValid)) return;
        try
        {
            string path = PathFor(width, height);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var document = new Document(2, contextKey, width, height, References: sweeps);
            byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(document, Json);
            Nba2K27ShotProfileStore.WriteAtomically(path, bytes);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* In-memory timing remains usable. */ }
    }

    internal static void DeleteProfile(string profileDirectory, Guid profileId)
    {
        string directory = Path.Combine(profileDirectory, "MeterTiming");
        if (!Directory.Exists(directory)) return;
        foreach (string file in Directory.EnumerateFiles(directory, $"{profileId:N}.*.json")) File.Delete(file);
    }
}
