using EliteScriptStudio.Packs.Nba2K27;

internal static class MeterForecastChecks
{
    internal static void Run()
    {
        CheckObservedSweeps();
        CheckEarlyPace();
        MeterLearningChecks.Run();
        MeterUpstrokeChecks.Run();
        int qualified = 0, conservative = 0;
        // Causal rolling windows across different smooth meter curves and horizons.
        foreach (double exponent in new[] { 1d, 1.2, 1.45, 1.7, 2d })
        foreach (int cadence in new[] { 16, 20, 33 })
        foreach (int end in new[] { 160, 200, 240, 280, 312 })
        {
            var history = Enumerable.Range(0, 8).Select(i => (Time: (double)(end - (7 - i) * cadence), Progress: 0d))
                .Where(p => p.Time >= 20).Select(p => (p.Time, Progress: .08 + .67 * Math.Pow(p.Time / 340, exponent))).ToArray();
            if (history.Length < 4) continue;
            var forecast = NbaMeterForecast.Predict(history, history.Length, .75, 160, curved: true);
            if (forecast is null) { conservative++; continue; }
            double error = Math.Abs(end + forecast.Tau - 340);
            if (!double.IsFinite(forecast.Uncertainty) || forecast.Uncertainty < 0) throw new Exception("Non-finite model uncertainty.");
            if (forecast.Uncertainty <= 12)
            {
                qualified++;
                if (error > Math.Max(12, forecast.Uncertainty))
                    throw new Exception($"Confident wrong-curve forecast: exponent={exponent}, cadence={cadence}, at={end}, error={error:F2}, uncertainty={forecast.Uncertainty:F2}, model={forecast.Model}.");
            }
            else conservative++;
        }
        if (qualified == 0 || conservative == 0) throw new Exception("Forecast fixtures did not exercise both qualification and abstention.");
        var linear = Enumerable.Range(0, 8).Select(i => (Time: 100d + i * 20, Progress: .1 + i * .04)).ToArray();
        var near = NbaMeterForecast.Predict(linear, 8, .5, 160, true)!;
        var far = NbaMeterForecast.Predict(linear, 8, .9, 160, true)!;
        if (Math.Abs(near.Tau - 60) > .1 || far.Uncertainty <= near.Uncertainty)
            throw new Exception("Long-horizon model disagreement did not raise uncertainty.");
        Console.WriteLine($"SUCCESS Competing meter curves/horizons: {qualified} qualified forecasts, {conservative} conservative forecasts; long-horizon uncertainty.");
    }

    private static void CheckEarlyPace()
    {
        const double target = .75;
        double[] levels = NbaMeterSweep.StandardLevels.ToArray();
        var reference = NbaMeterSweep.FromLegacy(levels.Select(p => (p - .2) * 250).ToArray());
        var matcher = new NbaMeterSweepTiming(target);
        foreach (double scale in new[] { .94, 1.0, 1.06 })
        {
            matcher.Restore([reference, reference with { Times = reference.Times.Select(t => t * 1.004).ToArray() }]);
            double? first = null;
            // A distinct shot with known target crossing. The matcher only sees the current prefix.
            for (int ms = 0; ms <= 128; ms += 16)
            {
                double fill = target * (.24 + ms / (250 * scale));
                var meter = new NbaMeterDetector.Measurement(new(.4,.4,.04,.12), fill, .95, 320, 800, 600) { MeasuredFill = true };
                var estimate = matcher.Observe(meter, false, ms, true);
                if (estimate is null) continue;
                first ??= ms;
                double error = Math.Abs(ms + estimate.Tau - .76 * 250 * scale);
                if (error > estimate.Uncertainty + .01) throw new Exception($"Uncovered pace error {error:F1} ms.");
            }
            if (first is not (48 or 64)) throw new Exception($"Expected a precise match before 75 ms at scale {scale}, got {first} ms.");
        }
        // Both references fit the prefix exactly but have different final segments.
        var later = reference.Times.ToArray();
        later[^1] += 35;
        matcher.Restore([reference, reference with { Times = later }]);
        for (int ms = 0; ms <= 64; ms += 16)
        {
            var meter = new NbaMeterDetector.Measurement(new(.4,.4,.04,.12), target * (.24 + ms / 250d), .95, 320, 800, 600)
                { MeasuredFill = true };
            if (matcher.Observe(meter, false, ms, true) is not null) throw new Exception("Divergent target times qualified early.");
        }
    }

    private static void CheckObservedSweeps()
    {
        var history = new NbaMeterSweepTiming(.75);
        bool RunHold(double velocity, bool ambiguous = false)
        {
            history.BeginHold();
            bool scheduled = false;
            for (int ms = 0; ms <= 520; ms += 15)
            {
                double fill = Math.Min(1, .08 + velocity * ms);
                var meter = new NbaMeterDetector.Measurement(new(.4,.4,.04,.12), fill, .96, 128, 800, 600)
                    { MeasuredFill = true };
                var estimate = history.Observe(meter, ambiguous && ms == 60, ms, trackingAcquired: ms > 0);
                if (estimate is { Tau: > 120, Uncertainty: <= 12 })
                {
                    if (Math.Abs(ms + estimate.Tau - (.75 - .08) / velocity) > 12)
                        throw new Exception("A prior sweep predicted the wrong target.");
                    scheduled = true;
                }
            }
            return scheduled;
        }
        if (RunHold(.002) || RunHold(.002) || !RunHold(.002))
            throw new Exception("Two completed full sweeps are required to forecast a matching third shot.");
        if (RunHold(.001) || RunHold(.002, ambiguous: true))
            throw new Exception("An incompatible pace or ambiguous meter reused a previous shot.");
        history.Reset();
        if (history.CompletedSweeps != 0 || RunHold(.002))
            throw new Exception("A new source inherited previous meter timing.");
    }
}
