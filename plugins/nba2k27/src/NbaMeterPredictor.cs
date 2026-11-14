using System.Diagnostics;
using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

/// <summary>Causal meter progression; the protruding, input-driven tempo tick is never the clock.</summary>
internal sealed class NbaMeterPredictor(Nba2K27ShotProfile profile, NbaMeterSettings configuration, VisionSettings settings) : IVisionLivePredictor
{
    private readonly NbaMeterDetector _detector = new(configuration);
    private readonly (double Time, double Progress)[] _history = new (double, double)[8];
    private int _count, _width, _height;
    private long _holdStart, _lastCapture, _generation = -1;
    private bool _held, _forecasted;
    private bool _acquired;
    private readonly bool _acceptedCalibration = configuration.Accepted(profile, settings);
    private NbaMeterDetector.Measurement? _last;
    public string Name => "CPU meter geometry";
    public VisionControllerAction Action { get; } = configuration.Action(profile, settings);
    public bool CanArm => profile.UsesShotMeter && _width > 0 && (configuration.CalibrationTrial ||
        (_acceptedCalibration && _width == configuration.CalibratedWidth && _height == configuration.CalibratedHeight));
    public string Status => configuration.CalibrationTrial ? "Meter calibration trial. Assistance starts only when explicitly armed."
        : CanArm ? "Saved meter calibration matches this profile, timing and capture size."
        : "Observe the meter, then calibrate timing and rhythm tempo before enabling assistance.";

