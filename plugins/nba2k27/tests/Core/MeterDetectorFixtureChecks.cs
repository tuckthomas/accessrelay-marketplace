using System.IO.Compression;
using System.Text.Json;
using EliteScriptStudio.Packs.Nba2K27;

/// <summary>Reviewed real-image regressions; no controller output, inferred labels or fabricated video history.</summary>
internal static class MeterDetectorFixtureChecks
{
    internal static void Run(string oldSessionDirectory, string armedDiagnosticDirectory, string heldReplayReport)
    {
        ColdDiagnosticFrames(armedDiagnosticDirectory);
        FragmentedCap(oldSessionDirectory);
        CompletedReplay(heldReplayReport);
        Console.WriteLine("SUCCESS Real-image meter fixtures: HUD rejection, cold acquisition, cap-fragment continuity, fill endpoint, close-meter ambiguity and three distinct simulated completed strokes.");
    }

    private static void ColdDiagnosticFrames(string directory)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "diagnostic.json")));
        var frames = document.RootElement.GetProperty("frames").EnumerateArray().ToArray();
        // These specific images were visually reviewed: green Excellent feedback with no shot meter.
        foreach (long sequence in new long[] { 925, 931, 1079, 576, 583 })
        {
            var frame = frames.Single(f => f.GetProperty("sequence").GetInt64() == sequence);
            int width = frame.GetProperty("width").GetInt32(), height = frame.GetProperty("height").GetInt32();
            int stride = frame.GetProperty("stride").GetInt32();
            byte[] pixels = new byte[checked(stride * height)];
            string file = frame.GetProperty("file").GetString() ?? throw new InvalidDataException($"Fixture {sequence} has no retained image.");
            using (var gzip = new GZipStream(File.OpenRead(Path.Combine(directory, file)), CompressionMode.Decompress))
            {
                gzip.ReadExactly(pixels);
                Check(gzip.ReadByte() == -1, $"Fixture {sequence} does not contain exactly one native BGRA frame.");
            }
            var detector = new NbaMeterDetector(new()); // No prior tracked shape or signal metadata.
            var result = detector.Detect(pixels, width, height, stride);
            if (sequence is 925 or 931 or 1079)
                Check(result is null, $"Green feedback/poster pixels were acquired as a meter in cold frame {sequence}: {result}.");
            else
                Check(result is { } meter && meter.TargetY > height * .25 && meter.Progress is > 0 and < .65,
                    $"The actual cold meter was lost or located in the HUD in frame {sequence}: {result}.");
        }
    }

    private static void FragmentedCap(string directory)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "session.json")));
        var root = document.RootElement;
        var stream = root.GetProperty("captureEvidence").GetProperty("streams").EnumerateArray().Single(s => s.GetProperty("name").GetString() == "scene");
        int sw = stream.GetProperty("width").GetInt32(), sh = stream.GetProperty("height").GetInt32(), ss = stream.GetProperty("stride").GetInt32();
        byte[] source = new byte[checked(ss * sh)];
        using var file = File.OpenRead(Path.Combine(directory, stream.GetProperty("file").GetString()!));
        // 2x is a nearest-neighbor resolution augmentation of the same original footage,
        // not an independent capture or interpolation of missing temporal observations.
        foreach (int scale in new[] { 1, 2 })
        {
            int width = sw * scale, height = sh * scale, stride = scale == 1 ? ss : width * 4;
            byte[] pixels = scale == 1 ? source : new byte[checked(stride * height)];
            var detector = new NbaMeterDetector(new());
            NbaMeterDetector.Measurement? before = null, fragmented = null;
            double maximumLateFill = 0;
            for (int index = 74; index <= 102; index++)
            {
                var evidence = root.GetProperty("frames")[index].GetProperty("evidence").EnumerateArray().Single(e => e.GetProperty("name").GetString() == "scene");
                Check(evidence.GetProperty("byteLength").GetInt32() == source.Length, "Original scene geometry changed inside the fixture.");
                file.Position = evidence.GetProperty("offsetBytes").GetInt64(); file.ReadExactly(source);
                if (scale != 1)
                {
                    for (int y = 0; y < sh; y++)
                    {
                        for (int x = 0; x < sw; x++) for (int dx = 0; dx < scale; dx++)
                            Buffer.BlockCopy(source, y * ss + x * 4, pixels, (y * scale) * stride + (x * scale + dx) * 4, 4);
                        for (int dy = 1; dy < scale; dy++) Buffer.BlockCopy(pixels, (y * scale) * stride, pixels, (y * scale + dy) * stride, stride);
                    }
                }
                var found = detector.Detect(pixels, width, height, stride);
                if (index == 74 && scale == 1 && found is { } early) NearbyIndependentMeters(pixels, width, height, stride, early);
                if (index == 96) before = found;
                if (index == 97) fragmented = found;
                if (index >= 95 && found is { } late) maximumLateFill = Math.Max(maximumLateFill, late.Progress);
            }
            Check(before is { } previous && fragmented is { } current && current.Height / previous.Height is >= .8 and <= 1.2,
                $"The fragmented green cap collapsed or expanded the observed ribbon at {scale}x: before={before}, after={fragmented}.");
            Check(maximumLateFill >= .97, $"The real full interior still stops short of the measurable fill endpoint at {scale}x: {maximumLateFill:P1}.");
        }
    }

    private static void NearbyIndependentMeters(byte[] source, int width, int height, int stride, NbaMeterDetector.Measurement meter)
    {
        double min = meter.TargetX, max = meter.TargetX;
        for (int i = 0; i <= 100; i++)
        {
            double t = i / 100d, x = meter.TargetX + meter.Bow * 4 * t * (1 - t) + meter.End * t;
            min = Math.Min(min, x); max = Math.Max(max, x);
        }
        // Preserve the whole ribbon/cap plus the sampling margin; the detached input tick is not needed.
        int left = Math.Max(0, (int)Math.Floor(min - meter.Thickness * .7));
        int right = Math.Min(width, (int)Math.Ceiling(max + meter.Thickness * .7));
        int top = Math.Max(0, (int)Math.Floor(meter.TargetY - meter.Thickness));
        int bottom = Math.Min(height, (int)Math.Ceiling(meter.TargetY + meter.Height + meter.Thickness));
        int pw = right - left, ph = bottom - top, separation = pw + 2;
        Check(separation < height * .06, "The close-meter fixture no longer exercises the former screen-height grouping threshold.");
        var combined = new byte[stride * height];
        int x0 = width / 3, y0 = height / 3;
        Blit(x0);
        Check(new NbaMeterDetector(new()).Detect(combined, width, height, stride) is not null,
            "The translated close-meter fixture clipped the original ribbon.");
        Blit(x0 + separation);
        var detector = new NbaMeterDetector(new());
        Check(detector.Detect(combined, width, height, stride) is null && detector.Ambiguous,
            "Two distinct, unoccluded nearby meters were merged as cap fragments.");
        void Blit(int x)
        {
            for (int y = 0; y < ph; y++) Buffer.BlockCopy(source, (top + y) * stride + left * 4, combined, (y0 + y) * stride + x * 4, pw * 4);
        }
    }

    private static void CompletedReplay(string path)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var rows = document.RootElement.GetProperty("rows").EnumerateArray().ToArray();
        var receipts = new Dictionary<(string Run, long Id), JsonElement>();
        long lastSequence = -1, lastTicks = -1;
        foreach (var row in rows)
        {
            long sequence = row.GetProperty("seq").GetInt64(), ticks = row.GetProperty("ticks").GetInt64();
            Check(sequence > lastSequence && ticks > lastTicks, "Replay duplicated or reordered retained observations.");
            lastSequence = sequence; lastTicks = ticks;
            if (row.GetProperty("found") is { ValueKind: JsonValueKind.Object } found)
                Check(found.GetProperty("targetY").GetDouble() > row.GetProperty("signal").GetProperty("captureHeight").GetInt32() * .25,
                    $"Replay acquired the upper HUD in sequence {sequence}.");
            if (row.GetProperty("receipt") is { ValueKind: JsonValueKind.Object } receipt)
                receipts[(receipt.GetProperty("runId").GetString()!, receipt.GetProperty("id").GetInt64())] = receipt;
        }
        Check(receipts.Count == 3, $"Expected three distinct completed native simulated actions, received {receipts.Count}.");
        Check(receipts.Values.Select(r => r.GetProperty("shotToken").GetInt64()).Distinct().Count() == 3, "Different action receipts reused a shot token.");
        foreach (var receipt in receipts.Values)
            Check(receipt.GetProperty("startedTimestamp").GetInt64() < receipt.GetProperty("anchorTimestamp").GetInt64()
                && receipt.GetProperty("anchorTimestamp").GetInt64() < receipt.GetProperty("completedTimestamp").GetInt64(),
                "A completed action receipt lost its start/anchor/completion order.");
    }

    private static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
}
