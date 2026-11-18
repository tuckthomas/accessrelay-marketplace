namespace EliteScriptStudio.Packs.Nba2K27;

internal sealed record NbaMeterSweep(double[] Levels, double[] Times)
{
    internal static ReadOnlySpan<double> StandardLevels => [.20, .32, .46, .64, .80, 1];
    internal static NbaMeterSweep FromLegacy(double[] times) => new(StandardLevels.ToArray(), times);
    internal static bool IsValid(NbaMeterSweep? sweep)
    {
        if (sweep?.Levels is not { Length: >= 4 and <= 6 } levels || sweep.Times is not { } times
            || times.Length != levels.Length || levels[0] < StandardLevels[0] || levels[^1] != 1
            || times[0] != 0 || times[^1] > 3000) return false;
        for (int i = 0; i < levels.Length; i++)
            if (!double.IsFinite(levels[i]) || !double.IsFinite(times[i])
                || i > 0 && (levels[i] <= levels[i - 1] || times[i] - times[i - 1] < 2)) return false;
        return true;
    }
}

// Landmarks are times relative to the first observed fill level, independent of the paddle press.
internal sealed class NbaMeterSweepTiming(double target)
{
    internal const int Capacity = 5;
    private readonly Queue<NbaMeterSweep> _completed = new();
    private readonly double[] _levels = new double[NbaMeterSweep.StandardLevels.Length];
    private readonly double[] _crossings = new double[NbaMeterSweep.StandardLevels.Length];
    private readonly (double Time, double Progress)[] _samples = new (double, double)[12];
    private int _crossingCount, _nextLevel, _sampleCount, _readingCount;
    private bool _finished;
    private double _highTime, _highProgress, _lastTime;
    private NbaMeterDetector.Measurement? _previous;
    internal int CompletedSweeps => _completed.Count;
    internal bool HasNewSweeps { get; private set; }

    internal void BeginHold()
    {
        _crossingCount = _nextLevel = _sampleCount = _readingCount = 0;
        _finished = false;
        _previous = null;
    }

    internal void Reset()
    {
        BeginHold();
        _completed.Clear();
        HasNewSweeps = false;
    }

    internal void Restore(IEnumerable<NbaMeterSweep> sweeps)
    {
        Reset();
        foreach (var sweep in sweeps.Where(NbaMeterSweep.IsValid).TakeLast(Capacity)) _completed.Enqueue(sweep);
    }

    internal NbaMeterSweep[] Snapshot() => _completed.ToArray();

    internal NbaMeterForecast.Estimate? Observe(NbaMeterDetector.Measurement? reading, bool ambiguous, double time, bool trackingAcquired)
    {
        if (ambiguous)
        {
            if (trackingAcquired) _finished = true;
            else if (!_finished) BeginHold();
            return null;
        }
        if (_finished || reading is not { MeasuredFill: true } meter) return null;
        var standard = NbaMeterSweep.StandardLevels;
        _readingCount++;
        if (_previous is not { } previous)
        {
            // Record where the fill actually appeared. Earlier crossings cannot be recovered.
            double firstLevel = meter.Progress / target;
            if (firstLevel >= standard[0] && firstLevel < 1)
            {
                _levels[0] = firstLevel;
                _crossings[0] = time;
                _crossingCount = 1;
            }
            while (_nextLevel < standard.Length && standard[_nextLevel] <= firstLevel) _nextLevel++;
            _highTime = time;
            _highProgress = meter.Progress;
        }
        else
        {
            if (time <= _lastTime || time - _lastTime > 70 || meter.Progress < _highProgress - .07
                || meter.Height / previous.Height is < .8 or > 1.25
                || Math.Abs(meter.Bounds.Left - previous.Bounds.Left) > .08
                || Math.Abs(meter.Bounds.Top - previous.Bounds.Top) > .08)
            {
                _finished = true;
                return null;
            }
            if (meter.Progress > _highProgress)
            {
                while (_nextLevel < standard.Length && standard[_nextLevel] * target <= meter.Progress)
                {
                    double level = standard[_nextLevel++];
                    double fraction = (level * target - _highProgress) / (meter.Progress - _highProgress);
                    double crossing = _highTime + fraction * (time - _highTime);
                    if (_crossingCount > 0 && crossing - _crossings[_crossingCount - 1] < 2) continue;
                    _levels[_crossingCount] = level;
                    _crossings[_crossingCount++] = crossing;
                }
                _highTime = time;
                _highProgress = meter.Progress;
            }
        }
        _previous = meter;
        _lastTime = time;
        if (meter.Progress >= target)
        {
            if (_readingCount >= 5 && _crossingCount >= 4 && _crossings[_crossingCount - 1] - _crossings[0] >= 75)
            {
                var times = _crossings[.._crossingCount];
                for (int i = 0; i < times.Length; i++) times[i] -= _crossings[0];
                var sweep = new NbaMeterSweep(_levels[.._crossingCount], times);
                if (NbaMeterSweep.IsValid(sweep))
                {
                    _completed.Enqueue(sweep);
                    if (_completed.Count > Capacity) _completed.Dequeue();
                    HasNewSweeps = true;
                }
            }
            _finished = true;
            return null;
        }
        if (meter.Progress < standard[0] * target || meter.Score < .65) return null;
        if (_sampleCount == _samples.Length)
        {
            Array.Copy(_samples, 1, _samples, 0, _samples.Length - 1);
            _sampleCount--;
        }
        _samples[_sampleCount++] = (time, meter.Progress);
        if (_completed.Count < 2 || _sampleCount < 5 || time - _samples[0].Time < 75
            || meter.Progress - _samples[0].Progress < .15 * target) return null;
        return Match(meter, time);
    }

