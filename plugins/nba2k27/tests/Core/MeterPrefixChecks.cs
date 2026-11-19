using System.Text.Json;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal static class MeterPrefixChecks
{
    // Replay measured fill only. The live log also covers frames whose pixels weren't stored.
    // Rail thickness wasn't logged, so use the smallest rail compatible with the detector bounds.
    internal static void Run(string recording, string cache, string report)
    {
        using var doc = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(recording, "diagnostic.json")));
        using var saved = JsonDocument.Parse(File.ReadAllBytes(cache));
        var refs = saved.RootElement.GetProperty("references").Deserialize<NbaMeterSweep[]>(NbaMeterSettings.Json)!;
        var root = doc.RootElement;
        var settings = root.GetProperty("context").GetProperty("settings").Deserialize<VisionSettings>(NbaMeterSettings.Json)!;
        var config = NbaMeterSettings.Read(settings);
        double freq = root.GetProperty("stopwatchFrequency").GetDouble();
        var rows = new List<object>();
        long token = 0;
        var sweeps = new NbaMeterSweepTiming(config.TargetProgress);
        foreach (var frame in root.GetProperty("frames").EnumerateArray())
        {
            var ctx = frame.GetProperty("physicalContext").Deserialize<VisionSignalContext>(NbaMeterSettings.Json);
            if (ctx.ShotToken == 0) continue;
            if (token != ctx.ShotToken) { token = ctx.ShotToken; sweeps.Restore(refs); }
            var signal = frame.GetProperty("signal").Deserialize<VisionSignalObservation>(NbaMeterSettings.Json);
            if (signal?.Region is not { } bounds || signal.Samples == 0) continue;
            double height = signal.CaptureHeight * bounds.Height / (1 + 2d / 7);
            var edge = new NbaMeterDetector.Measurement(bounds, signal.Progress, signal.Confidence, height, 0, 0) { MeasuredFill = true };
            long ticks = signal.CaptureTimestamp;
            var estimate = sweeps.Observe(edge, false, ticks * 1000 / freq, true);
            double age = (frame.GetProperty("completedTicks").GetInt64() - ticks) * 1000 / freq;
            double required = settings.EstimatedVideoDelayMs + settings.EstimatedInputDelayMs - settings.CorrectionMs
                + config.AnchorFraction * config.EffectiveStrokeMs(settings) + age - settings.MaximumLatenessMs;
            bool qualified = estimate is not null && estimate.Tau >= required && estimate.Tau <= 400
                && signal.Confidence >= settings.MinimumConfidence
                && estimate.Uncertainty <= (estimate.Tau > 175 ? Math.Min(8.5, settings.MaximumUncertaintyMs) : settings.MaximumUncertaintyMs);
            rows.Add(new { token, ticks, signal.Sequence, signal.Progress, estimate, required, qualified, age });
        }
        File.WriteAllText(report, JsonSerializer.Serialize(rows, NbaMeterSettings.Json));
    }
}
