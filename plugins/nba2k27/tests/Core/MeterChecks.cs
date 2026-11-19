using System.Diagnostics;
using System.Text.Json;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;

internal static class MeterChecks
{
    internal static void Inspect(string directory, string output, int scale = 1)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "session.json")));
        var root = document.RootElement;
        var stream = root.GetProperty("captureEvidence").GetProperty("streams").EnumerateArray().First(s => s.GetProperty("name").GetString() == "scene");
        int w = stream.GetProperty("width").GetInt32(), h = stream.GetProperty("height").GetInt32(), stride = stream.GetProperty("stride").GetInt32();
        if (scale is < 1 or > 3) throw new ArgumentOutOfRangeException(nameof(scale));
        int originalWidth = w, originalHeight = h, originalStride = stride;
        byte[] source = new byte[stride * h];
        w *= scale; h *= scale; stride = scale == 1 ? originalStride : w * 4;
        byte[] pixels = scale == 1 ? source : new byte[stride * h];
        using var file = File.OpenRead(Path.Combine(directory, stream.GetProperty("file").GetString()!));
        var detector = new NbaMeterDetector(new());
        var profile = root.GetProperty("shotProfile").Deserialize<Nba2K27ShotProfile>(NbaMeterSettings.Json)! with { Gamertag = "" };
        var settings = VisionSettings.Default with { MinimumConfidence = .65, MaximumUncertaintyMs = 12 };
        using var predictor = new NbaMeterPredictor(profile, new() { Enabled = true, CalibrationTrial = true, GameBuild = "2.0.0.12" }, settings);
        using var continuedHold = new NbaMeterPredictor(profile, new() { Enabled = true, CalibrationTrial = true, GameBuild = "2.0.0.12" }, settings);
        using var scheduled = new NbaMeterPredictor(profile, new() { Enabled = true, CalibrationTrial = true, GameBuild = "2.0.0.12" }, settings);
        var arbiter = new ControllerOutputArbiter(Stopwatch.Frequency);
        arbiter.Configure(settings, scheduled.Action); arbiter.BeginSession();
        long timeline = 0, holdUntil = 0;
        bool wasVisible = false;
        using var trace = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "controller-trace.json")));
        if (root.GetProperty("stopwatchFrequency").GetInt64() != Stopwatch.Frequency) throw new InvalidDataException("Replay requires the original QPC frequency.");
        var inputs = trace.RootElement.GetProperty("samples").EnumerateArray().Where(e => e.GetProperty("kind").GetString() == "poll").ToArray();
        int inputIndex = 0;
        bool checkedEdges = false;
        var rows = new List<object>();
        int index = 0;
        foreach (var frame in root.GetProperty("frames").EnumerateArray())
        {
            var scene = frame.GetProperty("evidence").EnumerateArray().FirstOrDefault(e => e.GetProperty("name").GetString() == "scene");
            if (scene.ValueKind == JsonValueKind.Undefined) { index++; continue; }
            file.Position = scene.GetProperty("offsetBytes").GetInt64(); file.ReadExactly(source);
            if (scale != 1)
                for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                    Buffer.BlockCopy(source, (y / scale) * originalStride + (x / scale) * 4, pixels, y * stride + x * 4, 4);
            long start = Stopwatch.GetTimestamp(); var found = detector.Detect(pixels, w, h, stride);
            double ms = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
            if(!checkedEdges && found is { Progress: > .55 and < .8, Score: > .7 } visible)
            { VerifyEdges(pixels,w,h,stride,visible); checkedEdges=true; }
            long ticks = frame.GetProperty("captureTicks").GetInt64();
            while (inputIndex + 1 < inputs.Length && inputs[inputIndex + 1].GetProperty("sampleTicks").GetInt64() <= ticks) inputIndex++;
            var input = inputs[inputIndex];
            var physical = input.GetProperty("physical").Deserialize<ControllerState>(NbaMeterSettings.Json);
            var signal = predictor.Observe(pixels, w, h, stride, index, 1, ticks,
                new(input.GetProperty("connected").GetBoolean() ? physical : null, input.GetProperty("sampleTicks").GetInt64(), 1, 0, 0, false));
            // Explicit counterfactual: keep down held to inspect the predictor after the
            // recorded player manually reversed. No controller report is written.
            var hypothetical = continuedHold.Observe(pixels,w,h,stride,index,1,ticks,
                new(found is not null ? new ControllerState { RightY=short.MinValue } : null,ticks,1,0,0,false));
            // A separate device-free replay exercises predictor + host arbiter together.
            // Hold for two seconds from each new visible meter, rather than replaying the manual upswing.
            var down = new ControllerState { RightY = short.MinValue };
            if (timeline == 0)
            {
                timeline = ticks;
                arbiter.Sample(default, default, true, true, false, ticks);
                if (!arbiter.SetArmed(true)) throw new Exception(arbiter.Status.Message);
            }
            long schedulerStep = Math.Max(1, Stopwatch.Frequency / 500);
            while (timeline + schedulerStep < ticks)
            {
                timeline += schedulerStep;
                var state = timeline <= holdUntil ? down : default;
                arbiter.Sample(state, state, true, true, false, timeline);
            }
            if (found is not null && !wasVisible && ticks > holdUntil) holdUntil = ticks + Stopwatch.Frequency * 2;
            wasVisible = found is not null;
            var physicalHold = ticks <= holdUntil ? down : default;
            timeline = ticks;
            arbiter.Sample(physicalHold, physicalHold, true, true, false, ticks);
            var outputBefore = arbiter.Status;
            var forecast = scheduled.Observe(pixels, w, h, stride, index, 1, ticks,
                new(physicalHold, ticks, outputBefore.SessionGeneration, outputBefore.ShotToken, outputBefore.ShotStartedTimestamp, true)
                { HoldStartedTimestamp = arbiter.HoldStartedTimestamp, StrokeAnchorTimestamp = arbiter.StrokeAnchorTimestamp });
            bool submitted = false;
            if (forecast.HasDecision)
                submitted = arbiter.Submit(new(outputBefore.SessionGeneration, outputBefore.ShotToken, index, ticks, ticks,
                    forecast.TimeToTargetMs ?? 0, forecast.Confidence, forecast.UncertaintyMs, forecast.Acquired && !forecast.InvalidateAttempt)
                    { WithdrawPendingForecast = forecast.WithdrawPendingForecast, ContinueCommittedAction = forecast.ContinueCommittedAction && !forecast.InvalidateAttempt }, ticks);
            rows.Add(new { index, found, ms, signal, simulatedContinuedHold = hypothetical,
                simulatedScheduledHold = new { forecast, submitted, status = arbiter.Status, rightY = arbiter.Output.RightY, receipt = arbiter.LastAction } }); index++;
        }
        File.WriteAllText(output, JsonSerializer.Serialize(rows, new JsonSerializerOptions(JsonSerializerDefaults.Web) { IncludeFields = true, WriteIndented = true }));
        Console.WriteLine($"SUCCESS Inspected {rows.Count} {originalWidth}×{originalHeight} frames at {scale}× scale ({w}×{h}), without pose/OCR/model inputs or device output: {output}");
    }
    private static void VerifyEdges(byte[] original,int w,int h,int stride,NbaMeterDetector.Measurement meter)
    {
        int left=(int)(meter.Bounds.Left*w),top=(int)(meter.Bounds.Top*h),pw=(int)(meter.Bounds.Width*w),ph=(int)(meter.Bounds.Height*h);
        byte[] patch=new byte[pw*ph*4];
        for(int y=0;y<ph;y++)Buffer.BlockCopy(original,(top+y)*stride+left*4,patch,y*pw*4,pw*4);
        foreach(bool mirror in new[]{false,true})
        {
            var frame=new byte[stride*h];
            int x0=mirror?w-pw:0,y0=(h-ph)/2;
            Blit(frame,x0,y0,mirror);
            var found=new NbaMeterDetector(new()).Detect(frame,w,h,stride);
            if(found is null || found.Value.Progress<.35)throw new Exception($"An edge-translated/mirrored real meter was lost (mirror={mirror}, patch={pw}x{ph}, found={found}).");
            Blit(frame,mirror?0:w-pw,y0,mirror);
            var duplicate = new NbaMeterDetector(new());
            if(duplicate.Detect(frame,w,h,stride) is not null || !duplicate.Ambiguous)throw new Exception("Two identical meters did not explicitly reject ambiguous acquisition.");
        }
        Console.WriteLine("SUCCESS Real-frame augmentations: left/right viewport edges, mirrored curve and ambiguous duplicate meter.");
        void Blit(byte[] frame,int x0,int y0,bool mirror)
        {for(int y=0;y<ph;y++)for(int x=0;x<pw;x++)Buffer.BlockCopy(patch,(y*pw+(mirror?pw-x-1:x))*4,frame,(y0+y)*stride+(x0+x)*4,4);}
    }
    internal static void Resolution(string directory)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "session.json")));
        var root = document.RootElement;
        var stream = root.GetProperty("captureEvidence").GetProperty("streams").EnumerateArray().Single(s => s.GetProperty("name").GetString() == "scene");
        int sw = stream.GetProperty("width").GetInt32(), sh = stream.GetProperty("height").GetInt32(), ss = stream.GetProperty("stride").GetInt32();
        byte[] source = new byte[ss * sh];
        using var file = File.OpenRead(Path.Combine(directory, stream.GetProperty("file").GetString()!));
        foreach (int scale in new[] { 1, 2 })
        {
            int w = sw * scale, h = sh * scale, stride = w * 4;
            byte[] pixels = new byte[stride * h];
            var detector = new NbaMeterDetector(new());
            NbaMeterDetector.Measurement? clean = null;
            for (int index = 74; index <= 90; index++)
            {
                var scene = root.GetProperty("frames")[index].GetProperty("evidence").EnumerateArray().Single(e => e.GetProperty("name").GetString() == "scene");
                file.Position = scene.GetProperty("offsetBytes").GetInt64(); file.ReadExactly(source);
                for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                    Buffer.BlockCopy(source, (y / scale) * ss + (x / scale) * 4, pixels, y * stride + x * 4, 4);
                clean = detector.Detect(pixels, w, h, stride);
            }
            if (clean is not { Progress: > .65 } meter) throw new Exception("The real-frame resolution fixture has no rising fill.");
            // One 720p pixel (two native rows at 1440p), representing a compression break.
            // The same small break must not turn an already 75%-filled meter into a half-filled one.
            int gap = (int)(meter.TargetY + meter.Height * .52), left = (int)(meter.Bounds.Left * w), right = (int)((meter.Bounds.Left + meter.Bounds.Width) * w);
            for (int y = gap; y < gap + scale; y++) for (int x = left; x < right; x++)
                pixels.AsSpan(y * stride + x * 4, 4).Fill(70);
            var broken = detector.Detect(pixels, w, h, stride);
            Console.WriteLine($"Real meter {w}x{h}: clean={meter.Progress:P1}, small fill gap={broken?.Progress:P1}");
            if (broken is null || broken.Value.Progress < meter.Progress - .1)
                throw new Exception($"A resolution-scaled compression gap broke fill tracking at {w}x{h}.");
            for (int y = gap; y < gap + scale * 4; y++) for (int x = left; x < right; x++)
                pixels.AsSpan(y * stride + x * 4, 4).Fill(70);
            var separated = detector.Detect(pixels, w, h, stride);
            if (separated is { Progress: > .6 })
                throw new Exception("The fill tracker bridged a genuinely detached bright region.");
        }
        Console.WriteLine("SUCCESS Real-frame 720p/1440p fill continuity across a small scaled compression gap.");
    }
    internal static void Calibration()
    {
        var p = new Nba2K27ShotProfile(Guid.NewGuid(), "Fixture", 83, 91, "Base", "Upper 1", "Upper 2", true, "Push");
        var config = new NbaMeterSettings { Trigger = "physicalStick", Enabled = true, GameBuild = "2.0.0.12", CalibrationTrial = true };
        var settings = VisionSettings.Default with { CaptureSourceKey = "fixture-source" };
        string run = Guid.NewGuid().ToString("N");
        var observation = new VisionSignalObservation(1, 200, true, new(.2,.2,.1,.3), .8, 1, .002, 100, .9, 2, "fixture", CaptureWidth: 1280, CaptureHeight: 720);
        var feedback = JsonSerializer.SerializeToElement(new { timing = "excellent", tempo = "excellent" });
        VisionActionReceipt Receipt(long id) => new(id, 1, id, 100, 150, 190, 80, .5, config.Key(p,settings), run) { EligibleForFeedback = true, ActualStartedTimestamp = 100, ActualAnchorTimestamp = 150 };
        for(int i=1;i<=3;i++) config = config.Feedback(p, settings, feedback, Receipt(i), observation);
        if (config.Results.Any(r => r.CorrectionMs != settings.CorrectionMs || r.StrokeDurationMs != config.StrokeDurationMs
                || r.TuningContextKey != config.TuningContextKey(p, settings)))
            throw new Exception("Calibration feedback did not retain its actual timing settings for subsequent tuning.");
        if (config.TuningContextKey(p, settings) != (config with { StrokeDurationMs = 56 }).TuningContextKey(p, settings with { CorrectionMs = -8 }))
            throw new Exception("Tuning history could not span correction/stroke changes.");
        if (config.TuningContextKey(p, settings) == config.TuningContextKey(p, settings with { EstimatedVideoDelayMs = 1 }))
            throw new Exception("Tuning history combined different latency settings.");
        if(config.Accepted(p,settings)) throw new Exception("Unconfirmed results enabled assistance.");
        Reject(() => config.Feedback(p, settings, feedback, Receipt(3), observation), "Duplicate feedback was accepted.");
        config = config.Feedback(p,settings,JsonSerializer.SerializeToElement(new { confirmOnly = true }),Receipt(3),observation);
        if(!config.Accepted(p,settings)) throw new Exception("Three confirmed matching results were not accepted.");
        var direct = settings with { CaptureSourceKey = "xhome-fixture-console" };
        if (config.Accepted(p, direct) || config.TuningContextKey(p, direct) == config.TuningContextKey(p, settings))
            throw new Exception("Window evidence qualified the direct Xbox source.");
        if (!config.Accepted(p, settings)) throw new Exception("Switching sources discarded accepted window evidence.");
        if(config.Accepted(p,settings with { TempoCorrectionMs = 100 })) throw new Exception("Tempo edits retained calibration.");
        if(config.Key(p, settings) == config.Key(p, settings with { TempoCorrectionMs = 100 })) throw new Exception("Tempo correction was absent from action identity.");
        if((config with { Results = config.Results.Select(r => r with { TempoCorrectionMs = null, EffectiveStrokeDurationMs = null }).ToArray() }).Accepted(p, settings))
            throw new Exception("Legacy results with unknown effective duration retained calibration.");
        Reject(() => config.Feedback(p, settings, feedback, Receipt(90) with { Outcome = VisionActionOutcome.Cancelled }, observation), "Cancelled action calibrated.");
        Reject(() => config.Feedback(p, settings, feedback, Receipt(91) with { EligibleForFeedback = false }, observation), "Unvalidated output calibrated.");
        Reject(() => config.Feedback(p, settings, feedback, Receipt(92) with { StrokeDurationMs = 156 }, observation), "Different effective stroke calibrated.");
        Reject(() => config.Feedback(p, settings, feedback, Receipt(93) with { StreamTelemetry = new("unstable", "spike", false, 30, null, 2) }, observation), "Unstable stream calibrated.");
        if(config.Accepted(p,settings with { EstimatedVideoDelayMs = 1 })) throw new Exception("Timing edits retained calibration.");
        if((config with { CalibratedWidth = 2560 }).Accepted(p,settings)) throw new Exception("Results from different resolutions were combined.");
        if(config.Accepted(p with { ShotSpeed = 2 },settings)) throw new Exception("Changed shot profile retained calibration.");
        var rhythmOnly = config with { Results = [], Confirmed = false, CalibrationTrial = true };
        var rhythmFeedback = JsonSerializer.SerializeToElement(new { timing = "excellent", tempo = "none", shotType = "rhythm" });
        for (int i = 101; i <= 103; i++) rhythmOnly = rhythmOnly.Feedback(p, settings, rhythmFeedback, Receipt(i), observation);
        if (rhythmOnly.Results.Any(r => r.ShotType != "rhythm" || r.Tempo != "none") || rhythmOnly.Accepted(p, settings))
            throw new Exception("Combined Rhythm feedback was changed into a fabricated tempo or confirmed automatically.");
        rhythmOnly = rhythmOnly.Feedback(p, settings, JsonSerializer.SerializeToElement(new { confirmOnly = true }), Receipt(103), observation);
        if (!rhythmOnly.Accepted(p, settings)) throw new Exception("Three explicitly confirmed RHYTHM Excellent results without separate tempo could not calibrate.");
        var described = JsonSerializer.SerializeToElement(((IVisionCaptureProfile)p).DescribeLiveAssistance(settings with { PluginAssistance = rhythmOnly.Export() }));
        if (described.GetProperty("successfulTrials").GetInt32() != 3) throw new Exception("The practice counter disagreed with combined Rhythm acceptance.");
        var timingOnly = config with { Results = [], Confirmed = true };
        var timingFeedback = JsonSerializer.SerializeToElement(new { timing = "excellent", tempo = "none", shotType = "timing" });
        for (int i = 201; i <= 203; i++) timingOnly = timingOnly.Feedback(p, settings, timingFeedback, Receipt(i), observation);
        if ((timingOnly with { Confirmed = true }).Accepted(p, settings)) throw new Exception("Plain TIMING Excellent falsely confirmed rhythm calibration.");
        Reject(() => timingOnly.Feedback(p, settings, JsonSerializer.SerializeToElement(new { timing = "excellent", tempo = "excellent", shotType = "timing" }), Receipt(204), observation),
            "Contradictory TIMING feedback with a tempo grade was accepted.");
        var forged = ((IVisionCaptureProfile)p).ConfigureLiveAssistance(settings with { PluginAssistance = new NbaMeterSettings().Export() }, config.Export());
        if(forged.Deserialize<NbaMeterSettings>(NbaMeterSettings.Json)!.Results.Length != 0) throw new Exception("UI configuration manufactured action receipts.");
        var changed = ((IVisionCaptureProfile)p).ConfigureLiveAssistance(settings with { PluginAssistance = config.Export() },
            (config with { StrokeDurationMs = 56, Results = [] }).Export()).Deserialize<NbaMeterSettings>(NbaMeterSettings.Json)!;
        if (!changed.Results.SequenceEqual(config.Results) || changed.Accepted(p, settings))
            throw new Exception("Configuring the next trial lost prior results or counted results from different timings.");
        using var predictor = ((IVisionCaptureProfile)p).CreateLivePredictor(settings with { PluginAssistance = config.Export() })!;
        byte[] frame = new byte[1280*720*4];
        predictor.Observe(frame,1280,720,5120,1,1,200,new(null,0,1,0,0,false));
        if(!predictor.CanArm) throw new Exception("Matching calibration required a tag, pose or neural model.");
        predictor.Observe(new byte[640*360*4],640,360,2560,2,2,300,new(null,0,2,0,0,false));
        if(predictor.CanArm) throw new Exception("Changed capture size retained output permission.");
        var empty = new NbaMeterDetector(new());
        for(int y=100;y<108;y++)for(int x=200;x<210;x++){int o=y*5120+x*4;frame[o+1]=220;}
        if(empty.Detect(frame,1280,720,5120) is not null) throw new Exception("A lone colored patch was mistaken for a meter.");
        // Synthetic meter session height persistence: after locking a 150 px meter cleanly on Shot 1,
        // Reset() (between-shot release) retains session height while ResetSession() clears it:
        byte[] sFrame = new byte[1280 * 720 * 4];
        for (int y = 0; y < 720; y++) for (int x = 0; x < 1280; x++) { int o = y * 5120 + x * 4; sFrame[o] = 32; sFrame[o + 1] = 28; sFrame[o + 2] = 24; sFrame[o + 3] = 255; }
        double mX = 640, mY = 240, trueH = 150, mBow = 30, mEnd = -12;
        for (int dy = -5; dy <= 7; dy++) for (int dx = -8; dx <= 8; dx++) { int o = (int)(mY + dy) * 5120 + (int)(mX + dx) * 4; sFrame[o] = 40; sFrame[o + 1] = 220; sFrame[o + 2] = 40; }
        for (double dh = 7; dh <= trueH; dh += 1)
        {
            double t = dh / trueH, cx = mX + mBow * 4 * t * (1 - t) + mEnd * t;
            byte lum = dh >= trueH * 0.55 ? (byte)195 : (byte)120;
            for (int dx = -7; dx <= 7; dx++) { int o = (int)Math.Round(mY + dh) * 5120 + (int)Math.Round(cx + dx) * 4; sFrame[o] = lum; sFrame[o + 1] = lum; sFrame[o + 2] = lum; }
        }
        var firstShot = empty.Detect(sFrame, 1280, 720, 5120) ?? throw new Exception("Synthetic meter was not detected.");
        empty.Reset();
        var secondShot = empty.Detect(sFrame, 1280, 720, 5120) ?? throw new Exception("Repeated shot meter was not detected.");
        if (Math.Abs(secondShot.Height - firstShot.Height) > firstShot.Height * .10)
            throw new Exception($"Between-shot Reset drifted meter height ({firstShot.Height:F1} -> {secondShot.Height:F1}).");
        empty.ResetSession();
        if (NbaMeterSettings.Read(VisionSettings.Default).Trigger != "largeRight"
            || NbaMeterSettings.Parse(JsonSerializer.SerializeToElement(new { confirmed = false })).Trigger != "largeRight"
            || NbaMeterSettings.Parse(JsonSerializer.SerializeToElement(new { confirmed = true })).Trigger != "physicalStick"
            || NbaMeterSettings.Parse(JsonSerializer.SerializeToElement(new { confirmed = true, trigger = "smallLeft" })).Trigger != "smallLeft")
            throw new Exception("Fresh or saved rhythm trigger selected the wrong input.");
        foreach (var control in ControlMap.All)
        {
            string id = JsonNamingPolicy.CamelCase.ConvertName(control.ToString());
            var binding = config with { Trigger = id };
            binding.Validate();
            if (binding.Action(p, settings).TriggerControl != control)
                throw new Exception($"Shot control {id} did not round trip.");
        }
        var paddleSettings = config with { Trigger = "largeRight" };
        paddleSettings.Validate();
        if (paddleSettings.Action(p, settings).TriggerControl != ControlId.LargeRight)
            throw new Exception("Paddle trigger did not map to LargeRight.");
        if (paddleSettings.Key(p, settings) == config.Key(p, settings))
            throw new Exception("Changing the shot trigger did not isolate calibration keys.");
        Reject(() => (config with { Trigger = "invalidPaddle" }).Validate(), "Unsupported trigger was accepted.");
        using var paddlePredictor = ((IVisionCaptureProfile)p).CreateLivePredictor(settings with { PluginAssistance = paddleSettings.Export() })!;
        var idleObserve = paddlePredictor.Observe(frame, 1280, 720, 5120, 1, 1, Stopwatch.GetTimestamp(),
            new(default(ControllerState), Stopwatch.GetTimestamp(), 1, 0, 0, false));
        if (idleObserve.Message != "Waiting for your assigned shot control.")
            throw new Exception("Paddle predictor did not wait for the configured paddle.");
        long holdTs = Stopwatch.GetTimestamp();
        var paddleObserve = paddlePredictor.Observe(frame, 1280, 720, 5120, 2, 1, holdTs,
            new(default(ControllerState), holdTs, 1, 1, holdTs, true) { HoldStartedTimestamp = holdTs, HeldPaddles = PaddleButtons.LargeRight });
        if (paddleObserve.Message == "Waiting for your assigned shot control.")
            throw new Exception("Paddle predictor ignored a held LargeRight paddle when the right stick stayed centered.");
        Console.WriteLine("SUCCESS Meter calibration: no tag/model prerequisite, native receipt provenance, duplicate/result/context/resolution guards and explicit confirmation.");
    }
    private static void Reject(Action action,string message) { try {action();} catch(InvalidDataException){return;} throw new Exception(message); }
}
