using System.Diagnostics;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal static class MeterContinuityChecks
{
    internal static void Run()
    {
        HoldUsesPhysicalTransition();
        ShortAndExpiredIdentity();
        RailOnlyGrace();
        FailedForecastCannotRevive();
        AnchoredCompletionIsExplicit();
        HostRejectsHiddenFailures();
        ForecastTimeIsNotShifted();
        CurvedForecastRequiresEnoughEvidence();
        WeakEarlyFalseLockRecoversCleanly();
        FirstMeasuredFillStartsItsOwnRise();
        MovingMeterTracksAcrossHorizontalShift();
        DelayedOffDribbleMeterAcquiresAfterClearSearch();
        FrameCadenceHonorsConfiguredLimit();
        HardwoodIsoLuminantAndUniformBackgroundChecks();
        Console.WriteLine("SUCCESS Meter continuity: poll-anchored holds, between-frame repress, identity retention/expiry, failed-forecast latch, explicit anchored completion and host cancellation.");
    }

    private static void HoldUsesPhysicalTransition()
    {
        using var f = new Fixture(holdMs: 70);
        // First video observation is already 75 ms after the physical press.
        var first = f.At(75, .2);
        Check(first.Acquired && first.Samples == 1, "Hold qualification restarted at the first video frame.");
        using var shifted = new Fixture(holdMs: 70);
        Check(shifted.At(10, .2).Message.Contains("Qualifying"), "Physical hold qualified early.");
        Check(shifted.At(71, .2).Acquired, "Video phase changed physical hold qualification.");
        f.HostStart = Fixture.Ticks(80);
        Check(f.At(85, .2).Message.Contains("Qualifying"), "A physical repress between video frames continued the previous hold.");
        using var expired = new Fixture(holdMs: 70);
        Check(expired.At(900, null).InvalidateAttempt, "Acquisition timeout ignored the actual press time before the first video frame.");
        using var future = new Fixture(holdMs: 70);
        future.HostStart = Fixture.Ticks(20);
        Check(future.At(10, .2, inputMs: 25).Message.Contains("Qualifying"), "A frame captured before the physical press was treated as a qualified hold.");
        using var missingOrigin = new Fixture();
        missingOrigin.HostStart = 0;
        Check(missingOrigin.At(75, .2).InvalidateAttempt, "Armed assistance silently substituted video time for missing physical hold timing.");
        using var tail = new Fixture(holdMs: 70);
        Check(!tail.At(73, .499, measured: true).Acquired, "A previous shot's half-full tail acquired a new press.");
        for (int t = 90; t <= 400; t += 25) tail.At(t, null);
        Check(tail.At(410, .16, measured: true).Acquired, "Rejecting a prior tail disabled the new meter.");
        using var reversal = new Fixture();
        for (int t = 0; t <= 60; t += 20) reversal.At(t, .2 + .005 * t, height: 640, measured: true);
        var pulled = reversal.At(78, .47, height: 640, measured: true);
        Check(pulled.WithdrawPendingForecast && !pulled.InvalidateAttempt && pulled.TimeToTargetMs == null,
            "A reversed measured edge left the old deadline active or cancelled the entire press.");
    }

    private static void ShortAndExpiredIdentity()
    {
        using var f = new Fixture();
        f.At(0, .2); f.At(20, .3);
        var miss = f.At(40, null);
        Check(!miss.Acquired && !miss.InvalidateAttempt && miss.TimeToTargetMs is null, "An early missing frame became a forecast.");
        var returned = f.At(60, .6);
        Check(returned.Acquired && returned.Samples == 1 && !returned.InvalidateAttempt, "A short miss lost the meter identity or reused its fit history.");
        using var swapped = new Fixture();
        swapped.At(0, .2); swapped.At(20, null);
        Check(swapped.At(40, .3, x: 60).InvalidateAttempt, "A meter at a new position was accepted after a missed frame.");
        Check(swapped.At(60, .4).InvalidateAttempt, "A rejected identity revived on the same hold.");
        using var expired = new Fixture();
        expired.At(0, .2);
        foreach (int time in new[] { 20, 40, 60 }) Check(!expired.At(time, null).InvalidateAttempt, "Identity expired before the bounded grace interval.");
        Check(expired.At(80, null).InvalidateAttempt, "Repeated misses kept an old identity indefinitely.");
        using var returnedLate = new Fixture();
        returnedLate.At(0, .2); returnedLate.At(30, null); returnedLate.At(60, null);
        Check(returnedLate.At(90, .3).InvalidateAttempt, "Late reacquisition bypassed identity expiry.");

        // Pre-fill empty outlines (progress <= 0.03) must not lock identity before the meter starts filling:
        // neither a long pre-shot gap nor a brief residual flash (p=1.0) may invalidate the upcoming shot.
        using var emptyOutlineThenGap = new Fixture();
        Check(!emptyOutlineThenGap.At(70, 0).InvalidateAttempt, "Pre-fill outline was invalidated.");
        for (int t = 90; t <= 250; t += 20)
            Check(!emptyOutlineThenGap.At(t, null).InvalidateAttempt, "Missing frames after an empty pre-fill outline aborted the shot.");
        var realMeterAfterGap = emptyOutlineThenGap.At(270, .2);
        Check(realMeterAfterGap.Acquired && !realMeterAfterGap.InvalidateAttempt, "Real meter failed to acquire after pre-fill outline disappeared.");

        using var emptyOutlineThenResidualFlash = new Fixture();
        emptyOutlineThenResidualFlash.At(70, 0);
        var residualFlash = emptyOutlineThenResidualFlash.At(120, 1.0);
        Check(!residualFlash.InvalidateAttempt && !residualFlash.Acquired, "Prior-shot flash after an empty outline locked acquisition.");
        Check(!emptyOutlineThenResidualFlash.At(140, 0).InvalidateAttempt, "Return from residual flash falsely triggered backward-fill failure.");
        for (int t = 160; t <= 220; t += 20) emptyOutlineThenResidualFlash.At(t, null);
        var realMeterAfterFlash = emptyOutlineThenResidualFlash.At(240, .2);
        Check(realMeterAfterFlash.Acquired && !realMeterAfterFlash.InvalidateAttempt, "Real meter failed to acquire after residual flash cleared.");
    }

    private static void RailOnlyGrace()
    {
        foreach (bool recover in new[] { true, false })
        {
            using var f = new Fixture();
            for (int i = 0; i <= 3; i++)
            {
                var result = f.At(20 * i, .2 + .06 * i, height: 640, measured: true);
                if (i == 3) Check(result.TimeToTargetMs.HasValue, "Missing forecast before the weak frame.");
            }
            foreach (int ms in new[] { 80, 100 })
            {
                var held = f.At(ms, null, rails: true);
                Check(!held.InvalidateAttempt && !held.Acquired && held.TimeToTargetMs is null &&
                    !held.ContinueCommittedAction && held.Samples == 4, "Rail-only evidence refreshed timing.");
            }
            var next = f.At(110, recover ? .53 : null, height: 640, rails: !recover, measured: recover);
            Check(recover ? next.TimeToTargetMs.HasValue : next.InvalidateAttempt, "Rail-only grace failed to recover or expire.");
        }
    }

    private static void FailedForecastCannotRevive()
    {
        foreach (var failure in new[] { "missing", "position", "scale", "backward", "ambiguous", "velocity", "stale-input" })
        {
            using var f = new Fixture();
            f.Ready();
            var observation = failure switch
            {
                "missing" => f.At(80, null),
                "position" => f.At(80, .6, x: 60),
                "scale" => f.At(80, .6, height: 110),
                "backward" => f.At(80, .2),
                "ambiguous" => f.At(80, null, ambiguous: true),
                "stale-input" => f.At(80, .6, inputMs: -80),
                // A flat fill eventually has no positive fit velocity.
                _ => Enumerable.Range(4, 8).Select(i => f.At(i * 20, .5)).Last()
            };
            Check(observation.InvalidateAttempt && observation.TimeToTargetMs is null && !observation.ContinueCommittedAction,
                $"Saved forecast hid {failure} tracking failure.");
            Check(f.At(f.Time + 20, .7).InvalidateAttempt, $"{failure} failure revived without neutral or a new physical hold.");
            f.HostStart = Fixture.Ticks(f.Time + 10);
            Check(!f.At(f.Time + 20, .2).InvalidateAttempt, "A verified new physical hold could not reset a cancelled attempt.");
        }
    }

    private static void AnchoredCompletionIsExplicit()
    {
        using var f = new Fixture();
        f.Ready(); f.At(80, .6); f.At(100, .7); f.At(120, .8);
        f.Anchor = Fixture.Ticks(125);
        var missing = f.At(140, null);
        Check(missing.ContinueCommittedAction && !missing.Acquired && missing.TimeToTargetMs is null && missing.Confidence == 0,
            "Expected post-anchor disappearance was disguised as a fresh meter forecast.");
        Check(f.At(160, null, ambiguous: true).InvalidateAttempt, "Post-anchor ambiguity was hidden as expected disappearance.");
        using var identity = new Fixture();
        identity.Ready(); identity.At(80, .6); identity.At(100, .7); identity.At(120, .8);
        identity.Anchor = Fixture.Ticks(125);
        Check(identity.At(140, .9, x: 60).InvalidateAttempt, "A post-anchor identity change was hidden by the saved forecast.");
        using var premature = new Fixture();
        premature.Ready(); premature.At(80, .6); premature.At(100, .7); premature.At(120, .8);
        premature.Anchor = Fixture.Ticks(150);
        Check(premature.At(140, null).InvalidateAttempt, "A pre-anchor captured frame was allowed to continue a stroke.");
        using var unforecasted = new Fixture(minimumConfidence: .99);
        unforecasted.At(0, .15); unforecasted.At(40, .18); unforecasted.At(80, .55); unforecasted.At(120, .58);
        var capped = unforecasted.At(160, 1);
        Check(capped.Message.Contains("Meter reached its cap without a usable forecast") && capped.TimeToTargetMs is null,
            "An unforecasted full meter fell back to a generic velocity warning.");
        using var completed = new Fixture();
        completed.Ready(); completed.Anchor = Fixture.Ticks(75);
        Check(completed.At(80, .78).ContinueCommittedAction, "Post-anchor visible fill before the cap did not continue the committed stroke.");
        foreach (int t in new[] { 100, 120, 140, 160 })
        {
            var ended = completed.At(t, null, shotToken: 0, armed: false, holdStart: 0);
            Check(!ended.InvalidateAttempt && ended.Message.Contains("Controller action ended"),
                "Auto-disarm after a completed stroke triggered a false cadence or tracking failure while the stick remained held.");
        }
    }

    private static void HostRejectsHiddenFailures()
    {
        // Millisecond QPC fixture: one actual scheduled stroke, with input sampled every 2 ms.
        foreach (string mode in new[] { "valid-completion", "tracking-loss", "stale-completion", "pre-anchor-frame" })
        {
            var arbiter = new ControllerOutputArbiter(1000);
            arbiter.Configure(VisionSettings.Default with { MinimumConfidence = .65, MaximumUncertaintyMs = 12 },
                new() { Kind = VisionActionKind.RightStickStroke, StrokeDurationMs = 80, AnchorFraction = .5, EndHoldMs = 10 });
            arbiter.BeginSession(); arbiter.Sample(default, default, true, true, false, 1);
            Check(arbiter.SetArmed(true), "Stroke fixture could not arm.");
            var down = new ControllerState { RightY = short.MinValue };
            arbiter.Sample(down, down, true, true, false, 100, inputTimestamp: 98);
            Check(arbiter.HoldStartedTimestamp == 98 && arbiter.Status.ShotStartedTimestamp == 98, "Host lost the poll transition time.");
            var status = arbiter.Status;
            Check(arbiter.Submit(new(status.SessionGeneration, status.ShotToken, 1, 100, 100, 60, .95, 2, true), 100), "Initial real forecast was rejected.");
            for (int t = 102; t <= 162; t += 2)
            {
                if (t == 116 || t == 148)
                    Check(arbiter.Submit(new(status.SessionGeneration, status.ShotToken, t, t, t, 160 - t, .95, 2, true), t), "Fresh real measurement was rejected.");
                arbiter.Sample(down, down, true, true, false, t);
            }
            Check(arbiter.StrokeAnchorTimestamp == 160, "Host did not actually start and anchor the stroke.");
            long captured = mode == "stale-completion" ? 1 : mode == "pre-anchor-frame" ? 159 : 162;
            var continuation = new VisionPrediction(status.SessionGeneration, status.ShotToken, 200, captured, 162, 0, 0, 1000, false)
            { ContinueCommittedAction = mode != "tracking-loss" };
            bool accepted = arbiter.Submit(continuation, 162);
            Check(accepted == (mode == "valid-completion"), $"Host incorrectly accepted {mode}.");
            if (accepted)
            {
                for (int t = 164; t <= 212; t += 2) arbiter.Sample(down, down, true, true, false, t);
                Check(arbiter.LastAction is not null && arbiter.Status.AutomatedReleases == 1, "Explicit post-anchor completion did not finish the stroke.");
            }
            else Check(arbiter.DeadlineTimestamp is null && arbiter.LastAction is null, $"Host kept a deadline after {mode}.");
        }
        var unstarted = new ControllerOutputArbiter(1000);
        unstarted.Configure(VisionSettings.Default, new() { Kind = VisionActionKind.RightStickStroke });
        unstarted.BeginSession(); unstarted.Sample(default, default, true, true, false, 1); unstarted.SetArmed(true);
        var hold = new ControllerState { RightY = short.MinValue }; unstarted.Sample(hold, hold, true, true, false, 100);
        var before = unstarted.Status;
        Check(!unstarted.Submit(new(before.SessionGeneration, before.ShotToken, 1, 100, 100, 0, .99, 0, true)
            { ContinueCommittedAction = true }, 100), "A completion observation started a new stroke.");
    }

    private static void ForecastTimeIsNotShifted()
    {
        using var f = new Fixture(); f.Ready();
        var forecast = f.At(80, .6);
        Check(forecast.TimeToTargetMs is { } tau && Math.Abs(tau-80)<.001,
            "A linear 80 ms target forecast was shifted to bypass scheduler freshness.");
    }

    private static void CurvedForecastRequiresEnoughEvidence()
    {
        var profile = new Nba2K27ShotProfile(Guid.NewGuid(), "CurvedFixture", 83, 91, "Base", "Upper 1", "Upper 2", true, "Push");
        var detector = new ScriptedDetector();
        using var predictor = new NbaMeterPredictor(profile, new() { Trigger = "physicalStick", CalibrationTrial = true, HoldMs = 0, TargetProgress = .75 },
            VisionSettings.Default with { MinimumConfidence = .65, MaximumUncertaintyMs = 18 }, detector);
        byte[] pixels = new byte[100 * 100 * 4];
        // A synthetic accelerating meter reaches 0.75 at t = 340 ms.
        // Competing models may abstain at early, ambiguous horizons.
        double tAt75 = 340;
        VisionSignalObservation? lastForecast = null;
        for (int t = 60; t <= 300; t += 20)
        {
            double s = t / tAt75;
            double p = 0.08 + 0.67 * Math.Pow(s, 1.45);
            detector.Next = new(new(.1, .1, .2, .6), p, .95, 160, 40, 40, Bow: 32);
            var obs = predictor.Observe(pixels, 100, 100, 400, t, 1, Fixture.Ticks(t),
                new(new ControllerState { RightY = short.MinValue }, Fixture.Ticks(t), 1, 1, Fixture.Ticks(0), true)
                { HoldStartedTimestamp = Fixture.Ticks(0) });
            if (obs.TimeToTargetMs is { } forecast)
            {
                Check(Math.Abs(t + forecast - tAt75) <= Math.Max(12, obs.UncertaintyMs), "Curved forecast understated its error.");
                lastForecast = obs;
            }
        }
        Check(lastForecast is { TimeToTargetMs: { } tau } && Math.Abs((lastForecast.CaptureTimestamp - Fixture.Ticks(0)) * 1000d / Stopwatch.Frequency + tau - tAt75) < 12,
            $"Curved fill forecast drifted too far from true 340 ms target: {lastForecast?.TimeToTargetMs}");
    }

    private static void WeakEarlyFalseLockRecoversCleanly()
    {
        var profile = new Nba2K27ShotProfile(Guid.NewGuid(), "RecoveryFixture", 83, 91, "Base", "Upper 1", "Upper 2", true, "Push");
        var detector = new ScriptedDetector();
        using var predictor = new NbaMeterPredictor(profile, new() { Trigger = "physicalStick", CalibrationTrial = true, HoldMs = 0, TargetProgress = .75 },
            VisionSettings.Default with { MinimumConfidence = .65, MaximumUncertaintyMs = 15 }, detector);
        byte[] pixels = new byte[100 * 100 * 4];
        VisionSignalObservation Step(int ms, NbaMeterDetector.Measurement? m)
        {
            detector.Next = m;
            return predictor.Observe(pixels, 100, 100, 400, ms, 1, Fixture.Ticks(ms),
                new(new ControllerState { RightY = short.MinValue }, Fixture.Ticks(ms), 1, 1, Fixture.Ticks(0), true)
                { HoldStartedTimestamp = Fixture.Ticks(0) });
        }
        // Low-confidence floor cap appears low on screen, drops backward, then disappears before real meter locks above.
        Check(!Step(80, new(new(.4, .7, .03, .1), .40, .67, 110, 40, 70)).InvalidateAttempt, "Initial weak lock failed immediately.");
        Check(!Step(100, new(new(.4, .7, .03, .1), .25, .67, 110, 40, 70)).InvalidateAttempt, "Regressing weak lock poisoned the shot.");
        Check(!Step(120, null).InvalidateAttempt && !Step(140, null).InvalidateAttempt && !Step(160, null).InvalidateAttempt, "Searching gap failed cadence.");
        var real = Step(180, new(new(.38, .43, .03, .15), .14, .92, 150, 39, 43, Bow: 30));
        Check(real.Acquired && !real.InvalidateAttempt, $"Real high-confidence meter failed to re-acquire after weak false lock: {real.Message}");
        Step(200, new(new(.38, .43, .03, .15), .21, .92, 150, 39, 43, Bow: 30));
        Step(220, new(new(.38, .43, .03, .15), .29, .92, 150, 39, 43, Bow: 30));
        var forecast = Step(240, new(new(.38, .43, .03, .15), .38, .92, 150, 39, 43, Bow: 30));
        Check(forecast.TimeToTargetMs.HasValue && !forecast.InvalidateAttempt, "Real meter could not forecast after weak false-lock recovery.");

        // Also test direct jump from weak false lock (conf=0.67) to high-confidence real meter (conf=0.92).
        using var direct = new NbaMeterPredictor(profile, new() { Trigger = "physicalStick", CalibrationTrial = true, HoldMs = 0, TargetProgress = .75 },
            VisionSettings.Default with { MinimumConfidence = .65, MaximumUncertaintyMs = 15 }, detector);
        detector.Next = new(new(.4, .7, .03, .1), .40, .67, 110, 40, 70);
        Check(!direct.Observe(pixels, 100, 100, 400, 1, 1, Fixture.Ticks(80),
            new(new ControllerState { RightY = short.MinValue }, Fixture.Ticks(80), 1, 1, Fixture.Ticks(0), true) { HoldStartedTimestamp = Fixture.Ticks(0) }).InvalidateAttempt,
            "Direct jump initial weak lock failed.");
        detector.Next = new(new(.38, .43, .03, .15), .14, .92, 150, 39, 43, Bow: 30);
        var jumped = direct.Observe(pixels, 100, 100, 400, 2, 1, Fixture.Ticks(100),
            new(new ControllerState { RightY = short.MinValue }, Fixture.Ticks(100), 1, 1, Fixture.Ticks(0), true) { HoldStartedTimestamp = Fixture.Ticks(0) });
        Check(jumped.Acquired && !jumped.InvalidateAttempt, $"Direct jump to high-confidence meter failed: {jumped.Message}");
    }

    private static void FirstMeasuredFillStartsItsOwnRise()
    {
        using var shot = new Fixture(targetProgress: .75);
        // The two outline estimates and first directly measured fill from session shot 30.
        shot.At(389, .244, height: 191);
        shot.At(406, .267, height: 191);
        var first = shot.At(421, .119, height: 169, measured: true);
        Check(first.Acquired && !first.InvalidateAttempt && first.Samples == 1 && first.TimeToTargetMs is null,
            $"The first directly measured fill inherited the outline estimates: {first.Message}");
        for (int ms = 441; ms < 581; ms += 20)
            shot.At(ms, .119 + (ms - 421) * .002, height: 172, measured: true);
        var forecast = shot.At(581, .439, height: 172, measured: true);
        Check(forecast.TimeToTargetMs.HasValue && !forecast.InvalidateAttempt,
            $"The measured rise could not schedule a stroke after the handoff: {forecast.Message}");
        Check(shot.At(598, .290, height: 172, measured: true).InvalidateAttempt,
            "A subsequent reversal between two direct measurements was ignored.");

        using var forward = new Fixture();
        forward.At(389, .11); forward.At(406, .15);
        Check(forward.At(421, .2, measured: true).Samples == 1,
            "A forward method change mixed outline and measured fill speeds.");

        using var different = new Fixture();
        different.At(389, .244); different.At(406, .267);
        Check(different.At(421, .119, x: 60, measured: true).InvalidateAttempt,
            "A measured fill at a different position inherited the old meter.");

        using var scheduled = new Fixture();
        scheduled.Ready();
        Check(scheduled.At(80, .1, measured: true).InvalidateAttempt,
            "A conflicting first measured fill left an existing forecast active.");
    }

    private static void MovingMeterTracksAcrossHorizontalShift()
    {
        const int w = 1280, h = 720, stride = w * 4;
        byte[] RenderAt(double centerX, double fill)
        {
            byte[] pixels = new byte[stride * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                int i = y * stride + x * 4; pixels[i] = 75; pixels[i + 1] = 95; pixels[i + 2] = 150; pixels[i + 3] = 255;
            }
            const double cy0 = 300, mh = 110, bow = 22, halfW = 6;
            for (int y = (int)cy0; y <= (int)(cy0 + mh); y++)
            {
                double t = (y - cy0) / mh;
                double cx = centerX + bow * 4 * t * (1 - t);
                for (int x = (int)(cx - 9); x <= (int)(cx + 9); x++)
                {
                    if (x < 0 || x >= w || Math.Abs(x - cx) > halfW) continue;
                    int i = y * stride + x * 4;
                    bool isCap = t <= .06, isFill = t >= 1 - fill * .9;
                    (byte r, byte g, byte b) = isCap ? ((byte)90, (byte)215, (byte)95) : isFill ? ((byte)220, (byte)220, (byte)220) : ((byte)106, (byte)106, (byte)106);
                    pixels[i] = b; pixels[i + 1] = g; pixels[i + 2] = r;
                }
            }
            return pixels;
        }
        var detector = new NbaMeterDetector(new());
        // Simulate a fast sideways dribble pull-up shifting 30 px per frame across consecutive frames.
        for (int f = 0; f < 4; f++)
        {
            var found = detector.Detect(RenderAt(640 - f * 30, .20 + f * .12), w, h, stride);
            Check(found is { } m && m.Score >= .65 && m.Progress > .10, $"Moving meter dropped at step {f}: {found}.");
        }
    }

    private static void DelayedOffDribbleMeterAcquiresAfterClearSearch()
    {
        var profile = new Nba2K27ShotProfile(Guid.NewGuid(), "DelayedFixture", 83, 91, "Base", "Upper 1", "Upper 2", true, "Push");
        var detector = new ScriptedDetector();
        using var predictor = new NbaMeterPredictor(profile, new() { Trigger = "physicalStick", CalibrationTrial = true, HoldMs = 70, TargetProgress = .75 },
            VisionSettings.Default with { MinimumConfidence = .65, MaximumUncertaintyMs = 15 }, detector);
        byte[] pixels = new byte[100 * 100 * 4];
        VisionSignalObservation Step(int ms, double? progress)
        {
            detector.Next = progress is { } p ? new(new(.23, .46, .04, .15), p, .92, 145, 40, 46, Bow: 28) : null;
            return predictor.Observe(pixels, 100, 100, 400, ms, 1, Fixture.Ticks(ms),
                new(new ControllerState { RightY = short.MinValue }, Fixture.Ticks(ms), 1, 1, Fixture.Ticks(0), true)
                { HoldStartedTimestamp = Fixture.Ticks(0) });
        }
        // Clear search frames while dribbling into the pull-up gather:
        for (int t = 80; t <= 480; t += 20)
            Check(!Step(t, null).InvalidateAttempt, "Clear pre-shot search failed cadence.");
        // Delayed meter finally appears around p = 0.52 and advances cleanly:
        var first = Step(500, .52);
        Check(first.Acquired && !first.InvalidateAttempt, $"Delayed off-dribble meter was wrongly rejected as a prior shot: {first.Message}");
    }

    private static void FrameCadenceHonorsConfiguredLimit()
    {
        foreach (int maximumAge in new[] { 40, 80 })
        {
            var arbiter = new ControllerOutputArbiter(1000);
            arbiter.Configure(VisionSettings.Default with { MaximumFrameAgeMs = maximumAge },
                new() { Kind = VisionActionKind.RightStickStroke, StrokeDurationMs = 80, AnchorFraction = .5 });
            arbiter.BeginSession(); arbiter.Sample(default, default, true, true, false, 1); arbiter.SetArmed(true);
            var down = new ControllerState { RightY = short.MinValue }; arbiter.Sample(down, down, true, true, false, 100);
            var shot = arbiter.Status;
            Check(arbiter.Submit(new(shot.SessionGeneration, shot.ShotToken, 1, 100, 100, 90, .95, 2, true),100), "Freshness fixture could not schedule.");
            for(int time=102;time<=152;time+=2)arbiter.Sample(down,down,true,true,false,time);
            Check((arbiter.StrokeAnchorTimestamp>0)==(maximumAge==80), "Stroke start ignored the configured frame-age bound.");
            if(maximumAge==80)
                Check(!arbiter.Submit(new(shot.SessionGeneration,shot.ShotToken,2,152,152,38,0,1000,false),152)
                    && arbiter.DeadlineTimestamp is null,"Configured freshness allowed a negative tracking observation to keep the stroke alive.");
        }
    }

    private static void HardwoodIsoLuminantAndUniformBackgroundChecks()
    {
        const int w = 2560, h = 1440, stride = w * 4;
        byte[] RenderMeter(byte bgR, byte bgG, byte bgB)
        {
            byte[] pixels = new byte[stride * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                int i = y * stride + x * 4;
                pixels[i] = bgB; pixels[i + 1] = bgG; pixels[i + 2] = bgR; pixels[i + 3] = 255;
            }
            const double cx0 = 1280, cy0 = 640, mh = 170, bow = 34, halfW = 9;
            for (int y = (int)cy0; y <= (int)(cy0 + mh); y++)
            {
                double t = (y - cy0) / mh;
                double cx = cx0 + bow * 4 * t * (1 - t);
                for (int x = (int)(cx - 12); x <= (int)(cx + 12); x++)
                {
                    if (Math.Abs(x - cx) > halfW) continue;
                    int i = y * stride + x * 4;
                    bool isCap = t <= .055, isFill = t >= .82;
                    (byte r, byte g, byte b) = isCap ? ((byte)90, (byte)215, (byte)95) : isFill ? ((byte)220, (byte)220, (byte)220) : ((byte)106, (byte)106, (byte)106);
                    pixels[i] = b; pixels[i + 1] = g; pixels[i + 2] = r;
                }
            }
            return pixels;
        }
        // Bright iso-luminant tan hardwood (luma ~110, chroma 75) outside an unfilled gray (106) meter must still score above threshold.
        var hardwood = new NbaMeterDetector(new()).Detect(RenderMeter(150, 95, 75), w, h, stride);
        Check(hardwood is { } detected && detected.Score >= .65 && detected.Progress is > .05 and < .45,
            $"Low-fill meter over iso-luminant hardwood floor failed detection: {hardwood}.");
        // Identical gray interior on a matching flat gray background has zero edge separation and must still be rejected.
        var flatGray = new NbaMeterDetector(new()).Detect(RenderMeter(106, 106, 106), w, h, stride);
        Check(flatGray is null, $"Uniform flat-gray background was falsely detected as a meter: {flatGray}.");
    }

    private sealed class Fixture : IDisposable
    {
        private readonly ScriptedDetector _detector = new();
        private readonly NbaMeterPredictor _predictor;
        private readonly byte[] _pixels = new byte[100 * 100 * 4];
        private long _sequence;
        internal long HostStart = Ticks(0), Anchor;
        internal int Time;
        internal Fixture(double holdMs = 0, double minimumConfidence = .65, double targetProgress = 1)
        {
            var profile = new Nba2K27ShotProfile(Guid.NewGuid(), "Fixture", 83, 91, "Base", "Upper 1", "Upper 2", true, "Push");
            _predictor = new(profile, new() { Trigger = "physicalStick", CalibrationTrial = true, HoldMs = holdMs, TargetProgress = targetProgress },
                VisionSettings.Default with { MinimumConfidence = minimumConfidence, MaximumUncertaintyMs = 12 }, _detector);
        }
        internal static long Ticks(int ms) => Stopwatch.Frequency * 2 + (long)(ms * Stopwatch.Frequency / 1000d);
        internal VisionSignalObservation At(int ms, double? progress, double x = 20, double height = 160, bool ambiguous = false, int? inputMs = null,
            long shotToken = 1, bool armed = true, long? holdStart = null, bool rails = false, bool measured = false)
        {
            Time = ms; _detector.Next = progress is { } p ? new(new(.1, .1, .2, .6), p, .95, height, x, 20) { MeasuredFill = measured } : null;
            _detector.HasRailIdentity = rails;
            _detector.IsAmbiguous = ambiguous;
            long effectiveHoldStart = holdStart ?? HostStart;
            return _predictor.Observe(_pixels, 100, 100, 400, ++_sequence, 1, Ticks(ms),
                new(new ControllerState { RightY = short.MinValue }, Ticks(inputMs ?? ms), 1, shotToken, effectiveHoldStart, armed)
                { HoldStartedTimestamp = effectiveHoldStart, StrokeAnchorTimestamp = Anchor });
        }
        internal void Ready()
        {
            At(0, .2); At(20, .3); At(40, .4);
            Check(At(60, .5).TimeToTargetMs.HasValue, "Fixture did not establish a genuine timing forecast.");
        }
        public void Dispose() => _predictor.Dispose();
    }
    private sealed class ScriptedDetector : INbaMeterDetector
    {
        internal NbaMeterDetector.Measurement? Next;
        internal bool IsAmbiguous;
        public bool HasRailIdentity { get; set; }
        public bool Ambiguous => IsAmbiguous;
        public NbaMeterDetector.Measurement? Detect(ReadOnlySpan<byte> pixels, int width, int height, int stride) => Next;
        public void Reset() { }
    }
    private static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
}
