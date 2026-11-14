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
                new(physicalHold, ticks, outputBefore.SessionGeneration, outputBefore.ShotToken, outputBefore.ShotStartedTimestamp, true));
            bool submitted = false;
            if (forecast.TimeToTargetMs.HasValue || forecast.InvalidateAttempt)
                submitted = arbiter.Submit(new(outputBefore.SessionGeneration, outputBefore.ShotToken, index, ticks, ticks,
                    forecast.TimeToTargetMs ?? 0, forecast.Confidence, forecast.UncertaintyMs, forecast.Acquired && !forecast.InvalidateAttempt), ticks);
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
            if(new NbaMeterDetector(new()).Detect(frame,w,h,stride) is not null)throw new Exception("Two identical meters did not reject ambiguous acquisition.");
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
        var config = new NbaMeterSettings { Enabled = true, GameBuild = "2.0.0.12", CalibrationTrial = true };
        var settings = VisionSettings.Default with { CaptureSourceKey = "fixture-source" };
        string run = Guid.NewGuid().ToString("N");
        var observation = new VisionSignalObservation(1, 200, true, new(.2,.2,.1,.3), .8, 1, .002, 100, .9, 2, "fixture", CaptureWidth: 1280, CaptureHeight: 720);
        var feedback = JsonSerializer.SerializeToElement(new { timing = "excellent", tempo = "excellent" });
        VisionActionReceipt Receipt(long id) => new(id, 1, id, 100, 150, 190, 80, .5, config.Key(p,settings), run);
        for(int i=1;i<=3;i++) config = config.Feedback(p, settings, feedback, Receipt(i), observation);
        if(config.Accepted(p,settings)) throw new Exception("Unconfirmed results enabled assistance.");
        Reject(() => config.Feedback(p, settings, feedback, Receipt(3), observation), "Duplicate feedback was accepted.");
        config = config.Feedback(p,settings,JsonSerializer.SerializeToElement(new { confirmOnly = true }),Receipt(3),observation);
        if(!config.Accepted(p,settings)) throw new Exception("Three confirmed matching results were not accepted.");
        if(config.Accepted(p,settings with { EstimatedVideoDelayMs = 1 })) throw new Exception("Timing edits retained calibration.");
        if((config with { CalibratedWidth = 2560 }).Accepted(p,settings)) throw new Exception("Results from different resolutions were combined.");
        if(config.Accepted(p with { ShotSpeed = 2 },settings)) throw new Exception("Changed shot profile retained calibration.");
        var forged = ((IVisionCaptureProfile)p).ConfigureLiveAssistance(settings with { PluginAssistance = new NbaMeterSettings().Export() }, config.Export());
        if(forged.Deserialize<NbaMeterSettings>(NbaMeterSettings.Json)!.Results.Length != 0) throw new Exception("UI configuration manufactured action receipts.");
        using var predictor = ((IVisionCaptureProfile)p).CreateLivePredictor(settings with { PluginAssistance = config.Export() })!;
        byte[] frame = new byte[1280*720*4];
        predictor.Observe(frame,1280,720,5120,1,1,200,new(null,0,1,0,0,false));
        if(!predictor.CanArm) throw new Exception("Matching calibration required a tag, pose or neural model.");
        predictor.Observe(new byte[640*360*4],640,360,2560,2,2,300,new(null,0,2,0,0,false));
        if(predictor.CanArm) throw new Exception("Changed capture size retained output permission.");
        var empty = new NbaMeterDetector(new());
        for(int y=100;y<108;y++)for(int x=200;x<210;x++){int o=y*5120+x*4;frame[o+1]=220;}
        if(empty.Detect(frame,1280,720,5120) is not null) throw new Exception("A lone colored patch was mistaken for a meter.");
        Console.WriteLine("SUCCESS Meter calibration: no tag/model prerequisite, native receipt provenance, duplicate/result/context/resolution guards and explicit confirmation.");
    }
    private static void Reject(Action action,string message) { try {action();} catch(InvalidDataException){return;} throw new Exception(message); }
}
