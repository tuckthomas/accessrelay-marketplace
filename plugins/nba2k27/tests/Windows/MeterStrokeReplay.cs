using System.Diagnostics;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;
using EliteScriptStudio.Vision;
using static MeterColorReplay;

// The production predictor and arbiter run on the original capture clock. A
// memory-only controller polls at 500 Hz and records every locally submitted report.
internal sealed class MeterStrokeReplay : IDisposable
{
    private sealed class Shot(Hold hold)
    {
        internal Hold Hold => hold;
        internal long? Up;
        internal long? ScheduledAnchor;
        internal long? SubmittedAnchor;
        internal long? FirstForecast;
        internal int LocatedFrames;
        internal double MaxFill;
        internal VisionActionReceipt? Receipt;
        internal string? LastSignal;
    }

    private readonly Tape _tape;
    private readonly Shot[] _shots;
    private readonly Dictionary<long, Shot> _byToken = new();
    private readonly VisionSettings _settings;
    private readonly NbaMeterPredictor _predictor;
    private readonly ControllerOutputArbiter _arbiter = new(Stopwatch.Frequency);
    private readonly long?[] _arrival;
    private readonly long[] _nextArrival;
    private readonly List<double> _startAges = [];
    private readonly int _startingSweeps;
    private long _poll, _busy;
    private int _holdIndex, _replaced;
    private ControllerState _physical;
    private Shot? _polledShot;

    internal MeterStrokeReplay(Tape tape, double?[] delay, string snapshot)
    {
        _tape = tape;
        _shots = tape.Holds.Select(h => new Shot(h)).ToArray();
        _settings = tape.Settings ?? VisionSettings.Default;
        var meter = NbaMeterSettings.Read(_settings);
        bool training = tape.Source.StartsWith("training-", StringComparison.Ordinal);
        if (training && !tape.SavedCalibration)
            meter = meter with { Enabled = true, CalibrationTrial = true, Trigger = "largeRight", InputMode = "rhythm" };
        if (meter.Trigger != "largeRight" || meter.InputMode != "rhythm") throw new InvalidDataException("A P4 rhythm configuration is required.");
        var profile = tape.Profile with { MeterTimingDirectory = snapshot };
        if (tape.SavedCalibration && (!meter.Accepted(profile, _settings) || meter.CalibratedWidth != tape.Width || meter.CalibratedHeight != tape.Height))
            throw new InvalidDataException("The saved calibration does not match the replay profile, settings and dimensions.");
        _startingSweeps = new NbaMeterTimingStore(snapshot, profile.Id, meter.TuningContextKey(profile, _settings)).Load(tape.Width, tape.Height).Length;
        _predictor = new(profile, meter, _settings);
        _arbiter.Configure(_settings, _predictor.Action);
        _arbiter.BeginSession();
        _poll = tape.Frames[0].Ticks - Stopwatch.Frequency / 10;
        _arbiter.Sample(default, default, true, true, false, _poll);
        if (!_arbiter.SetArmed(true)) throw new InvalidDataException(_arbiter.Status.Message);
        _arrival = new long?[delay.Length]; _nextArrival = new long[delay.Length];
        long last = 0;
        for (int i = 0; i < delay.Length; i++)
            if (delay[i] is { } ms) _arrival[i] = last = Math.Max(last + 1, tape.Frames[i].Ticks + (long)Math.Round(ms * Stopwatch.Frequency / 1000));
        long next = long.MaxValue;
        for (int i = delay.Length - 1; i >= 0; i--)
        {
            _nextArrival[i] = next;
            if (_arrival[i] is { } present) next = present;
        }
    }

    private Shot? Current(long time)
    {
        while (_holdIndex < _shots.Length && time >= _shots[_holdIndex].Hold.End) _holdIndex++;
        if (_holdIndex == _shots.Length) return null;
        var shot = _shots[_holdIndex];
        return shot.Hold.Armed && time >= shot.Hold.Start ? shot : null;
    }

    private void Receipt()
    {
        if (_arbiter.LastAttempt is { } receipt && _byToken.TryGetValue(receipt.ShotToken, out var shot))
            shot.Receipt = receipt;
    }

    private void PollThrough(long now)
    {
        long step = Math.Max(1, Stopwatch.Frequency / 500);
        for (; _poll <= now; _poll += step)
        {
            var shot = _polledShot = Current(_poll);
            var output = _arbiter.Sample(_physical, _physical, true, true, false, _poll, _poll,
                shot is null ? PaddleButtons.None : PaddleButtons.LargeRight);
            long token = _arbiter.Status.ShotToken;
            if (shot != null && token > 0) _byToken.TryAdd(token, shot);
            _arbiter.RecordOutputSubmitted(output, _poll);
            if (shot != null && _arbiter.StrokeAnchorTimestamp > 0)
            {
                shot.ScheduledAnchor ??= _arbiter.StrokeAnchorTimestamp;
                double travel = (output.RightY - (double)short.MinValue + 1) / 65535;
                if (travel >= _predictor.Action.AnchorFraction) shot.SubmittedAnchor ??= _poll;
                if (output.RightY == short.MaxValue) shot.Up ??= _poll;
            }
            Receipt();
        }
    }