    public VisionSignalObservation Observe(ReadOnlySpan<byte> bgra, int width, int height, int stride,
        long sequence, long generation, long captureTicks, VisionSignalContext context)
    {
        long began = Stopwatch.GetTimestamp();
        if (width <= 0 || height <= 0 || stride < width * 4 || bgra.Length < checked(stride * height))
            throw new InvalidDataException("The meter predictor needs a complete BGRA frame.");
        if (_generation != generation || _width != width || _height != height)
        { Reset(); _generation = generation; _width = width; _height = height; }
        bool freshInput = context.InputTimestamp > 0 && captureTicks - context.InputTimestamp < Stopwatch.Frequency / 10
            && context.InputTimestamp - captureTicks < Stopwatch.Frequency / 10;
        bool held = freshInput && context.Physical is { } input && (configuration.InputMode == "rhythm"
            ? input.RightY <= -Action.AxisThreshold && Math.Abs((int)input.RightX) < Action.AxisThreshold
            : (input.Buttons & (ushort)settings.ShootButton) != 0);
        if (!held)
        {
            bool invalid = _forecasted; ClearAttempt(); _held = false; _holdStart = 0;
            return Observation("Waiting for your shoot hold.", invalidate: invalid);
        }
        if (!_held) { ClearAttempt(); _holdStart = captureTicks; _held = true; }
        double heldMs = (captureTicks - _holdStart) * 1000d / Stopwatch.Frequency;
        if (heldMs < configuration.HoldMs) return Observation("Qualifying the physical hold.");
        if (heldMs > settings.MaximumShotDurationMs) return Observation("Return the stick or button to neutral before the next shot.", invalidate: true);
        if (!_acquired && heldMs > configuration.AcquisitionWindowMs + settings.EstimatedVideoDelayMs)
            return Observation("No new meter appeared inside the input acquisition window. Return to neutral.", invalidate: true);
        if (_lastCapture > 0 && (captureTicks <= _lastCapture || (captureTicks - _lastCapture) * 1000d / Stopwatch.Frequency > 70))
        { bool invalid = _forecasted; ClearAttempt(); return Observation("Frame cadence broke; waiting for a new progression.", invalidate: invalid); }
        _lastCapture = captureTicks;
        var measured = _detector.Detect(bgra, width, height, stride);
        if (measured is not { } meter)
        { bool invalid = _forecasted; _count = 0; _last = null; return Observation("Searching the gameplay viewport for one unambiguous meter.", invalidate: invalid); }
        if (!_acquired && meter.Progress > .5) return Observation("Waiting for a newly appearing meter, rather than a prior shot's result.");
        _acquired = true;
        if (_last is { } previous && (Math.Abs(meter.TargetX - previous.TargetX) > width * .12
            || Math.Abs(meter.TargetY - previous.TargetY) > height * .15 || meter.Height / previous.Height is < .7 or > 1.4
            || meter.Progress < previous.Progress - .12))
        { bool invalid = _forecasted; _count = 0; _last = meter; return Observation("Meter changed identity or progression; cancelling this prediction.", meter, invalidate: invalid); }
        _last = meter;
        if (meter.Progress <= .03) return Observation("Meter acquired; waiting for the interior fill to advance.", meter);
        if (_count == _history.Length) { Array.Copy(_history, 1, _history, 0, _history.Length - 1); _count--; }
        _history[_count++] = (captureTicks * 1000d / Stopwatch.Frequency, meter.Progress);
        if (_count < 4) return Observation("Measuring the meter's fill velocity.", meter);
        double mt = 0, mp = 0;
        for (int i = 0; i < _count; i++) { mt += _history[i].Time; mp += _history[i].Progress; }
        mt /= _count; mp /= _count;
        double xx = 0, xy = 0;
        for (int i = 0; i < _count; i++) { double dt = _history[i].Time - mt; xx += dt * dt; xy += dt * (_history[i].Progress - mp); }
        double velocity = xx > 0 ? xy / xx : 0;
        if (velocity <= .00015 || velocity > .03) return Observation("Fill velocity is not yet reliable.", meter, invalidate: _forecasted);
        double residual = 0;
        for (int i = 0; i < _count; i++) { double error = _history[i].Progress - (mp + velocity * (_history[i].Time - mt)); residual += error * error; }
        double sigma = Math.Sqrt(residual / Math.Max(1, _count - 2));
        double fittedProgress = mp + velocity * (_history[_count-1].Time - mt);
        double tau = (configuration.TargetProgress - fittedProgress) / velocity;
        double horizon = Math.Max(0, tau + _history[_count-1].Time - mt);
        // Regression prediction error grows with the forecast horizon; a one-pixel fill edge is the measurement floor.
        double uncertainty = Math.Sqrt(sigma * sigma * (1 + 1d / _count + horizon * horizon / xx)
            + 1d / (meter.Height * meter.Height)) / velocity;
        double confidence = Math.Clamp(meter.Score, 0, 1);
        if (tau < 0) return Observation("The observed target has passed. Return to neutral.", meter, velocity, confidence, uncertainty, invalidate: _forecasted);
        if (tau > 400 || !double.IsFinite(uncertainty) || uncertainty > settings.MaximumUncertaintyMs || confidence < settings.MinimumConfidence)
            // Withhold updates during fit noise. The host requires a recent valid forecast
            // at stroke start; noisy frames do not refresh that deadline's freshness.
            return Observation("Waiting for a stable forecast inside the configured uncertainty limit.", meter, velocity, confidence, uncertainty);
        _forecasted = true;
        return Observation("Meter fill forecast ready.", meter, velocity, confidence, uncertainty, tau);

        VisionSignalObservation Observation(string message, NbaMeterDetector.Measurement? found = null, double velocity = 0,
            double? confidence = null, double uncertainty = 0, double? tau = null, bool invalidate = false)
            => new(sequence, captureTicks, found.HasValue, found?.Bounds, found?.Progress ?? 0, configuration.TargetProgress,
                velocity, tau, confidence ?? found?.Score ?? 0, double.IsFinite(uncertainty) ? uncertainty : 1000, message, _count,
                Stopwatch.GetElapsedTime(began).TotalMilliseconds, width, height, invalidate);
    }
    private void ClearAttempt() { _count = 0; _forecasted = _acquired = false; _last = null; _lastCapture = 0; _detector.Reset(); }
    public void Reset() { ClearAttempt(); _held = false; _holdStart = 0; }
    public void Dispose() => Reset();
}
