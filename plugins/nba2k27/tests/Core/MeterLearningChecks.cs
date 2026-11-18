using System.Diagnostics;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal static class MeterLearningChecks
{
    private const int Width = 800, Height = 540;
    private const double Target = .75;

    internal static void Run()
    {
        string directory = Directory.CreateTempSubdirectory("nba-meter-learning-").FullName;
        try
        {
            var profile = Nba2K27ShotProfile.Create() with { Base = "Base", UpperRelease1 = "Upper 1", UpperRelease2 = "Upper 2",
                UsesShotMeter = true, MeterReleaseType = "Release", MeterTimingDirectory = directory };
            var settings = VisionSettings.Default with { CaptureSourceKey = "direct-test", MinimumConfidence = .65 };
            var config = new NbaMeterSettings { Enabled = true, CalibrationTrial = true, GameBuild = "fixture", HoldMs = 0, TargetProgress = Target };
            var store = new NbaMeterTimingStore(directory, profile.Id, config.TuningContextKey(profile, settings));
            var pixels = new byte[Width * Height * 4];
            var detector = new NbaMeterDetector(config);
            using (var predictor = new NbaMeterPredictor(profile, config, settings))
            {
                for (int hold = 1; hold <= 2; hold++)
                {
                    Render(pixels, .18, twoMeters: true);
                    if (detector.Detect(pixels, Width, Height, Width * 4) is not null || !detector.Ambiguous)
                        throw new Exception("The two-meter BGRA frame did not exercise pre-acquisition ambiguity.");
                    var search = Observe(0);
                    if (search.InvalidateAttempt || search.Acquired) throw new Exception("Ambiguity before acquisition cancelled the shot.");
                    for (int ms = 16; ms <= 352; ms += 16)
                    {
                        Render(pixels, .18 + .002 * (ms - 16));
                        if (ms == 16)
                        {
                            detector.Reset();
                            if (detector.Detect(pixels, Width, Height, Width * 4) is not { MeasuredFill: true, Progress: > .15 and < .25 })
                                throw new Exception("The first single-meter BGRA frame did not yield a measured fill above 15%.");
                        }
                        var reading = Observe(ms);
                        if (ms == 16 && !reading.Acquired) throw new Exception("The predictor did not recover after the ambiguous frame.");
                    }
                    detector.Reset();

                    VisionSignalObservation Observe(int ms)
                    {
                        long start = hold * Stopwatch.Frequency;
                        long timestamp = start + ms * Stopwatch.Frequency / 1000;
                        return predictor.Observe(pixels, Width, Height, Width * 4, 100 * hold + ms / 16, 1, timestamp,
                            new(default(ControllerState), timestamp, 1, hold, start, true)
                            { HoldStartedTimestamp = start, HeldPaddles = PaddleButtons.LargeRight });
                    }
                }
            }
            var saved = store.Load(Width, Height);
            if (saved.Length != 2 || saved.Any(sweep => sweep.Levels[0] * Target <= .15 || sweep.Levels[^1] != 1))
                throw new Exception("Cold-cache learning lost the two late-acquired sweeps or fabricated a missing crossing.");

            var history = new NbaMeterSweepTiming(Target);
            history.Restore(saved);
            double? earliest = null;
            detector.ResetSession();
            for (int ms = 0; ms < 336; ms += 16)
            {
                Render(pixels, .18 + .002 * ms);
                var reading = detector.Detect(pixels, Width, Height, Width * 4);
                var estimate = history.Observe(reading, detector.Ambiguous, ms, trackingAcquired: ms > 0);
                if (estimate is { Uncertainty: <= 12, Tau: > 120 }) earliest ??= estimate.Tau;
            }
            if (!earliest.HasValue) throw new Exception("A matching shot could not use the saved partial sweeps.");

            int completedBeforeNegative = history.CompletedSweeps;
            history.BeginHold();
            for (int ms = 0; ms <= 400; ms += 16)
            {
                // The cache has no evidence below its first observed level. A near-cap start
                // has too little visible travel to become a third calibration reference.
                double progress = ms < 192 ? .151 + ms * .00008 : .70 + (ms - 192) * .0004;
                var sample = new NbaMeterDetector.Measurement(new(.25, .25, .05, .2), progress, .98, 140, 200, 90) { MeasuredFill = true };
                if (ms == 192) history.BeginHold();
                if (history.Observe(sample, false, ms, trackingAcquired: true) is not null)
                    throw new Exception("The add-on matched outside the overlap with a measured reference.");
            }
            if (history.CompletedSweeps != completedBeforeNegative) throw new Exception("A near-cap sighting was saved as a full sweep.");
            Console.WriteLine($"SUCCESS two ambiguous openings and first fills above 15% learned from BGRA with an empty cache; a matching shot forecast {earliest:F1} ms ahead after reopening.");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    private static void Render(byte[] pixels, double progress, bool twoMeters = false)
    {
        // The rails and the moving inner fill are rasterized independently of the detector.
        System.Runtime.InteropServices.MemoryMarshal.Cast<byte, uint>(pixels.AsSpan()).Fill(0xff262626);
        DrawMeter(245);
        if (twoMeters) DrawMeter(536);

        void DrawMeter(int centerX)
        {
            const int centerY = 145;
            const double bar = 17, length = 139;
            for (int y = centerY - 12; y <= centerY + length + 4; y++)
            for (int x = centerX - 24; x <= centerX + 42; x++)
            {
                double dx = x - centerX, dy = y - centerY, t = dy / length;
                for (int i = 0; i < 3; i++)
                {
                    double slope = .76 * (1 - 2 * t) - .07;
                    double horizontal = dx - length * (.76 * t * (1 - t) - .07 * t);
                    t += (horizontal * slope + dy - t * length) / (length * (1 + slope * slope));
                }
                double distance = Math.Sqrt(Math.Pow(dx - length * (.76 * t * (1 - t) - .07 * t), 2) + Math.Pow(dy - t * length, 2));
                int offset = 4 * (y * Width + x);
                if (t is >= .04 and <= .98 && distance <= .55 * bar)
                {
                    byte shade = t >= .96 - .90 * progress && t <= .96 && distance <= .24 * bar ? (byte)184 : (byte)107;
                    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = shade;
                    pixels[offset + 3] = 255;
                }
                if (Math.Abs(dx * .8 - dy * .6) <= 8 && Math.Abs(dx * .6 + dy * .8) <= 2)
                {
                    pixels[offset] = 95; pixels[offset + 1] = 210; pixels[offset + 2] = 80; pixels[offset + 3] = 255;
                }
            }
        }
    }
}
