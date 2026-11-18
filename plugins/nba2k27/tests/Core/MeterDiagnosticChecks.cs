using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal static class MeterDiagnosticChecks
{
    internal static void Inspect(string directory, string output)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "diagnostic.json")));
        var root = document.RootElement; var context = root.GetProperty("context");
        var profile = context.GetProperty("selection").GetProperty("profile").Deserialize<Nba2K27ShotProfile>(NbaMeterSettings.Json)!;
        var settings = context.GetProperty("settings").Deserialize<VisionSettings>(NbaMeterSettings.Json)!;
        var config = NbaMeterSettings.Read(settings) with { CalibrationTrial = true };
        var detector = new NbaMeterDetector(config);
        using var predictor = new NbaMeterPredictor(profile, config, settings);
        var arbiter = new ControllerOutputArbiter(Stopwatch.Frequency);
        arbiter.Configure(settings, predictor.Action); arbiter.BeginSession();
        var rows = new List<object>(); byte[] pixels = []; long timeline = 0; ControllerState previous = default;
        PaddleButtons previousPaddles = PaddleButtons.None;
        var frames = root.GetProperty("frames").EnumerateArray().ToArray();
        foreach (var frame in frames)
        {
            long seq = frame.GetProperty("sequence").GetInt64(), ticks = frame.GetProperty("captureTicks").GetInt64();
            var original = frame.GetProperty("physicalContext").Deserialize<VisionSignalContext>(NbaMeterSettings.Json);
            var physical = original.Physical ?? default;
            long now = Math.Max(frame.GetProperty("completedTicks").GetInt64(), Math.Max(ticks, original.InputTimestamp));
            if (frame.TryGetProperty("streamTelemetry", out var health) && health.ValueKind == JsonValueKind.Object &&
                health.TryGetProperty("direct", out var direct) && direct.ValueKind == JsonValueKind.Object)
                arbiter.ObserveStreamTelemetry(direct.Deserialize<DirectStreamMetrics>(NbaMeterSettings.Json)!);
            if (timeline == 0)
            {
                timeline = now; arbiter.Sample(default, default, true, true, false, timeline);
                if (!arbiter.SetArmed(true)) throw new InvalidOperationException(arbiter.Status.Message);
            }
            long step = Math.Max(1, Stopwatch.Frequency / 500);
            while (timeline + step < now)
            {
                timeline += step;
                bool newHold = original.HoldStartedTimestamp > 0 && timeline >= original.HoldStartedTimestamp;
                var polled = newHold ? physical : previous;
                arbiter.Sample(polled, polled, true, true, false, timeline, timeline, newHold ? original.HeldPaddles : previousPaddles);
                arbiter.RecordOutputSubmitted(arbiter.Output, timeline);
            }
            timeline = now; arbiter.Sample(physical, physical, true, true, false, now,
                original.InputTimestamp, original.HeldPaddles);
            arbiter.RecordOutputSubmitted(arbiter.Output, now);
            previous = physical; previousPaddles = original.HeldPaddles;
            // Advance the physical timeline even when an image was dropped. Never fabricate its pixels.
            if (!frame.TryGetProperty("file", out var image) || image.ValueKind != JsonValueKind.String) continue;
            int w = frame.GetProperty("width").GetInt32(), h = frame.GetProperty("height").GetInt32(), stride = frame.GetProperty("stride").GetInt32();
            int size = checked(stride * h); if (pixels.Length != size) pixels = new byte[size];
            using (var gzip = new GZipStream(File.OpenRead(Path.Combine(directory, image.GetString()!)), CompressionMode.Decompress)) gzip.ReadExactly(pixels);
            long began = Stopwatch.GetTimestamp();
            var found = detector.Detect(pixels, w, h, stride); double detectorMs = Stopwatch.GetElapsedTime(began).TotalMilliseconds;
            var before = arbiter.Status;
            var simulated = original with { Armed = true, SessionGeneration = before.SessionGeneration, ShotToken = before.ShotToken,
                ShotStartedTimestamp = before.ShotStartedTimestamp, StrokeAnchorTimestamp = arbiter.StrokeAnchorTimestamp };
            var signal = predictor.Observe(pixels, w, h, stride, seq, frame.GetProperty("sourceGeneration").GetInt64(), ticks, simulated);
            bool accepted = false;
            if (before.ShotToken != 0 && (signal.TimeToTargetMs.HasValue || signal.InvalidateAttempt || signal.ContinueCommittedAction))
                accepted = arbiter.Submit(new(before.SessionGeneration, before.ShotToken, seq, ticks, now, signal.TimeToTargetMs ?? 0,
                    signal.Confidence, signal.UncertaintyMs, signal.Acquired && !signal.InvalidateAttempt)
                    { ContinueCommittedAction = signal.ContinueCommittedAction && !signal.InvalidateAttempt,
                        TrackingFailure = signal.InvalidateAttempt ? signal.Message : null }, now);
            rows.Add(new { seq, ticks, found, ambiguous = detector.Ambiguous, detectorMs, signal, accepted,
                state = arbiter.Status, rightY = arbiter.Output.RightY, receipt = arbiter.LastAction, attempt = arbiter.LastAttempt, file = image.GetString() });
        }
        File.WriteAllText(output, JsonSerializer.Serialize(new { scope = "Device-free replay of retained diagnostic images with recorded physical input. Missing images stay missing. Output is simulated, never sent to Xbox.", rows },
            new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
        Console.WriteLine($"SUCCESS Inspected {rows.Count} retained diagnostic images without controller output: {output}");
    }
}
