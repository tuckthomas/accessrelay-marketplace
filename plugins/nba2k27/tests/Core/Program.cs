using EliteScriptStudio.Core;

if (args is ["--meter-forecast"]) { MeterForecastChecks.Run(); return; }
if (args is ["--meter-continuity"]) { MeterContinuityChecks.Run(); return; }
if (args is ["--meter-fixtures", var oldMeterSession, var armedMeterDiagnostic, var heldMeterReplay])
{ MeterDetectorFixtureChecks.Run(oldMeterSession, armedMeterDiagnostic, heldMeterReplay); return; }
if (args is ["--meter-diagnostic", var diagnosticDirectory, var diagnosticOutput])
{ MeterDiagnosticChecks.Inspect(diagnosticDirectory, diagnosticOutput); return; }
if (args is ["--meter-diagnostic", var directoryWithRefs, var outputWithRefs, var savedReferences])
{ MeterDiagnosticChecks.Inspect(directoryWithRefs, outputWithRefs, savedReferences); return; }
if (args is ["--meter-diagnostic", var clip, var offsetReport, var refs, var correction])
{ MeterDiagnosticChecks.Inspect(clip, offsetReport, refs, effectiveCorrection: double.Parse(correction, System.Globalization.CultureInfo.InvariantCulture)); return; }

if (args is ["--meter-controller-replay", var fullDiagnostic, var controllerReport])
{ MeterDiagnosticChecks.Inspect(fullDiagnostic, controllerReport, useLoggedSignals: true); return; }
if (args is ["--meter-observation-replay", var archive, var landmarks, var pixelReport, var observationReport])
{ MeterDiagnosticChecks.Inspect(archive, observationReport, landmarks, pixelReport: pixelReport); return; }
if (args is ["--meter-tracking-replay", var trackClip, var trackRefs, var images, var trackReport, var offset])
{ MeterDiagnosticChecks.Inspect(trackClip, trackReport, trackRefs, pixelReport: images, preferImages: true,
    effectiveCorrection: double.Parse(offset, System.Globalization.CultureInfo.InvariantCulture)); return; }
if (args is ["--meter-prefixes", var observed, var curves, var leadReport])
{ MeterPrefixChecks.Run(observed, curves, leadReport); return; }

if (args is ["--meter-calibration"]) { MeterChecks.Calibration(); return; }

if (args is ["--meter-recorded", var meterDirectory, var meterOutput])
{ MeterChecks.Inspect(meterDirectory, meterOutput); return; }

if (args is ["--meter-recorded-scale", var scaleDirectory, var scaleOutput, var scale])
{ MeterChecks.Inspect(scaleDirectory, scaleOutput, int.Parse(scale)); return; }

if (args is ["--meter-resolution", var resolutionDirectory])
{ MeterChecks.Resolution(resolutionDirectory); return; }

if (args is ["--inspect-acquisition", var bitmap, var observation, var report])
{
    AutomaticIdentityChecks.InspectAcquisition(bitmap, observation, report);
    return;
}

if (args is ["--inspect-calibration", var takeDirectory, var outputPath])
{
    AutomaticIdentityChecks.InspectCalibration(takeDirectory, outputPath);
    return;
}

if (args is ["--capture-anchors"])
{
    NbaCaptureAnchorChecks.Run();
    return;
}

if (args is ["--court-only"])
{
    AutomaticIdentityChecks.CheckCourt();
    return;
}

if (args is ["--game-plugin"])
{
    Nba2K27ShotProfileVerification.Run();
    Console.WriteLine("SUCCESS Game plugin profile contracts and saved-profile compatibility.");
    return;
}

Nba2K27ShotProfileVerification.Run();
FeedbackChecks.Run();
MeterChecks.Calibration();
MeterContinuityChecks.Run();
MeterForecastChecks.Run();
Console.WriteLine("SUCCESS NBA profile compatibility and controller feedback checks.");