    internal void Observe(int index, CapturedVisionFrame image)
    {
        if (_arrival[index] is not { } arrival) return;
        long start = Math.Max(_busy, arrival);
        if (_nextArrival[index] <= start) { _replaced++; return; }
        var frame = _tape.Frames[index];
        PollThrough(start);
        _physical = frame.Physical ?? default;
        if (frame.Direct is { } direct) _arbiter.ObserveStreamTelemetry(direct);
        var before = _arbiter.Status;
        var shot = _polledShot;
        long inputTicks = frame.InputTicks is > 0 ? Math.Min(start, frame.InputTicks.Value) : start;
        var context = new VisionSignalContext(_tape.Source == "diagnostic-p4" ? frame.Physical : _physical, inputTicks, before.SessionGeneration, before.ShotToken,
            before.ShotStartedTimestamp, true) { HeldPaddles = shot is null ? PaddleButtons.None : PaddleButtons.LargeRight,
                HoldStartedTimestamp = _arbiter.HoldStartedTimestamp, StrokeAnchorTimestamp = _arbiter.StrokeAnchorTimestamp };
        long began = Stopwatch.GetTimestamp();
        var signal = _predictor.Observe(image.Pixels.Span, image.Width, image.Height, image.Stride,
            frame.Sequence, frame.Generation, frame.Ticks, context);
        _busy = start + (Stopwatch.GetTimestamp() - began);
        if (index >= 30) _startAges.Add(Ms(start - frame.Ticks));
        PollThrough(_busy);
        if (shot != null)
        {
            shot.LastSignal = signal.Message;
            if (signal.Region != null)
            {
                shot.LocatedFrames++;
                shot.MaxFill = Math.Max(shot.MaxFill, signal.Progress);
            }
        }
        if (before.ShotToken != 0 && _predictor.CanArm && frame.Fresh != false &&
            (signal.TimeToTargetMs.HasValue || signal.InvalidateAttempt || signal.ContinueCommittedAction))
        {
            bool accepted = _arbiter.Submit(new(before.SessionGeneration, before.ShotToken, frame.Sequence, frame.Ticks, _busy,
                signal.TimeToTargetMs ?? 0, signal.Confidence, signal.UncertaintyMs, signal.Acquired && !signal.InvalidateAttempt)
                { ContinueCommittedAction = signal.ContinueCommittedAction && !signal.InvalidateAttempt,
                    TrackingFailure = signal.InvalidateAttempt ? signal.Message : null }, _busy);
            if (shot != null && accepted && signal.TimeToTargetMs.HasValue) shot.FirstForecast ??= _busy;
            Receipt();
        }
    }

    private static double Ms(long ticks) => ticks * 1000d / Stopwatch.Frequency;

    internal object Finish()
    {
        PollThrough(Math.Max(_busy, _tape.Frames[^1].Ticks) + Stopwatch.Frequency / 20);
        return new { replacedAtMeter = _replaced, meterStartMedianMs = _startAges.Count > 0 ? Quantile(_startAges, .5) : (double?)null,
            meterStartP95Ms = _startAges.Count > 0 ? Quantile(_startAges, .95) : (double?)null,
            canArm = _predictor.CanArm, initialSavedSweeps = _startingSweeps, allowedLatenessMs = _settings.MaximumLatenessMs,
            shots = _shots.Select((s, i) =>
            {
                var r = s.Receipt;
                bool censored = s.Hold.Truncated || s.Hold.Start < _tape.Frames[0].Ticks || s.Hold.End > _tape.Frames[^1].Ticks;
                return new { number = i + 1, s.Hold.Armed, censored, fullUp = s.Up.HasValue,
                    locatedFrames = s.LocatedFrames, maximumObservedFill = s.LocatedFrames > 0 ? s.MaxFill : (double?)null,
                    upFromHoldMs = s.Up is { } u ? Ms(u - s.Hold.Start) : (double?)null,
                    forecastFromHoldMs = s.FirstForecast is { } f ? Ms(f - s.Hold.Start) : (double?)null,
                    outcome = r?.Outcome.ToString(), cancellationReason = r?.CancellationReason, lastSignal = r == null ? s.LastSignal : null,
                    scheduledAnchorFromHoldMs = s.ScheduledAnchor is { } target ? Ms(target - s.Hold.Start) : (double?)null,
                    localAnchorSlipMs = s.SubmittedAnchor is { } actual && s.ScheduledAnchor is { } planned ? Ms(actual - planned) : (double?)null,
                    anchorVsRecordedMs = s.SubmittedAnchor is { } submitted && s.Hold.ReferenceAnchor is { } reference
                        ? Ms(submitted - reference) : (double?)null,
                    upVsManualMs = s.Up is { } up && s.Hold.ManualUp is { } manual ? Ms(up - manual) : (double?)null };
            }).ToArray() };
    }

    public void Dispose() => _predictor.Dispose();
}
