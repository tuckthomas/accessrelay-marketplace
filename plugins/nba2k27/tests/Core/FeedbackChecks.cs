using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal static class FeedbackChecks
{
internal static void Run()
{
    var lateAndSlow = Nba2K27Tuning.Suggest(Nba2K27TimingFeedback.Late, Nba2K27TempoFeedback.Slow);
    Equal(new Nba2K27Adjustment(-16, -8), lateAndSlow);
    Equal(new Nba2K27Adjustment(16, 8), Nba2K27Tuning.Suggest(Nba2K27TimingFeedback.Early, Nba2K27TempoFeedback.Fast));
    Equal(new Nba2K27Adjustment(8, 4), Nba2K27Tuning.Suggest(Nba2K27TimingFeedback.SlightlyEarly, Nba2K27TempoFeedback.SlightlyFast));
    Equal(new Nba2K27Adjustment(-8, -4), Nba2K27Tuning.Suggest(Nba2K27TimingFeedback.SlightlyLate, Nba2K27TempoFeedback.SlightlySlow));
    Equal(default, Nba2K27Tuning.Suggest(Nba2K27TimingFeedback.Excellent, Nba2K27TempoFeedback.None));
    Equal(default, Nba2K27Tuning.Suggest(Nba2K27TimingFeedback.None, Nba2K27TempoFeedback.Excellent));

    var timing = new ScriptTiming(StartDelay: 20, DownHold: 80, UpSweep: 33);
    Equal(timing with { DownHold = 64, UpSweep = 25 }, Nba2K27Tuning.Apply(timing, lateAndSlow));
    Equal(true, ReferenceEquals(timing, Nba2K27Tuning.Apply(timing, default)));
    Equal(timing with { DownHold = 1, UpSweep = ScriptTiming.MaxMs },
        Nba2K27Tuning.Apply(timing, new(int.MinValue, int.MaxValue)));

    var recording = new MacroRecording(Guid.NewGuid(), "Test shot", RecordingChannels.RightStickY | RecordingChannels.A,
        [Frame(0, 0), Frame(20, -25000, ControlId.A), Frame(30, -30000), Frame(100, -10000), Frame(116, 15000),
            Frame(133, 32000), Frame(155, 0)], 175);
    Equal(new Nba2K27Intervals(80, 33), Nba2K27Tuning.GetIntervals(recording));
    var adjusted = Nba2K27Tuning.Apply(recording, lateAndSlow);
    Equal(recording.Id, adjusted.Id);
    Equal(recording.Channels, adjusted.Channels);
    Equal(151, adjusted.DurationMs);
    Equal(new Nba2K27Intervals(64, 25), Nba2K27Tuning.GetIntervals(adjusted));
    Sequence(recording.Frames.Select(frame => frame.State), adjusted.Frames.Select(frame => frame.State));
    Equal(true, ReferenceEquals(recording, Nba2K27Tuning.Apply(recording, default)));
    Equal(new Nba2K27Intervals(2, 2),
        Nba2K27Tuning.GetIntervals(Nba2K27Tuning.Apply(recording, new(int.MinValue, int.MinValue))));

    var atLimit = Nba2K27Tuning.Apply(recording with { DurationMs = InputRecorder.MaxDurationMs }, new(16, -8));
    Equal(InputRecorder.MaxDurationMs, atLimit.DurationMs);
    Equal(new Nba2K27Intervals(88, 25), Nba2K27Tuning.GetIntervals(atLimit));

    var snap = recording with { Frames = [Frame(0, -30000), Frame(100, 30000), Frame(150, 0)] };
    Equal(new Nba2K27Intervals(100, null), Nba2K27Tuning.GetIntervals(snap));
    Equal(new Nba2K27Intervals(84, null), Nba2K27Tuning.GetIntervals(Nba2K27Tuning.Apply(snap, lateAndSlow)));

    var multiShot = recording with
    {
        Frames = [.. recording.Frames, Frame(170, -30000), Frame(200, 30000)],
        DurationMs = 220
    };
    Equal(default, Nba2K27Tuning.GetIntervals(multiShot));
    Equal(true, ReferenceEquals(multiShot, Nba2K27Tuning.Apply(multiShot, lateAndSlow)));
    Equal(default, Nba2K27Tuning.GetIntervals(recording with { Frames = [Frame(0, -30000), Frame(150, 0)] }));

    static RecordedFrame Frame(int time, short rightY, ControlId button = 0) =>
        new(time, default(ControllerState) with { RightY = rightY, Buttons = (ushort)button });
}


    private static void Equal<T>(T expected,T actual) { if (!EqualityComparer<T>.Default.Equals(expected,actual)) throw new Exception($"Expected {expected}, received {actual}."); }
    private static void Sequence<T>(IEnumerable<T> expected,IEnumerable<T> actual) { if (!expected.SequenceEqual(actual)) throw new Exception("Sequence mismatch."); }
}
