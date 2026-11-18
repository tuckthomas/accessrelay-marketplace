using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text.Json;
using EliteScriptStudio;
using EliteScriptStudio.Core;
using EliteScriptStudio.Input;
using EliteScriptStudio.Packs.Nba2K27;
using EliteScriptStudio.Vision;

internal static class MeterFrameConsumers
{
    private sealed class Track : IDecodedVideoTrack, IDisposable
    {
        internal Action<DecodedBgraFrame>? Publish;
        public IDisposable Subscribe(Action<DecodedBgraFrame> onFrame, Action onEnded)
        {
            Volatile.Write(ref Publish, onFrame);
            return this;
        }
        public void Dispose() => Volatile.Write(ref Publish, null);
    }

    internal static object Verify(byte[] pixels, int width, int height, string models, string scratch)
    {
        using var input = new FakeControllerInput();
        using var runtime = new StudioRuntime(input, StudioProfile.CreateDefault(), new(0, 0));
        using var vision = new VisionSession(runtime);
        using var track = new Track();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        vision.SetPreviewEnabled(true);
        vision.StartDirect(track, VisionSettings.Default, loadModel: false);
        if (!SpinWait.SpinUntil(() => Volatile.Read(ref track.Publish) != null, 5000))
            throw new TimeoutException("The preview did not subscribe to the recorded frame.");
        int stride = checked(width * 4);
        var pin = GCHandle.Alloc(pixels, GCHandleType.Pinned);
        try
        {
            void Send() => track.Publish!(new(pin.AddrOfPinnedObject(), pixels.Length, stride, width, height));
            Send();
            if (!SpinWait.SpinUntil(() => vision.Status.Frames > 0, 5000)) throw new IOException("Preview timed out.");
            using var preview = vision.TakePreview();
            if (preview is null || preview.Width != width || preview.Height != height ||
                !pixels.AsSpan().SequenceEqual(preview.Pixels.AsSpan(0, preview.Length)))
                throw new IOException("The preview differs from the full source frame.");
            var request = vision.CaptureRegionOnceAsync(new(0, 0, 1, 1), timeout.Token);
            Send();
            var crop = request.GetAwaiter().GetResult();
            if (crop is null || crop.Width != width || crop.Height != height || !pixels.AsSpan().SequenceEqual(crop.Pixels))
                throw new IOException("The OCR crop request could not access the full picture.");
            vision.StartDiagnosticRecording(scratch, new { source = "Meter conversion comparison" });
            Send();
            if (!SpinWait.SpinUntil(() => vision.DiagnosticSnapshot?.ObservedFrames >= 1, 5000))
                throw new IOException("The diagnostic recorder missed the frame.");
            vision.StopDiagnosticRecording();
            vision.FinishDiagnosticRecordingAsync(timeout.Token).GetAwaiter().GetResult();
            var manifest = Directory.EnumerateFiles(scratch, "diagnostic.json", SearchOption.AllDirectories).Single();
            using var doc = JsonDocument.Parse(File.ReadAllBytes(manifest));
            var stored = doc.RootElement.GetProperty("frames").EnumerateArray().Single(f => f.GetProperty("file").ValueKind == JsonValueKind.String);
            using var file = File.OpenRead(Path.Combine(Path.GetDirectoryName(manifest)!, stored.GetProperty("file").GetString()!));
            using var gzip = new GZipStream(file, CompressionMode.Decompress);
            byte[] restored = new byte[pixels.Length]; gzip.ReadExactly(restored);
            if (gzip.ReadByte() != -1 || !pixels.AsSpan().SequenceEqual(restored) || runtime.HasOutput)
                throw new IOException("The recording failed its full-frame byte comparison.");
            using var reader = new VisionAnalysisModels(Nba2K27AutomaticCapture.Models, VisionExecutionProvider.Cpu, models, loadPose: false);
            var regions = reader.ReadText(crop.Pixels, crop.Width, crop.Height, crop.Stride);
            return new { width, height, bytes = pixels.Length, previewExact = true, ocrInputExact = true,
                ocrTextRegions = regions.Length, recordingExact = true };
        }
        finally { pin.Free(); }
    }
}