    private NbaMeterForecast.Estimate? Match(NbaMeterDetector.Measurement meter, double time)
    {
        Span<(double Deadline, double Error, double Velocity)> candidates = stackalloc (double, double, double)[Capacity];
        Span<double> offsets = stackalloc double[_sampleCount];
        Span<double> scratch = stackalloc double[_sampleCount];
        int count = 0;
        foreach (var sweep in _completed)
        {
            // Align every visible sample with this reference. A noisy threshold crossing is
            // one measurement, so it cannot by itself delay the decision by several frames.
            if (meter.Progress < sweep.Levels[0] * target) continue;
            double velocity = 0, firstTime = 0, firstProgress = 0;
            int usable = 0;
            for (int i = 0; i < _sampleCount; i++)
            {
                var sample = _samples[i];
                if (sample.Progress < sweep.Levels[0] * target) continue;
                if (usable == 0) { firstTime = sample.Time; firstProgress = sample.Progress; }
                int end = 1;
                while (end < sweep.Levels.Length - 1 && sample.Progress > sweep.Levels[end] * target) end++;
                double startLevel = sweep.Levels[end - 1] * target;
                velocity = (sweep.Levels[end] * target - startLevel) / (sweep.Times[end] - sweep.Times[end - 1]);
                double phaseTime = sweep.Times[end - 1] + (sample.Progress - startLevel) / velocity;
                offsets[usable++] = sample.Time - phaseTime;
            }
            if (usable < 5 || time - firstTime < 75 || meter.Progress - firstProgress < .15 * target
                || velocity is < .00015 or > .03) continue;
            var observed = offsets[..usable];
            double shift = Median(observed, scratch);
            double drift = Math.Abs(Median(observed[..3], scratch) - Median(observed[^3..], scratch));
            double currentError = Math.Abs(observed[^1] - shift);
            for (int i = 0; i < usable; i++) observed[i] = Math.Abs(observed[i] - shift);
            double deviation = Median(observed, scratch);
            if (deviation > 8 || drift > 12 || currentError > 16) continue;
            double error = Math.Max(1.4826 * deviation, Math.Max(drift, currentError) / 2);
            candidates[count++] = (sweep.Times[^1] + shift, error, velocity);
        }
        if (count < 2) return null;
        Span<double> values = stackalloc double[Capacity];
        Span<double> work = stackalloc double[Capacity];
        for (int i = 0; i < count; i++) values[i] = candidates[i].Deadline;
        double center = Median(values[..count], work);
        int agreeing = 0;
        double spread = 0;
        Span<double> velocities = stackalloc double[Capacity];
        for (int i = 0; i < count; i++)
        {
            var candidate = candidates[i];
            double difference = Math.Abs(candidate.Deadline - center);
            if (difference > 12) continue;
            spread = Math.Max(spread, difference);
            values[agreeing] = candidate.Error;
            velocities[agreeing++] = candidate.Velocity;
        }
        if (agreeing < 2 || agreeing * 2 <= count) return null;
        double speed = Median(velocities[..agreeing], work);
        double residual = Median(values[..agreeing], work);
        double resolution = 1 / (meter.Height * .9 * speed);
        double uncertainty = Math.Sqrt(resolution * resolution + spread * spread + residual * residual);
        return new(center - time, speed, uncertainty, spread, "aligned meter sweeps");
    }

    private static double Median(ReadOnlySpan<double> values, Span<double> scratch)
    {
        var ordered = scratch[..values.Length];
        values.CopyTo(ordered);
        ordered.Sort();
        return (ordered[(ordered.Length - 1) / 2] + ordered[ordered.Length / 2]) / 2;
    }
}
