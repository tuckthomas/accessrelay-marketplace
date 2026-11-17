namespace EliteScriptStudio.Packs.Nba2K27;

/// <summary>Causal competing progression models. A quiet fit to the wrong curve is not timing certainty.</summary>
internal static class NbaMeterForecast
{
    internal sealed record Estimate(double Tau, double Velocity, double Uncertainty, double ModelSpread, string Model);
    private sealed record Fit(int Kind, double A, double B, double C, double Span, double LastTime, double Error);
    private static double Transform(double p, int kind) => kind switch
    {
        1 => Math.Log(1 + Math.Max(0, p) / .35),
        2 => Math.Log(1 + Math.Max(0, p) / .7),
        3 => Math.Log(1 + Math.Max(0, p) / 1.4),
        _ => p
    };
    internal static Estimate? Predict((double Time, double Progress)[] history, int count, double target, double height, bool curved)
    {
        if (count < 4 || count > history.Length || !double.IsFinite(target) || !double.IsFinite(height) || height <= 0) return null;
        for (int i = 0; i < count; i++)
            if (!double.IsFinite(history[i].Time) || !double.IsFinite(history[i].Progress)
                || i > 0 && history[i].Time <= history[i - 1].Time) return null;
        var candidates = new List<(Fit Fit, double Tau, double Velocity, double Validation)>();
        foreach (int kind in curved ? new[] { 0, 1, 2, 3, 4 } : new[] { 0 })
        {
            if (kind == 4 && count < 6) continue;
            var fit = Regress(history, count, kind);
            if (fit is null || TargetTime(fit, target) is not { } tau || tau is < -100 or > 800) continue;
            double derivative = kind is >= 1 and <= 3 ? 1 / ((kind == 1 ? .35 : kind == 2 ? .7 : 1.4) + history[count - 1].Progress) : 1;
            double velocity = fit.B / fit.Span / derivative;
            if (velocity is <= .00015 or > .03) continue;
            // Validate against withheld, already observed frames, never future frames.
            int trainingCount = count - 2;
            var prior = trainingCount >= (kind == 4 ? 4 : 2) ? Regress(history, trainingCount, kind) : null;
            double validation = 0;
            if (prior is not null)
                for (int i = trainingCount; i < count; i++)
                {
                    double x = (history[i].Time - prior.LastTime) / prior.Span;
                    double error = Math.Abs(Transform(history[i].Progress, kind) - (prior.A + prior.B * x + prior.C * x * x));
                    validation = Math.Max(validation, error / (velocity * derivative));
                }
            candidates.Add((fit, tau, velocity, validation));
        }
        if (candidates.Count == 0) return null;
        var best = candidates.OrderBy(c => c.Validation + (c.Fit.Kind == 4 ? .25 : 0)).First();
        double pixelTime = 2 / (Math.Max(1, height) * best.Velocity);
        // Keep models indistinguishable at the image's timing resolution. Their disagreement
        // is systematic error that regression residuals alone do not capture.
        var plausible = candidates.Where(c => c.Validation <= best.Validation + Math.Max(.35, pixelTime)).ToArray();
        double spread = plausible.Max(c => Math.Abs(c.Tau - best.Tau));
        double derivativeAtNow = best.Fit.Kind is >= 1 and <= 3
            ? 1 / ((best.Fit.Kind == 1 ? .35 : best.Fit.Kind == 2 ? .7 : 1.4) + history[count - 1].Progress) : 1;
        double fitErrorMs = best.Fit.Error / (best.Velocity * derivativeAtNow);
        double horizon = Math.Max(0, best.Tau) / best.Fit.Span;
        // Extrapolation amplifies image/fit error, especially when projecting curvature.
        // Held-out error was observed over two frame intervals, not a whole fit span.
        double projection = Math.Sqrt(1 + horizon * horizon + (best.Fit.Kind == 4 ? Math.Pow(horizon, 4) : 0));
        double validationHorizon = history[count - 1].Time - history[count - 3].Time;
        double uncertainty = Math.Sqrt(pixelTime * pixelTime + fitErrorMs * fitErrorMs) * projection
            + best.Validation * Math.Max(1, Math.Max(0, best.Tau) / validationHorizon) + spread;
        string name = best.Fit.Kind == 4 ? "quadratic" : best.Fit.Kind == 0 ? "linear" : $"log-{best.Fit.Kind}";
        return new(best.Tau, best.Velocity, uncertainty, spread, name);
    }
    private static double? TargetTime(Fit f, double target)
    {
        double delta = Transform(target, f.Kind) - f.A;
        if (delta < 0) return delta / f.B * f.Span;
        if (Math.Abs(f.C) < 1e-8) return f.B > 0 ? delta / f.B * f.Span : null;
        double discriminant = f.B * f.B + 4 * f.C * delta;
        if (discriminant < 0) return null;
        double x = 2 * delta / (f.B + Math.Sqrt(discriminant));
        return double.IsFinite(x) && x >= 0 && f.B + 2 * f.C * x > 0 ? x * f.Span : null;
    }
    private static Fit? Regress((double Time, double Progress)[] values, int count, int kind)
    {
        double span = values[count - 1].Time - values[0].Time;
        if (span <= 0) return null;
        int size = kind == 4 ? 3 : 2;
        double[,] m = new double[3, 4]; double sw = 0;
        for (int i = 0; i < count; i++)
        {
            double x = (values[i].Time - values[count - 1].Time) / span, y = Transform(values[i].Progress, kind), w = Math.Pow(.85, count - 1 - i);
            sw += w;
            for (int row = 0; row < size; row++)
            {
                for (int col = 0; col < size; col++) m[row, col] += w * Math.Pow(x, row + col);
                m[row, size] += w * Math.Pow(x, row) * y;
            }
        }
        for (int pivot = 0; pivot < size; pivot++)
        {
            int best = pivot;
            for (int row = pivot + 1; row < size; row++) if (Math.Abs(m[row, pivot]) > Math.Abs(m[best, pivot])) best = row;
            for (int col = pivot; col <= size; col++) (m[pivot, col], m[best, col]) = (m[best, col], m[pivot, col]);
            double d = m[pivot, pivot]; if (Math.Abs(d) < 1e-10) return null;
            for (int col = pivot; col <= size; col++) m[pivot, col] /= d;
            for (int row = 0; row < size; row++) if (row != pivot)
            {
                double factor = m[row, pivot];
                for (int col = pivot; col <= size; col++) m[row, col] -= factor * m[pivot, col];
            }
        }
        double a = m[0, size], b = m[1, size], c = size == 3 ? m[2, size] : 0, errorSum = 0;
        if (b <= 0 || b - 2 * c <= 0) return null;
        for (int i = 0; i < count; i++)
        {
            double x = (values[i].Time - values[count - 1].Time) / span;
            double e = Transform(values[i].Progress, kind) - (a + b * x + c * x * x);
            errorSum += Math.Pow(.85, count - 1 - i) * e * e;
        }
        return new(kind, a, b, c, span, values[count - 1].Time, Math.Sqrt(errorSum / Math.Max(1, sw - size)));
    }
}
