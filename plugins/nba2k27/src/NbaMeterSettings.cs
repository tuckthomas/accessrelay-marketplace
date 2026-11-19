using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EliteScriptStudio.Core;

namespace EliteScriptStudio.Packs.Nba2K27;

internal sealed record NbaMeterCalibrationResult(long ReceiptId, string Key, string Timing, string Tempo, long CapturedAt, string RunId, int Width, int Height,
    string? TuningContextKey = null, double? CorrectionMs = null, double? StrokeDurationMs = null, string? ShotType = null, double? TempoCorrectionMs = null, double? EffectiveStrokeDurationMs = null);
internal sealed record NbaMeterSettings
{
    public int Version { get; init; } = 1;
    public bool Enabled { get; init; }
    public string InputMode { get; init; } = "rhythm";
    public string Trigger { get; init; } = "largeRight";
    public string Activation { get; init; } = "hold";
    public string Style { get; init; } = "curved";
    public VisionCrop Viewport { get; init; } = new(0, 0, 1, 1);
    public int TargetRed { get; init; } = 80;
    public int TargetGreen { get; init; } = 210;
    public int TargetBlue { get; init; } = 95;
    public double ColorToleranceDegrees { get; init; } = 30;
    public double HoldMs { get; init; } = 70;
    public double AcquisitionWindowMs { get; init; } = 800;
    public double StrokeDurationMs { get; init; } = 80;
    public double AnchorFraction { get; init; } = .5;
    public double UpHoldMs { get; init; } = 48;
    public double TargetProgress { get; init; } = 1;
    public bool SmoothStroke { get; init; }
    public bool AutoOcrTiming { get; init; } = true;
    // Accept the retired 2.1.10 field in strict JSON without carrying it into new saves.
    [System.Text.Json.Serialization.JsonIgnore]
    public int? PracticeDistanceFeet { get; init; }
    public bool CalibrationTrial { get; init; }
    public bool Confirmed { get; init; }
    public string GameBuild { get; init; } = "";
    public int CalibratedWidth { get; init; }
    public int CalibratedHeight { get; init; }
    public NbaMeterCalibrationResult[] Results { get; init; } = [];
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow };
    internal static NbaMeterSettings Read(VisionSettings settings) => settings.PluginAssistance is { } data
        ? Parse(data) : new();

    internal static NbaMeterSettings Parse(JsonElement data)
    {
        var meter = data.Deserialize<NbaMeterSettings>(Json) ?? throw new InvalidDataException("Meter settings are empty.");
        // Before paddle selection existed, confirmed profiles calibrated a physical stick hold.
        return meter.Confirmed && !data.EnumerateObject().Any(p => p.Name.Equals("trigger", StringComparison.OrdinalIgnoreCase))
            ? meter with { Trigger = "physicalStick" } : meter;
    }
    internal JsonElement Export() => JsonSerializer.SerializeToElement(this, Json);
    private static readonly Dictionary<string, ControlId> Controls = ControlMap.All.ToDictionary(
        id => JsonNamingPolicy.CamelCase.ConvertName(id.ToString()));
    private static readonly Dictionary<string, StickDirection> Directions = Enum.GetValues<StickDirection>().ToDictionary(
        direction => JsonNamingPolicy.CamelCase.ConvertName(direction.ToString()));
    internal void Validate()
    {
        Viewport.Validate();
        if (Version != 1 || InputMode is not ("button" or "rhythm") || Activation is not ("tap" or "hold")
            || (Trigger is null || (Trigger != "physicalStick" && !Controls.ContainsKey(Trigger) && !Directions.ContainsKey(Trigger)))
            || Style != "curved"
            || TargetRed is < 0 or > 255 || TargetGreen is < 0 or > 255 || TargetBlue is < 0 or > 255
            || !Between(ColorToleranceDegrees, 5, 60) || !Between(HoldMs, 0, 250) || !Between(AcquisitionWindowMs,100,3000)
            || !Between(StrokeDurationMs, 8, 500) || !Between(AnchorFraction, 0, 1)
            || !Between(UpHoldMs, 0, 500) || !Between(TargetProgress, .7, 1.1)
            || GameBuild is null || GameBuild.Length > 80 || GameBuild.Any(char.IsControl)
            || CalibratedWidth is < 0 or > 16384 || CalibratedHeight is < 0 or > 16384
            || Results is null || Results.Length > 64 || Results.Any(r => r is null || r.ReceiptId <= 0 || r.Key is null || r.Key.Length != 64 || r.RunId is null || r.RunId.Length != 32 || r.Width is <= 0 or > 16384 || r.Height is <= 0 or > 16384
                || r.Timing is not ("early" or "slightlyEarly" or "excellent" or "slightlyLate" or "late")
                || r.Tempo is not ("fast" or "slightlyFast" or "excellent" or "slightlySlow" or "slow" or "none")
                || r.TempoCorrectionMs is { } tempo && !Between(tempo, -200, 200)
                || r.EffectiveStrokeDurationMs is { } duration && !Between(duration, 8, 500)
                || r.ShotType is not (null or "rhythm" or "timing") || (r.ShotType == "timing" && r.Tempo != "none")))
            throw new InvalidDataException("Choose supported meter, input and calibration settings.");
    }
    internal string Key(Nba2K27ShotProfile profile, VisionSettings settings)
    {
        string value = JsonSerializer.Serialize(new { policy = "direct-curved-fill-v6", ConfigurationFingerprint = (profile with { Gamertag = "" }).ConfigurationFingerprint, profile.CameraView, InputMode, Trigger, Style,
            Viewport, TargetRed, TargetGreen, TargetBlue, ColorToleranceDegrees, HoldMs, AcquisitionWindowMs, StrokeDurationMs, AnchorFraction, UpHoldMs,
            TargetProgress, SmoothStroke, GameBuild, settings.CaptureSourceKey, settings.ShootButton, settings.MinimumConfidence, settings.MaximumUncertaintyMs,
            settings.MaximumFrameAgeMs, settings.MaximumLatenessMs, settings.EstimatedVideoDelayMs, settings.EstimatedInputDelayMs, settings.CorrectionMs, settings.TempoCorrectionMs, settings.TrainingCapture.ShotCategory }, Json);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    }
    internal double EffectiveStrokeMs(VisionSettings settings) => Math.Clamp(StrokeDurationMs + settings.TempoCorrectionMs, 8, 500);
    internal bool Accepted(Nba2K27ShotProfile profile, VisionSettings settings)
    {
        if (!Confirmed || string.IsNullOrWhiteSpace(GameBuild) || CalibratedWidth <= 0 || CalibratedHeight <= 0)
            return false;
        string key = Key(profile, settings);
        string tuningKey = TuningContextKey(profile, settings);
        return Results.Count(r => (!CalibrationTrial
                ? (r.TuningContextKey == tuningKey && r.StrokeDurationMs == StrokeDurationMs)
                : r.Key == key)
            && r.EffectiveStrokeDurationMs == EffectiveStrokeMs(settings) && r.TempoCorrectionMs == settings.TempoCorrectionMs
            && r.Width == CalibratedWidth && r.Height == CalibratedHeight && Successful(r)) >= 3;
    }
    internal bool Successful(NbaMeterCalibrationResult result) => result.Timing == "excellent" && (InputMode == "button"
        || (result.ShotType != "timing" && (result.Tempo == "excellent" || (result.ShotType == "rhythm" && result.Tempo == "none"))));
    // Group tuning evidence across the two adjustable values while retaining every
    // other profile, detector, capture and latency setting in its identity.
    internal string TuningContextKey(Nba2K27ShotProfile profile, VisionSettings settings) =>
        (this with { StrokeDurationMs = 80 }).Key(profile, settings with { CorrectionMs = 0 });
    internal VisionControllerAction Action(Nba2K27ShotProfile profile, VisionSettings settings) => new()
    {
        Kind = InputMode == "rhythm" ? VisionActionKind.RightStickStroke : VisionActionKind.ButtonRelease,
        TriggerControl = InputMode == "rhythm" && Controls.TryGetValue(Trigger, out var control) ? control : null,
        TriggerDirection = InputMode != "rhythm" ? null : Directions.TryGetValue(Trigger, out var direction) ? direction
            : Trigger == "physicalStick" && Activation == "tap" ? StickDirection.RightDown : null,
        ContinueAfterTriggerRelease = Activation == "tap",
        HoldQualificationMs = Activation == "tap" ? 0 : HoldMs,
        StrokeDurationMs = StrokeDurationMs, AnchorFraction = AnchorFraction, EndHoldMs = UpHoldMs,
        Curve = SmoothStroke ? VisionStrokeCurve.Smoothstep : VisionStrokeCurve.Linear, ConfigurationKey = Key(profile, settings)
    };
    private static bool Between(double value, double low, double high) => double.IsFinite(value) && value >= low && value <= high;
    internal NbaMeterSettings Feedback(Nba2K27ShotProfile profile, VisionSettings settings, JsonElement feedback, VisionActionReceipt receipt, VisionSignalObservation observation)
    {
        Validate();
        string key = Key(profile, settings);
        if (receipt.Outcome != VisionActionOutcome.Completed || !receipt.EligibleForFeedback
            || (InputMode == "rhythm" && receipt.StrokeDurationMs != EffectiveStrokeMs(settings))
            || receipt.StreamTelemetry is { State: "unstable" }
            || receipt.ConfigurationKey != key || receipt.RunId.Length != 32 || observation.CaptureWidth <= 0 || observation.CaptureHeight <= 0
            || observation.CaptureTimestamp < receipt.StartedTimestamp)
            throw new InvalidDataException("A new completed calibration action from this exact setup is required.");
        if (feedback.TryGetProperty("confirmOnly", out var only) && only.GetBoolean())
        {
            var confirmed = this with { Confirmed = true, CalibrationTrial = false };
            if (!confirmed.Accepted(profile, settings)) throw new InvalidDataException("Save three Excellent calibration results for this setup before confirming.");
            return confirmed;
        }
        if (Results.Any(r => r.ReceiptId == receipt.Id && r.RunId == receipt.RunId))
            throw new InvalidDataException("Feedback for this completed action is already saved.");
        string timing = feedback.GetProperty("timing").GetString() ?? "";
        string tempo = InputMode == "button" ? "none" : feedback.GetProperty("tempo").GetString() ?? "";
        string? shotType = feedback.TryGetProperty("shotType", out var heading) ? heading.GetString() : null;
        var result = new NbaMeterCalibrationResult(receipt.Id, key, timing, tempo, observation.CaptureTimestamp, receipt.RunId, observation.CaptureWidth, observation.CaptureHeight,
            TuningContextKey(profile, settings), settings.CorrectionMs, StrokeDurationMs, shotType, settings.TempoCorrectionMs, EffectiveStrokeMs(settings));
        var updated = this with { Results = Results.Append(result).TakeLast(64).ToArray(), Confirmed = false,
            CalibratedWidth = observation.CaptureWidth, CalibratedHeight = observation.CaptureHeight };
        updated.Validate();
        if (feedback.TryGetProperty("confirm", out var confirm) && confirm.GetBoolean())
        {
            updated = updated with { Confirmed = true, CalibrationTrial = false };
            if (!updated.Accepted(profile, settings)) throw new InvalidDataException("Save three Excellent calibration results for the same timing and tempo settings first.");
        }
        return updated;
    }
}
