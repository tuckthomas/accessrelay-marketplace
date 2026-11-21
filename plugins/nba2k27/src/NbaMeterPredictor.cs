using System.Diagnostics;
using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

/// <summary>Causal meter progression; the protruding, input-driven tempo tick is never the clock.</summary>
internal sealed class NbaMeterPredictor(Nba2K27ShotProfile profile, NbaMeterSettings configuration, VisionSettings settings,
    INbaMeterDetector? detector = null) : IVisionLivePredictor
{
    private readonly INbaMeterDetector _detector = detector ?? new NbaMeterDetector(configuration);
    private readonly NbaMeterSweepTiming _sweepTiming = new(configuration.TargetProgress);
    private readonly NbaMeterTimingStore? _timingStore = profile.MeterTimingDirectory is { } directory
        ? new(directory, profile.Id, configuration.TuningContextKey(profile, settings)) : null;
    private readonly (double Time, double Progress)[] _history = new (double, double)[8];
    private int _count, _width, _height;
    private long _holdStart, _hostHoldStart, _lastCapture, _lastDetection, _hostShotToken, _generation = -1;
    private double _bestUncertainty = double.PositiveInfinity, _bestConfidence;
    private string? _attemptFailure, _timingLimit;
    private const double RailOnlyGraceMs = 40;
    private const double IdentityGraceMs = 70;
    private const double MinimumVelocityWindowMs = 58;
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
        {
            Reset();
            _generation = generation;
            _width = width;
            _height = height;
            if (_timingStore is not null) _sweepTiming.Restore(_timingStore.Load(width, height));
        }
        bool freshInput = context.InputTimestamp > 0 && captureTicks - context.InputTimestamp < Stopwatch.Frequency / 10
            && context.InputTimestamp - captureTicks < Stopwatch.Frequency / 10;
        if (!freshInput) return Fail("Physical input timing is stale or unavailable. Return to neutral.");
        bool assigned = Action.HasAssignedTrigger;
        bool tap = context.Armed && Action.ContinueAfterTriggerRelease;
        // Finish measuring the same sweep if its target arrives after the host completed a tap.
        if (tap && context.Physical.HasValue && context.ShotToken == 0 && _hostShotToken > 0 &&
            _forecasted && _acquired && !_sweepTiming.Finished && captureTicks > _lastCapture &&
            (captureTicks - _lastCapture) * 1000d / Stopwatch.Frequency <= settings.EstimatedVideoDelayMs + IdentityGraceMs)
        {
            var tail = _detector.Detect(bgra, width, height, stride);
            _sweepTiming.Observe(tail, _detector.Ambiguous, captureTicks * 1000d / Stopwatch.Frequency, true);
            return Observation("Controller action ended. Finishing the meter measurement.");
        }
        bool held = context.Physical is { } input && (tap ? context.ShotToken > 0 :
            configuration.InputMode == "rhythm" ? Action.IsTriggerHeld(input, context.HeldPaddles)
                : (input.Buttons & (ushort)settings.ShootButton) != 0);
        if (!held)
        {
            bool invalid = _forecasted; ClearAttempt(); _held = false; _holdStart = _hostHoldStart = 0;
            return Observation(assigned ? "Waiting for your assigned shot control." : "Waiting for your shoot hold.", invalidate: invalid);
        }
        long transition = tap ? context.ShotStartedTimestamp : context.HoldStartedTimestamp;
        long physicalStart = transition > 0 && transition <= context.InputTimestamp ? transition : 0;
        // A release/repress between video frames is still a new physical attempt.
        if (!_held || (physicalStart > 0 && _hostHoldStart > 0 && physicalStart != _hostHoldStart))
        { ClearAttempt(); _holdStart = physicalStart > 0 ? physicalStart : captureTicks; _hostHoldStart = physicalStart; _held = true; }
        else if (physicalStart > 0 && _hostHoldStart == 0) _holdStart = _hostHoldStart = physicalStart;
        if (context.Armed && physicalStart == 0)
            return Fail("Shot trigger timing is unavailable. Release the trigger before the next attempt.");
        bool actionEnded = _hostShotToken > 0 && context.ShotToken == 0;
        if (context.ShotToken > 0) _hostShotToken = context.ShotToken;
        if (_lastCapture > 0 && (captureTicks <= _lastCapture || (captureTicks - _lastCapture) * 1000d / Stopwatch.Frequency > 70))
            return Fail("Frame cadence broke. Return to neutral before the next attempt.");
        _lastCapture = captureTicks;
        double heldMs = Math.Max(0, (captureTicks - _holdStart) * 1000d / Stopwatch.Frequency);
        if (captureTicks < _holdStart || heldMs < Action.HoldQualificationMs)
            return Observation(tap ? "Waiting for a frame captured after the shot started." : "Qualifying the shot trigger hold.");
        if (heldMs > settings.MaximumShotDurationMs) return Fail("Shot expired. Release the shot trigger before the next shot.");
        bool anchored = context.StrokeAnchorTimestamp > 0 && captureTicks >= context.StrokeAnchorTimestamp;
        var measured = _detector.Detect(bgra, width, height, stride);
        if (_attemptFailure is { } failure) return Observation(failure, invalidate: true);
        double sampleMs = captureTicks * 1000d / Stopwatch.Frequency;
        if (actionEnded)
        {
            // A valid, already-identified sweep can finish teaching after local output ends.
            if (_acquired) _sweepTiming.Observe(measured, _detector.Ambiguous, sampleMs, true);
            return Observation("Controller action ended. Check controller status and return to neutral.");
        }
        if (!_acquired && heldMs > configuration.AcquisitionWindowMs + settings.EstimatedVideoDelayMs)
            return Fail("No new meter appeared inside the input acquisition window. Return to neutral.");
        if (_detector.Ambiguous)
        {
            _sweepTiming.Observe(null, true, sampleMs, _acquired || _forecasted);
            return _acquired || _forecasted ? Fail("Multiple meters made tracking ambiguous. Return to neutral.")
                : Observation("Searching for one unambiguous meter.");
        }
        if (_last is { MeasuredFill:true } && measured is { MeasuredFill:false }) measured=null;
        if (measured is not { } meter)
        {
            if (_forecasted && anchored && _last?.Progress >= .5)
                return ContinueStroke("Meter is no longer visible after the timing anchor; finishing the committed stroke.");
            if (_acquired && _last is { MeasuredFill: true } && _detector.HasRailIdentity &&
                (captureTicks - _lastDetection) * 1000d / Stopwatch.Frequency <= RailOnlyGraceMs)
                return Observation("Meter rails tracked; waiting for a measured fill edge.");
            if (_forecasted) return Fail("Meter tracking was lost before the timing anchor. Return to neutral.");
            if (_last is not { MeasuredFill:true }) _count = 0;
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
        bool PriorFill() => meter.Progress >= .70 || (meter.Progress > .5 && !_sawPreShotClear)
            || (heldMs < 250 && meter.Progress + 1 / Math.Max(1, meter.Height * .9) >= Math.Min(.5, configuration.TargetProgress / 2));
        if (!_acquired && PriorFill())
        {
            _detector.Reset();
            return Observation("Waiting for a new meter after the previous shot.");
        }
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
            // A resolved downward edge contradicts the rising sweep used to schedule this stroke.
            // Withdraw it while the paddle still owns down. Any replacement must qualify anew.
            if (_forecasted && context.StrokeAnchorTimestamp == 0 && previous.MeasuredFill && meter.MeasuredFill
                && !posJump && !badScale && !backward
                && previous.Progress - meter.Progress > Math.Max(.015, 2 / (meter.Height * .9)))
            {
                _forecasted = false; _count = 0;
                _sweepTiming.BeginHold(learn: false);
                _last = meter; _lastDetection = captureTicks;
                _timingLimit = "The measured fill reversed before stroke start. The pending forecast was withdrawn.";
                return Observation(_timingLimit, meter) with { WithdrawPendingForecast = true };
            }
            if (!previous.MeasuredFill && meter.MeasuredFill && !_forecasted && context.StrokeAnchorTimestamp == 0
                && !posJump && !badScale)
            {
                // The outline and the measured strip use different rail lengths. Keep tracking the
                // same meter, but fit its rise from the first directly measured edge.
                _sweepTiming.BeginHold(useOpeningCrossing: true);
                _count = 0;
                _curvedMeter = false;
                _bestConfidence = 0;
                _bestUncertainty = double.PositiveInfinity;
                _timingLimit = null;
            }
            else if (posJump || badScale || backward)
            {
                if (CanRecoverWeakCandidate(previous) && (meter.Score >= .80 || backward))
                {
                    ClearWeakCandidate();
                    if (backward && meter.Score < .80)
                        return Observation("Searching the gameplay viewport for one unambiguous meter.");
                    if (PriorFill())
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
        var sweep = _sweepTiming.Observe(meter, false, sampleMs, true, canRestartRise: !_forecasted && context.StrokeAnchorTimestamp == 0);
        if (Math.Abs(meter.Bow) > 1e-6) _curvedMeter = true;
        _last = meter; _lastDetection = captureTicks;
        if (meter.Progress <= .03) return Observation("Meter acquired; waiting for the interior fill to advance.", meter);
        // Saturation can finish an actually anchored stroke, but is never a new timing estimate.
        if (_forecasted && anchored && meter.Progress >= .5)
            return ContinueStroke("Meter fill saturated after the timing anchor; finishing the committed stroke.", meter);
        if (_count == _history.Length) { Array.Copy(_history, 1, _history, 0, _history.Length - 1); _count--; }
        _history[_count++] = (captureTicks * 1000d / Stopwatch.Frequency, meter.Progress);
        double span = _history[_count - 1].Time - _history[0].Time;
        bool canFitVelocity = _count >= 4 && span >= MinimumVelocityWindowMs;
        if (_count < 4 || (!canFitVelocity && sweep is null)) return Observation("Measuring the meter's fill velocity.", meter);
        var forecast = canFitVelocity ? NbaMeterForecast.Predict(_history, _count, configuration.TargetProgress, meter.Height, _curvedMeter) : null;
        if (sweep is { Tau: >=0 } && (forecast is null || sweep.Uncertainty < forecast.Uncertainty)) forecast=sweep;
        double velocity = forecast?.Velocity ?? 0;
        if (forecast is null)
        {
            if (_forecasted) return Fail("Fill velocity became unreliable before a validated completion. Return to neutral.", meter, velocity);
            if (meter.Progress >= .88 && double.IsFinite(_bestUncertainty)) return UnforecastedCompletion(meter, velocity);
            return Observation("Fill velocity is not yet reliable.", meter, velocity);
        }
        double tau = forecast.Tau, uncertainty = forecast.Uncertainty;
        double confidence = Math.Clamp(meter.Score, 0, 1);
        if (tau < 0)
        {
            if (_forecasted) return Fail("The forecast target passed without a validated completion. Return to neutral.", meter, velocity);
            if (meter.Progress >= configuration.TargetProgress && double.IsFinite(_bestUncertainty)) return UnforecastedCompletion(meter, velocity);
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
            string message=meter.MeasuredFill && _sweepTiming.CompletedSweeps<2
                ? $"Learning this meter's timing ({_sweepTiming.CompletedSweeps} of 2 completed sweeps). Keep the trial running."
                : "Waiting for a stable forecast inside the configured uncertainty limit.";
            return Observation(message, meter, velocity, confidence, uncertainty);
        }
        // An accelerating fit can briefly put the target in the past while the fill
        // is still near the bottom. Sending that estimate would cancel the physical
        // hold permanently. Allow the next real frame to establish a usable estimate.
        if (!_forecasted && meter.MeasuredFill && Action.Kind == VisionActionKind.RightStickStroke
            && context.StrokeAnchorTimestamp == 0)
        {
            double minimumLead = context.MinimumStrokeLeadMs ?? (settings.EstimatedVideoDelayMs + settings.EstimatedInputDelayMs - settings.CorrectionMs
                + Action.AnchorTimeFraction * configuration.EffectiveStrokeMs(settings) - settings.MaximumLatenessMs);
            if (tau < minimumLead)
            {
                if (meter.Progress >= configuration.TargetProgress * .8)
                    _timingLimit ??= $"The first qualified forecast left {tau:F1} ms. A complete stroke required at least {minimumLead:F1} ms.";
                return Observation(_timingLimit ?? "The meter is still filling. Waiting for a prediction with time for the full upstroke.",
                    meter, velocity, confidence, uncertainty);
            }
        }
        _forecasted = true;
        return Observation("Meter fill forecast ready.", meter, velocity, confidence, uncertainty, tau);

        VisionSignalObservation ContinueStroke(string message, NbaMeterDetector.Measurement? current = null)
            => Observation(message, current, uncertainty: 1000) with { ContinueCommittedAction = true };

        VisionSignalObservation Fail(string message, NbaMeterDetector.Measurement? current = null, double velocity = 0)
        {
            _attemptFailure = !_forecasted && _timingLimit is { } limit ? limit + " " + message : message;
            _forecasted = false; _count = 0;
            return Observation(_attemptFailure, current, velocity, invalidate: true);
        }

        VisionSignalObservation UnforecastedCompletion(NbaMeterDetector.Measurement current, double currentVelocity)
            => Observation(_timingLimit ??= $"Meter reached its cap without a usable forecast. Best observed uncertainty: {_bestUncertainty:F1} ms (limit {settings.MaximumUncertaintyMs:F1} ms); highest geometry score: {_bestConfidence:F2}.",
                current, currentVelocity, _bestConfidence, _bestUncertainty);

        VisionSignalObservation Observation(string message, NbaMeterDetector.Measurement? found = null, double velocity = 0,
            double? confidence = null, double uncertainty = 0, double? tau = null, bool invalidate = false)
            => new(sequence, captureTicks, found.HasValue, found?.Bounds, found?.Progress ?? 0, configuration.TargetProgress,
                velocity, tau, confidence ?? found?.Score ?? 0, double.IsFinite(uncertainty) ? uncertainty : 1000, message, _count,
                Stopwatch.GetElapsedTime(began).TotalMilliseconds, width, height, invalidate) { ForecastLimit = _timingLimit };
    }
    private bool CanRecoverWeakCandidate(NbaMeterDetector.Measurement candidate)
        => !_forecasted && _count <= 2 && candidate.Score < .78;
    private void ClearWeakCandidate()
    {
        _sweepTiming.BeginHold();
        _count = 0; _acquired = false; _curvedMeter = false; _last = null; _lastDetection = 0;
        _bestConfidence = 0; _bestUncertainty = double.PositiveInfinity;
        _detector.Reset();
    }
    private void ClearAttempt()
    {
        _sweepTiming.BeginHold();
        _count = 0; _forecasted = _acquired = _curvedMeter = _sawPreShotClear = false; _last = null; _lastCapture = _lastDetection = 0;
        _attemptFailure = _timingLimit = null; _bestConfidence = 0; _hostShotToken = 0;
        _bestUncertainty = double.PositiveInfinity;
        _detector.Reset();
    }
    public void Reset()
    {
        if (_sweepTiming.HasNewSweeps) _timingStore?.Save(_width, _height, _sweepTiming.Snapshot());
        ClearAttempt();
        _sweepTiming.Reset();
        _held = false;
        _holdStart = _hostHoldStart = 0;
        _generation = -1;
        _width = _height = 0;
        (_detector as NbaMeterDetector)?.ResetSession();
    }
    public void Dispose() => Reset();
}
