using System.Diagnostics;
using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

/// <summary>Causal meter progression; the protruding, input-driven tempo tick is never the clock.</summary>
internal sealed class NbaMeterPredictor(Nba2K27ShotProfile profile, NbaMeterSettings configuration, VisionSettings settings,
    INbaMeterDetector? detector = null) : IVisionLivePredictor
{
    private readonly INbaMeterDetector _detector = detector ?? new NbaMeterDetector(configuration);
    private readonly (double Time, double Progress)[] _history = new (double, double)[8];
    private int _count, _width, _height;
    private long _holdStart, _hostHoldStart, _lastCapture, _lastDetection, _hostShotToken, _generation = -1;
    private double _bestUncertainty = double.PositiveInfinity, _bestConfidence;
    private string? _attemptFailure;
    private const double IdentityGraceMs = 70;
    private const double CurveLogBias = 0.70;
    private const double MinimumVelocityWindowMs = 58;
    private static readonly double CurveLogDenominator = Math.Log(1d + 1d / CurveLogBias);
    private bool _held, _forecasted;
    private bool _acquired;
    private bool _curvedMeter;
    private bool _sawPreShotClear;
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
        if (!freshInput) return Fail("Physical input timing is stale or unavailable. Return to neutral.");
        bool usingPaddle = configuration.InputMode == "rhythm" && Action.TriggerPaddle != PaddleButtons.None;
        bool held = freshInput && context.Physical is { } input && (configuration.InputMode == "rhythm"
            ? (usingPaddle
                ? (context.HeldPaddles & Action.TriggerPaddle) == Action.TriggerPaddle
                : input.RightY <= -Action.AxisThreshold && Math.Abs((int)input.RightX) < Action.AxisThreshold)
            : (input.Buttons & (ushort)settings.ShootButton) != 0);
        if (!held)
        {
            bool invalid = _forecasted; ClearAttempt(); _held = false; _holdStart = _hostHoldStart = 0;
            return Observation(usingPaddle ? "Waiting for your paddle hold." : "Waiting for your shoot hold.", invalidate: invalid);
        }
        long physicalStart = context.HoldStartedTimestamp > 0 && context.HoldStartedTimestamp <= context.InputTimestamp
            ? context.HoldStartedTimestamp : 0;
        // A release/repress between video frames is still a new physical attempt.
        if (!_held || (physicalStart > 0 && _hostHoldStart > 0 && physicalStart != _hostHoldStart))
        { ClearAttempt(); _holdStart = physicalStart > 0 ? physicalStart : captureTicks; _hostHoldStart = physicalStart; _held = true; }
        else if (physicalStart > 0 && _hostHoldStart == 0) _holdStart = _hostHoldStart = physicalStart;
        if (context.Armed && physicalStart == 0)
            return Fail("Physical hold timing is unavailable. Return to neutral before the next attempt.");
        if (_attemptFailure is { } failure) return Observation(failure, invalidate: true);
        if (_hostShotToken > 0 && context.ShotToken == 0)
        {
            _lastCapture = captureTicks;
            return Observation("Controller action ended. Check controller status and return to neutral.");
        }
        if (context.ShotToken > 0) _hostShotToken = context.ShotToken;
        if (_lastCapture > 0 && (captureTicks <= _lastCapture || (captureTicks - _lastCapture) * 1000d / Stopwatch.Frequency > 70))
            return Fail("Frame cadence broke. Return to neutral before the next attempt.");
        _lastCapture = captureTicks;
        double heldMs = Math.Max(0, (captureTicks - _holdStart) * 1000d / Stopwatch.Frequency);
        if (captureTicks < _holdStart || heldMs < configuration.HoldMs) return Observation("Qualifying the physical hold.");
        if (heldMs > settings.MaximumShotDurationMs) return Fail("Shot expired. Return the stick or button to neutral before the next shot.");
        if (!_acquired && heldMs > configuration.AcquisitionWindowMs + settings.EstimatedVideoDelayMs)
            return Fail("No new meter appeared inside the input acquisition window. Return to neutral.");
        bool anchored = context.StrokeAnchorTimestamp > 0 && captureTicks >= context.StrokeAnchorTimestamp;
        var measured = _detector.Detect(bgra, width, height, stride);
        if (_detector.Ambiguous)
            return _acquired || _forecasted ? Fail("Multiple meters made tracking ambiguous. Return to neutral.")
                : Observation("Searching for one unambiguous meter.");
        if (measured is not { } meter)
        {
            if (_forecasted && anchored && _last?.Progress >= .5)
                return ContinueStroke("Meter is no longer visible after the timing anchor; finishing the committed stroke.");
            if (_forecasted) return Fail("Meter tracking was lost before the timing anchor. Return to neutral.");
            _count = 0;
            if (!_acquired) _sawPreShotClear = true;
            if (_last is { } missedLast && (captureTicks - _lastDetection) * 1000d / Stopwatch.Frequency > IdentityGraceMs)
            {
                if (!CanRecoverWeakCandidate(missedLast))
                    return Fail("Meter identity expired while detection was missing. Return to neutral.");
                ClearWeakCandidate();
            }
            return Observation(_last is null ? "Searching the gameplay viewport for one unambiguous meter."
                : "Meter temporarily missing; retaining identity without a timing forecast.");
        }
        if (_last is { } staleLast && (captureTicks - _lastDetection) * 1000d / Stopwatch.Frequency > IdentityGraceMs)
        {
            if (!CanRecoverWeakCandidate(staleLast))
                return Fail("Meter identity expired before reacquisition. Return to neutral.", meter);
            ClearWeakCandidate();
        }
        if (!_acquired && (meter.Progress >= .70 || (meter.Progress > .5 && (!_sawPreShotClear || heldMs < 250))))
            return Observation("Waiting for a newly appearing meter, rather than a prior shot's result.");
        if (_last is null && meter.Progress <= .03)
        {
            _sawPreShotClear = true;
            return Observation("Meter outline seen; waiting for the interior fill to advance.", meter);
        }
        if (_last is { } previous)
        {
            bool posJump = Math.Abs(meter.TargetX - previous.TargetX) > width * .12 || Math.Abs(meter.TargetY - previous.TargetY) > height * .15;
            double scale = meter.Height / previous.Height;
            bool badScale = scale is < .7 or > 1.4;
            bool backward = meter.Progress < previous.Progress - .12;
            if (posJump || badScale || backward)
            {
                if (CanRecoverWeakCandidate(previous) && (meter.Score >= .80 || backward))
                {
                    ClearWeakCandidate();
                    if (backward && meter.Score < .80)
                        return Observation("Searching the gameplay viewport for one unambiguous meter.");
                    if (meter.Progress >= .70 || (meter.Progress > .5 && (!_sawPreShotClear || heldMs < 250)))
                        return Observation("Waiting for a newly appearing meter, rather than a prior shot's result.");
                }
                else if (posJump)
                    return Fail("Meter position jumped outside the tracked region. Return to neutral.", meter);
                else if (badScale)
                    return Fail($"Meter scale changed to {scale:F2} times its previous height. Return to neutral.", meter);
                else
                    return Fail($"Meter fill moved backward by {(previous.Progress - meter.Progress) * 100:F1} percentage points. Return to neutral.", meter);
            }
        }
        _acquired = true;
        if (Math.Abs(meter.Bow) > 1e-6) _curvedMeter = true;
        _last = meter; _lastDetection = captureTicks;
        if (meter.Progress <= .03) return Observation("Meter acquired; waiting for the interior fill to advance.", meter);
        // Saturation can finish an actually anchored stroke, but is never a new timing estimate.
        if (_forecasted && anchored && meter.Progress >= .5)
            return ContinueStroke("Meter fill saturated after the timing anchor; finishing the committed stroke.", meter);
        if (_count == _history.Length) { Array.Copy(_history, 1, _history, 0, _history.Length - 1); _count--; }
        _history[_count++] = (captureTicks * 1000d / Stopwatch.Frequency, meter.Progress);
        double span = _history[_count - 1].Time - _history[0].Time;
        if (_count < 4 || span < MinimumVelocityWindowMs) return Observation("Measuring the meter's fill velocity.", meter);
        double sw = 0, mt = 0, mu = 0;
        for (int i = 0; i < _count; i++)
        {
            double w = Math.Pow(.85, _count - 1 - i);
            sw += w; mt += w * _history[i].Time; mu += w * Linearize(_history[i].Progress);
        }
        mt /= sw; mu /= sw;
        double xx = 0, xy = 0;
        for (int i = 0; i < _count; i++)
        {
            double w = Math.Pow(.85, _count - 1 - i), dt = _history[i].Time - mt;
            xx += w * dt * dt; xy += w * dt * (Linearize(_history[i].Progress) - mu);
        }
        double velocity = xx > 0 ? xy / xx : 0;
        if (velocity <= .00015 || velocity > .03)
        {
            if (_forecasted) return Fail("Fill velocity became unreliable before a validated completion. Return to neutral.", meter, velocity);
            if (meter.Progress >= .88 && double.IsFinite(_bestUncertainty)) return UnforecastedCompletion(meter, velocity);
            return Observation("Fill velocity is not yet reliable.", meter, velocity, invalidate: _forecasted);
        }
        double residual = 0;
        for (int i = 0; i < _count; i++)
        {
            double w = Math.Pow(.85, _count - 1 - i), error = Linearize(_history[i].Progress) - (mu + velocity * (_history[i].Time - mt));
            residual += w * error * error;
        }
        double sigma = Math.Sqrt(residual / Math.Max(.5, sw * Math.Max(1, _count - 2) / _count));
        double fittedLinear = mu + velocity * (_history[_count - 1].Time - mt);
        double tau = (Linearize(configuration.TargetProgress) - fittedLinear) / velocity;
        double extrap = Math.Min(Math.Max(0, tau), Math.Max(1, span * 2.0));
        double localSlope = LinearDerivative(_history[_count - 1].Progress);
        // Recency-weighted regression on the linearized curve tracks acceleration cleanly across shot speeds.
        double uncertainty = Math.Sqrt(sigma * sigma * (1 + 1d / sw + extrap * extrap / xx)
            + (localSlope * localSlope) / (meter.Height * meter.Height)) / velocity;
        double confidence = Math.Clamp(meter.Score >= .55 && meter.Score < .7 ? Math.Min(.7, meter.Score + .12) : meter.Score, 0, 1);
        if (tau < 0)
        {
            if (_forecasted) return Fail("The forecast target passed without a validated completion. Return to neutral.", meter, velocity);
            if (double.IsFinite(_bestUncertainty)) return UnforecastedCompletion(meter, velocity);
            return Observation("The observed target has passed. Return to neutral.", meter, velocity, confidence, uncertainty, invalidate: _forecasted);
        }
        double effectiveMaxUncertainty = tau > 175 ? Math.Min(settings.MaximumUncertaintyMs, 8.5) : settings.MaximumUncertaintyMs;
        if (tau <= 400 && double.IsFinite(uncertainty))
        {
            _bestUncertainty = Math.Min(_bestUncertainty, uncertainty);
            _bestConfidence = Math.Max(_bestConfidence, confidence);
        }
        if (tau > 400 || !double.IsFinite(uncertainty) || uncertainty > effectiveMaxUncertainty || confidence < settings.MinimumConfidence)
        {
            if (!_forecasted && meter.Progress >= .88 && double.IsFinite(_bestUncertainty))
                return UnforecastedCompletion(meter, velocity);
            // Withhold updates during fit noise. The host requires a recent valid forecast
            // at stroke start; noisy frames do not refresh that deadline's freshness.
            return Observation("Waiting for a stable forecast inside the configured uncertainty limit.", meter, velocity, confidence, uncertainty);
        }
        _forecasted = true;
        return Observation("Meter fill forecast ready.", meter, velocity, confidence, uncertainty, tau);

        VisionSignalObservation ContinueStroke(string message, NbaMeterDetector.Measurement? current = null)
            => Observation(message, current, uncertainty: 1000) with { ContinueCommittedAction = true };

        VisionSignalObservation Fail(string message, NbaMeterDetector.Measurement? current = null, double velocity = 0)
        {
            _attemptFailure = message; _forecasted = false; _count = 0;
            return Observation(message, current, velocity, invalidate: true);
        }

        VisionSignalObservation UnforecastedCompletion(NbaMeterDetector.Measurement current, double currentVelocity)
            => Observation($"Meter reached its cap without a usable forecast. Best observed uncertainty: {_bestUncertainty:F1} ms; highest geometry score: {_bestConfidence:F2}.",
                current, currentVelocity, _bestConfidence, _bestUncertainty);

        VisionSignalObservation Observation(string message, NbaMeterDetector.Measurement? found = null, double velocity = 0,
            double? confidence = null, double uncertainty = 0, double? tau = null, bool invalidate = false)
            => new(sequence, captureTicks, found.HasValue, found?.Bounds, found?.Progress ?? 0, configuration.TargetProgress,
                velocity, tau, confidence ?? found?.Score ?? 0, double.IsFinite(uncertainty) ? uncertainty : 1000, message, _count,
                Stopwatch.GetElapsedTime(began).TotalMilliseconds, width, height, invalidate);
    }
    private double Linearize(double progress)
        => _curvedMeter ? Math.Log(1d + Math.Max(0, progress) / CurveLogBias) / CurveLogDenominator : progress;
    private double LinearDerivative(double progress)
        => _curvedMeter ? 1d / ((CurveLogBias + Math.Max(0, progress)) * CurveLogDenominator) : 1d;
    private bool CanRecoverWeakCandidate(NbaMeterDetector.Measurement candidate)
        => !_forecasted && _count <= 2 && candidate.Score < .78;
    private void ClearWeakCandidate()
    {
        _count = 0; _acquired = false; _curvedMeter = false; _last = null; _lastDetection = 0;
        _bestConfidence = 0; _bestUncertainty = double.PositiveInfinity;
        _detector.Reset();
    }
    private void ClearAttempt()
    {
        _count = 0; _forecasted = _acquired = _curvedMeter = _sawPreShotClear = false; _last = null; _lastCapture = _lastDetection = 0;
        _attemptFailure = null; _bestConfidence = 0; _hostShotToken = 0;
        _bestUncertainty = double.PositiveInfinity;
        _detector.Reset();
    }
    public void Reset() { ClearAttempt(); _held = false; _holdStart = _hostHoldStart = 0; (_detector as NbaMeterDetector)?.ResetSession(); }
    public void Dispose() => Reset();
}
