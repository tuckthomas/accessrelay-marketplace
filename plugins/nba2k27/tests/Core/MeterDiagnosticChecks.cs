using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal static class MeterDiagnosticChecks
{
    internal static void Inspect(string directory, string output, string? referenceFile = null, bool useLoggedSignals = false,
        string? pixelReport = null, double? effectiveCorrection = null, bool preferImages = false)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "diagnostic.json")));
        var root = document.RootElement; var context = root.GetProperty("context");
        var profile = context.GetProperty("selection").GetProperty("profile").Deserialize<Nba2K27ShotProfile>(NbaMeterSettings.Json)!;
        var settings = context.GetProperty("settings").Deserialize<VisionSettings>(NbaMeterSettings.Json)!;
        var config = NbaMeterSettings.Read(settings);
        if (referenceFile is null) config = config with { CalibrationTrial = true };
        else
        {
            using var cache = JsonDocument.Parse(File.ReadAllBytes(referenceFile));
            string key = config.TuningContextKey(profile, settings);
            var rootRef = cache.RootElement;
            if (rootRef.GetProperty("contextKey").GetString() != key) throw new InvalidDataException("Sweep references belong to another capture or calibration.");
            string dir = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(output))!, Path.GetFileName(output) + ".references");
            profile = profile with { MeterTimingDirectory = dir };
            var sweeps = rootRef.GetProperty("references").Deserialize<NbaMeterSweep[]>(NbaMeterSettings.Json)!;
            if (!sweeps.All(NbaMeterSweep.IsValid) || sweeps.Length is < 2 or > 5) throw new InvalidDataException("Invalid sweep references.");
            new NbaMeterTimingStore(dir, profile.Id, key).Save(rootRef.GetProperty("width").GetInt32(), rootRef.GetProperty("height").GetInt32(), sweeps);
        }
        var detector = new NbaMeterDetector(config);
        using var pixelData = pixelReport is null or "-" ? null : JsonDocument.Parse(File.ReadAllBytes(pixelReport));
        var observations = pixelReport is null ? null : new RecordedMeterGeometry(pixelData?.RootElement.GetProperty("rows") ?? default, preferImages);
        using var predictor = new NbaMeterPredictor(profile, config, settings, observations);
        var arbiter = new ControllerOutputArbiter(Stopwatch.Frequency);
        arbiter.Configure(effectiveCorrection.HasValue ? settings with { CorrectionMs = effectiveCorrection.Value } : settings, predictor.Action);
        arbiter.BeginSession();
        var rows = new List<object>(); byte[] pixels = []; long timeline = 0, measuredToken = 0; ControllerState previous = default;
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
                arbiter.Sample(polled, polled, true, true, false, timeline, newHold ? original.HoldStartedTimestamp : timeline,
                    newHold ? original.HeldPaddles : previousPaddles);
                arbiter.RecordOutputSubmitted(arbiter.Output, timeline);
            }
            timeline = now; arbiter.Sample(physical, physical, true, true, false, now,
                original.HoldStartedTimestamp > 0 ? original.HoldStartedTimestamp : original.InputTimestamp, original.HeldPaddles);
            arbiter.RecordOutputSubmitted(arbiter.Output, now);
            previous = physical; previousPaddles = original.HeldPaddles;
            var before = arbiter.Status;
            VisionSignalObservation? signal;
            NbaMeterDetector.Measurement? found = null;
            double detectorMs = 0;
            string? filename = null;
            bool submit;
            if (useLoggedSignals)
            {
                signal = frame.GetProperty("signal").Deserialize<VisionSignalObservation>(NbaMeterSettings.Json);
                submit = frame.GetProperty("predictionSubmitted").GetBoolean();
            }
            else
            {
                // All input polls are replayed. A missing image contributes no new pixel inference.
                int w = frame.GetProperty("width").GetInt32(), h = frame.GetProperty("height").GetInt32(), stride = frame.GetProperty("stride").GetInt32();
                int size = checked(stride * h); if (pixels.Length != size) pixels = new byte[size];
                if (observations is not null)
                {
                    observations.Read(frame, seq, w, h);
                    found = observations.Current;
                    if (preferImages && pixelReport != "-" && !observations.HasObservation &&
                        measuredToken != 0 && before.ShotToken == measuredToken) continue;
                    if (found is { MeasuredFill: true }) measuredToken = before.ShotToken;
                }
                else
                {
                    if (!frame.TryGetProperty("file", out var image) || image.ValueKind != JsonValueKind.String) continue;
                    filename = image.GetString()!;
                    using (var gzip = new GZipStream(File.OpenRead(Path.Combine(directory, filename)), CompressionMode.Decompress)) gzip.ReadExactly(pixels);
                    long began = Stopwatch.GetTimestamp();
                    found = detector.Detect(pixels, w, h, stride); detectorMs = Stopwatch.GetElapsedTime(began).TotalMilliseconds;
                }
                var simulated = original with { Armed = true, SessionGeneration = before.SessionGeneration, ShotToken = before.ShotToken,
                    ShotStartedTimestamp = before.ShotStartedTimestamp, StrokeAnchorTimestamp = arbiter.StrokeAnchorTimestamp,
                    MinimumStrokeLeadMs = arbiter.MinimumStrokeLeadMs + Math.Max(0,
                        Stopwatch.GetElapsedTime(ticks, now).TotalMilliseconds - frame.GetProperty("processingMs").GetDouble()) };
                signal = predictor.Observe(pixels, w, h, stride, seq, frame.GetProperty("sourceGeneration").GetInt64(), ticks, simulated);
                submit = signal.HasDecision;
            }
            bool accepted = false;
            if (signal?.ForecastLimit is { } limit) arbiter.NoteForecastLimit(before.SessionGeneration, before.ShotToken, limit);
            if (before.ShotToken != 0 && signal is not null && submit)
                accepted = arbiter.Submit(new(before.SessionGeneration, before.ShotToken, seq, ticks, now, signal.TimeToTargetMs ?? 0,
                    signal.Confidence, signal.UncertaintyMs, signal.Acquired && !signal.InvalidateAttempt)
                    { WithdrawPendingForecast = signal.WithdrawPendingForecast, ContinueCommittedAction = signal.ContinueCommittedAction && !signal.InvalidateAttempt,
                        TrackingFailure = signal.InvalidateAttempt ? signal.Message : null }, now);
            if (accepted && arbiter.StrokeStartDue(now) && arbiter.TryAdvanceDeadline(now)) arbiter.RecordOutputSubmitted(arbiter.Output, now);
            rows.Add(new { seq, ticks, found, measuredFill = found?.MeasuredFill, leadingEdge = found?.FillTopFromCap, rail = detector.HasRailIdentity, ambiguous = detector.Ambiguous, detectorMs, signal, accepted,
                state = arbiter.Status, rightY = arbiter.Output.RightY, receipt = arbiter.LastAction, attempt = arbiter.LastAttempt, file = filename });
        }
        File.WriteAllText(output, JsonSerializer.Serialize(new { scope = preferImages ? "Retained image measurements, supplemented only by observed geometry on frames without pixels. No controller is connected." : observations is not null ? "Predictor and controller replay of logged fill and position. Retained rail geometry supplements the log. For a missing image, the rail is estimated from its bounds and the last measured cap thickness." : useLoggedSignals ? "Controller-only replay of all recorded predictor submissions. Output is simulated." : "Device-free replay of retained diagnostic images with recorded physical input. Missing images stay missing. Output is simulated, never sent to Xbox.", rows },
            new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
        Console.WriteLine($"SUCCESS Replayed {rows.Count} {(useLoggedSignals || observations is not null ? "logged observations" : "retained images")} without controller output: {output}");
    }
}
