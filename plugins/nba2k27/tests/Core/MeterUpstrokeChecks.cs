using System.Diagnostics;
using System.Text.Json;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal static class MeterUpstrokeChecks
{
    private sealed record Shot(string Name, double? TargetMs, double[][] Frames, bool Truncated = false);
    private sealed record Fixture(double[][] References, Shot[] Shots);
    private sealed class Detector : INbaMeterDetector
    {
        internal NbaMeterDetector.Measurement Meter;
        public bool Ambiguous => false;
        public void Reset() { }
        public NbaMeterDetector.Measurement? Detect(ReadOnlySpan<byte> pixels, int width, int height, int stride) => Meter;
    }

    internal static void Run()
    {
        // Only numeric meter readings from the Windows test are retained. References come
        // from three separate validated native strokes. None of the test shots trained them.
        var fixture = JsonSerializer.Deserialize<Fixture>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,
            "Fixtures", "meter-upstroke-timings.json")), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        using var directory = new TemporaryDirectory();
        const int width = 2560, height = 1440;
        var profile = Nba2K27ShotProfile.Create() with { Base = "Test base", UpperRelease1 = "Test upper",
            UpperRelease2 = "Test upper two", UsesShotMeter = true, MeterReleaseType = "Release", MeterTimingDirectory = directory.Path };
        var settings = VisionSettings.Default with { EstimatedVideoDelayMs = 60, EstimatedInputDelayMs = 15,
            CorrectionMs = 2, TempoCorrectionMs = 6, MaximumLatenessMs = 5, MaximumFrameAgeMs = 80,
            MinimumConfidence = .65, MaximumUncertaintyMs = 12, CaptureSourceKey = "test-direct" };
        var config = new NbaMeterSettings { Enabled = true, Confirmed = true, GameBuild = "fixture",
            TargetProgress = .75, StrokeDurationMs = 48, AnchorFraction = .85, CalibratedWidth = width, CalibratedHeight = height };
        string key = config.Key(profile, settings), context = config.TuningContextKey(profile, settings);
        config = config with { Results = Enumerable.Range(1, 3).Select(i => new NbaMeterCalibrationResult(i, key, "excellent",
            "none", i, Guid.NewGuid().ToString("N"), width, height, context, 2, 48, "rhythm", 6, 54)).ToArray() };
        var store = new NbaMeterTimingStore(directory.Path, profile.Id, context);
        CheckPracticeHandoff(profile, config, settings, store);
        var clipped = new NbaMeterDetector.Measurement(new(.35, .4, .04, .17), .186, .95, 135, 800, 600)
            { MeasuredFill = true, FillTopFromCap = 107 };
        var stabilized = NbaMeterDetector.StabilizeHeight(clipped, 150, height);
        if (stabilized.Progress is <= .24 or >= .29 || stabilized.FillTopFromCap != 107)
            throw new Exception("A briefly clipped bottom edge hid the advancing fill or introduced a phase jump.");
        // Existing installations of beta.4 have the six fixed levels in a version 1 file.
        string legacyFile = Path.Combine(directory.Path, "MeterTiming", $"{profile.Id:N}.{context}.{width}x{height}.json");
        File.WriteAllText(legacyFile, JsonSerializer.Serialize(new { version = 1, contextKey = context, width, height, sweeps = fixture.References }));
        if (store.Load(width, height).Length != 3 || store.Load(width / 2, height / 2).Length != 0
            || new NbaMeterTimingStore(directory.Path, Guid.NewGuid(), context).Load(width, height).Length != 0
            || new NbaMeterTimingStore(directory.Path, profile.Id, config.TuningContextKey(profile,
                settings with { CaptureSourceKey = "other-source" })).Load(width, height).Length != 0)
            throw new Exception("Meter timing was missing or crossed a profile, source or resolution boundary.");

        var pixels = new byte[width * height * 4];
        foreach (var shot in fixture.Shots)
        {
            var detector = new Detector();
            using var predictor = new NbaMeterPredictor(profile, config, settings, detector);
            var arbiter = new ControllerOutputArbiter(Stopwatch.Frequency);
            arbiter.Configure(settings, predictor.Action);
            arbiter.BeginSession();
            long origin = Stopwatch.Frequency;
            arbiter.Sample(default, default, true, true, false, origin - 1);
            if (!arbiter.SetArmed(true)) throw new Exception("Could not arm the test controller.");
            long poll = origin, step = (long)(Stopwatch.Frequency * .002), sequence = 0;
            double? lead = null;
            bool down = false, up = false;
            void PollThrough(long timestamp)
            {
                while (poll <= timestamp)
                {
                    var output = arbiter.Sample(default, default, true, true, false, poll, poll, PaddleButtons.LargeRight);
                    arbiter.RecordOutputSubmitted(output, poll);
                    down |= output.RightY == short.MinValue;
                    up |= output.RightY == short.MaxValue;
                    poll += step;
                }
            }
            foreach (var sample in shot.Frames)
            {
                // Capture time since P4, fill, score, processing time, apparent meter height, ROI left and top.
                long capture = origin + (long)Math.Round(sample[0] * Stopwatch.Frequency / 1000);
                long decision = capture + (long)Math.Round(sample[3] * Stopwatch.Frequency / 1000);
                PollThrough(decision);
                var before = arbiter.Status;
                detector.Meter = new(new(sample[5], sample[6], .025, sample[4] / height), sample[1], sample[2], sample[4],
                    sample[5] * width, sample[6] * height, Bow: .1) { MeasuredFill = true };
                var signal = predictor.Observe(pixels, width, height, width * 4, ++sequence, 1, capture,
                    new(default(ControllerState), capture, before.SessionGeneration, before.ShotToken, origin, true)
                    { HoldStartedTimestamp = origin, HeldPaddles = PaddleButtons.LargeRight, StrokeAnchorTimestamp = arbiter.StrokeAnchorTimestamp });
                if (!predictor.CanArm) throw new Exception("Saved practice results did not enable assistance.");
                if (before.ShotToken == 0 || !(signal.HasDecision)) continue;
                bool accepted = arbiter.Submit(new(before.SessionGeneration, before.ShotToken, sequence, capture, decision,
                    signal.TimeToTargetMs ?? 0, signal.Confidence, signal.UncertaintyMs, signal.Acquired && !signal.InvalidateAttempt)
                    { WithdrawPendingForecast = signal.WithdrawPendingForecast, ContinueCommittedAction = signal.ContinueCommittedAction, TrackingFailure = signal.Message }, decision);
                if (accepted && signal.TimeToTargetMs.HasValue) lead ??= signal.TimeToTargetMs;
            }
            if (shot.Truncated)
            {
                if (arbiter.Status.ShotToken == 0 || arbiter.LastAttempt is not null || up)
                    throw new Exception("A short, accelerating fit cancelled the hold or sent an unverified upstroke.");
                Console.WriteLine($"SUCCESS {shot.Name}: still tracking when the old version cancelled at 28% fill; later geometry unavailable.");
                continue;
            }
            // The old cancelled traces stop reporting geometry. Advance only physical polling and
            // the real deadline scheduler after the final recorded measurement.
            PollThrough(origin + Stopwatch.Frequency * 3 / 2);
            if (!down || !up || lead is not > 145 || arbiter.LastAttempt is not { Outcome: VisionActionOutcome.Completed,
                    EligibleForFeedback: true, ActualAnchorTimestamp: > 0 } receipt)
                throw new Exception($"{shot.Name}: missing complete upstroke, first forecast {lead}, {arbiter.LastAttempt?.CancellationReason}.");
            double target = (receipt.AnchorTimestamp - origin) * 1000d / Stopwatch.Frequency
                + settings.EstimatedVideoDelayMs + settings.EstimatedInputDelayMs - settings.CorrectionMs;
            if (shot.TargetMs is { } original && Math.Abs(target - original) > settings.MaximumUncertaintyMs)
                throw new Exception($"{shot.Name}: the scheduled target shifted from {original:F1} to {target:F1} ms.");
            if (arbiter.Output.RightY != 0) throw new Exception("Right stick did not return to neutral.");
            Console.WriteLine($"SUCCESS {shot.Name}: first forecast {lead:F1} ms ahead; native scheduler sent full up and neutral.");
        }
    }

    private static void CheckPracticeHandoff(Nba2K27ShotProfile profile, NbaMeterSettings config,
        VisionSettings settings, NbaMeterTimingStore store)
    {
        const int width = 160, height = 100;
        var pixels = new byte[width * height * 4];
        var detector = new Detector();
        using (var trial = new NbaMeterPredictor(profile, config with { CalibrationTrial = true, Confirmed = false }, settings, detector))
        {
            for (int hold = 0; hold < 2; hold++)
            {
                long start = Stopwatch.Frequency * (1 + hold);
                for (int ms = 80; ms < 480; ms += 16)
                {
                    long time = start + ms * Stopwatch.Frequency / 1000;
                    double progress = .08 + (ms - 80) * .002;
                    detector.Meter = new(new(.3, .4, .03, .15), progress, .98, 145, 52, 50, Bow: .1) { MeasuredFill = true };
                    trial.Observe(pixels, width, height, width * 4, ms + hold * 1000, 1, time,
                        new(default(ControllerState), time, 1, hold + 1, start, true)
                        { HoldStartedTimestamp = start, HeldPaddles = PaddleButtons.LargeRight });
                }
            }
        }
        if (store.Load(width, height).Length != 2)
            throw new Exception("Restarting after practice discarded the two observed meter sweeps.");
        Console.WriteLine("SUCCESS practice timing persisted across predictor disposal with its profile, source and capture size.");
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        internal string Path { get; } = Directory.CreateTempSubdirectory("nba-meter-timing-").FullName;
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
