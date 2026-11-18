using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using EliteScriptStudio.Core;
using EliteScriptStudio.Packs.Nba2K27;
using EliteScriptStudio.RemotePlay;
using EliteScriptStudio.Vision;
using Microsoft.ML.OnnxRuntime;

internal static class MeterColorReplay
{
    internal sealed record Frame(long Ticks, long Sequence, long Generation, DirectStreamMetrics? Direct, ControllerState? Physical, long? InputTicks, bool? Fresh);
    internal sealed record Hold(long Start, long End, long? ManualUp, long? ReferenceAnchor, bool Armed, bool Truncated);
    internal sealed record Tape(string Source, int Width, int Height, int SourceWidth, int SourceHeight, long Frequency,
        Frame[] Frames, Hold[] Holds, Nba2K27ShotProfile Profile, VisionSettings? Settings, bool SavedCalibration);
    private sealed record Pass(bool Gpu, double?[] Delay);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    internal static void Run(string folder, string models, string runtime, string output)
    {
        var tape = JsonSerializer.Deserialize<Tape>(File.ReadAllBytes(Path.Combine(folder, "timeline.json")), Json)!;
        if (tape.Frequency != Stopwatch.Frequency || tape.Frames.Length <= 30) throw new InvalidDataException("Invalid recording clock or length.");
        var clip = Path.Combine(folder, "clip.mkv");
        nint ort = NativeLibrary.Load(Path.Combine(runtime, "onnxruntime.dll"));
        OrtEnv.DisableDllImportResolver = true;
        NativeLibrary.SetDllImportResolver(typeof(OrtEnv).Assembly, (name, _, _) => name is "onnxruntime" or "onnxruntime.dll" ? ort : 0);
        GStreamerNative.Initialize();
        var passes = new List<Pass>();
        foreach (bool gpu in new[] { false, true, true, false, false, true })
        {
            var delay = new double?[tape.Frames.Length];
            var n = XboxColorConversionBenchmark.ReadClip(clip, gpu, tape.Width, tape.Height, delay.Length, true,
                (timing, _) => delay[timing.Index] = timing.ReadyMs);
            passes.Add(new(gpu, delay));
            Console.WriteLine($"{(gpu ? "GPU" : "CPU")} conversion: delivered {n}/{delay.Length} frames.");
        }
        var paths = new List<object>();
        var paired = new List<double>();
        var cpu = passes.Where(p => !p.Gpu).ToArray(); var accelerated = passes.Where(p => p.Gpu).ToArray();
        for (int r = 0; r < cpu.Length; r++)
            for (int i = 30; i < tape.Frames.Length; i++)
                if (cpu[r].Delay[i] is { } a && accelerated[r].Delay[i] is { } b) paired.Add(a - b);
        if (paired.Count == 0) throw new InvalidDataException("No common frames survived warm-up.");
        foreach (bool gpu in new[] { false, true })
        {
            string name = gpu ? "GPU" : "CPU";
            var times = passes.Where(p => p.Gpu == gpu).ToArray();
            var runs = new List<MeterStrokeReplay>();
            try
            {
                for (int r = 0; r < times.Length; r++)
                {
                    string snapshot = Path.Combine(folder, name + r);
                    var seed = Path.Combine(folder, "MeterTiming");
                    if (Directory.Exists(seed))
                    {
                        var target = Directory.CreateDirectory(Path.Combine(snapshot, "MeterTiming"));
                        foreach (string file in Directory.EnumerateFiles(seed, "*.json"))
                            File.Copy(file, Path.Combine(target.FullName, Path.GetFileName(file)));
                    }
                    runs.Add(new(tape, times[r].Delay, snapshot));
                }
                int probe = tape.Frames.Length / 2;
                byte[]? sample = null;
                XboxColorConversionBenchmark.ReadClip(clip, gpu, tape.Width, tape.Height, tape.Frames.Length, false, (timing, frame) =>
                {
                    foreach (var run in runs) run.Observe(timing.Index, frame);
                    if (timing.Index == probe) sample = frame.Pixels.ToArray();
                });
                var consumers = MeterFrameConsumers.Verify(sample!, tape.Width, tape.Height, models, Path.Combine(folder, name + "-consumer"));
                var measurements = times.SelectMany(p => p.Delay.Skip(30)).OfType<double>().ToArray();
                paths.Add(new { name, consumerFrameIndex = probe, sampleCount = measurements.Length, medianMs = Quantile(measurements, .5), p95Ms = Quantile(measurements, .95),
                    consumers, passes = times.Select((p, i) => new { delivered = p.Delay.Count(x => x.HasValue),
                        missing = Enumerable.Range(0, p.Delay.Length).Where(k => !p.Delay[k].HasValue).ToArray(), stroke = runs[i].Finish() }).ToArray() });
            }
            finally { foreach (var run in runs) run.Dispose(); }
        }
        using var input = File.OpenRead(clip);
        var report = new { tape.Source, tape.SavedCalibration, tape.SourceWidth, tape.SourceHeight, tape.Width, tape.Height, frames = tape.Frames.Length,
            encodedSha256 = Convert.ToHexStringLower(SHA256.HashData(input)), warmupFrames = 30, pairedSamples = paired.Count,
            pairedMedianMsSooner = Quantile(paired, .5), paths };
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
        File.WriteAllText(output, JsonSerializer.Serialize(report, Json));
        Console.WriteLine($"Paired median improvement {Quantile(paired, .5):F2} ms across {paired.Count} matched frame deliveries. Report: {output}");
    }

    internal static double Quantile(IEnumerable<double> values, double fraction)
    {
        var a = values.Order().ToArray();
        return a[(int)Math.Ceiling(fraction * a.Length) - 1];
    }
}
