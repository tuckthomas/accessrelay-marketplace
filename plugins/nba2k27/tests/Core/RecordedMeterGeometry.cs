using System.Text.Json;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal sealed class RecordedMeterGeometry(JsonElement rows) : INbaMeterDetector
{
    private readonly Dictionary<long, JsonElement> _images = rows.EnumerateArray().ToDictionary(r => r.GetProperty("seq").GetInt64());
    private double? _thickness;
    internal NbaMeterDetector.Measurement? Current { get; private set; }
    public bool Ambiguous { get; private set; }
    public bool HasRailIdentity { get; private set; }
    public NbaMeterDetector.Measurement? Detect(ReadOnlySpan<byte> pixels, int width, int height, int stride) => Current;
    public void Reset() { }

    internal void Read(JsonElement frame, long seq, int w, int h)
    {
        var live = frame.GetProperty("signal").Deserialize<VisionSignalObservation>(NbaMeterSettings.Json);
        Current = null; Ambiguous = false; HasRailIdentity = false;
        if (_images.TryGetValue(seq, out var image))
        {
            Ambiguous = image.GetProperty("ambiguous").GetBoolean();
            HasRailIdentity = image.GetProperty("rail").GetBoolean();
            if (image.GetProperty("found").ValueKind == JsonValueKind.Object)
            {
                var edge = image.GetProperty("found").Deserialize<NbaMeterDetector.Measurement>(NbaMeterSettings.Json);
                Current = edge with { MeasuredFill = image.GetProperty("measuredFill").ValueKind == JsonValueKind.True };
            }
        }
        if (live?.Region is not { } b)
        {
            if (live?.Message.Contains("rails tracked", StringComparison.OrdinalIgnoreCase) == true) HasRailIdentity = true;
            if (live?.Message.Contains("ambiguous", StringComparison.OrdinalIgnoreCase) == true && !live.Message.Contains("unambiguous")) Ambiguous = true;
            return;
        }
        Ambiguous = false;
        if (Current is { } detected && Math.Abs(detected.Bounds.Left - b.Left) < .03 && Math.Abs(detected.Bounds.Top - b.Top) < .04)
        {
            _thickness = detected.Thickness;
            Current = detected with { Bounds = b, Progress = live.Progress, Score = live.Confidence };
            return;
        }
        double box = b.Height * h;
        // The detector's bounds include one cap width at each end of the rail.
        double thickness = Math.Clamp(_thickness ?? box / 10, box / 16, box / 9);
        Current = new(b, live.Progress, live.Confidence, box - 2 * thickness, (b.Left + b.Width / 2) * w, b.Top * h + thickness,
            Bow: thickness, Thickness: thickness) { MeasuredFill = live.Samples > 0 };
    }
}
