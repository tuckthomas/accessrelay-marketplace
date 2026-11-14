using EliteScriptStudio.Core;

if (args is ["--meter-calibration"]) { MeterChecks.Calibration(); return; }

if (args is ["--meter-recorded", var meterDirectory, var meterOutput])
{ MeterChecks.Inspect(meterDirectory, meterOutput); return; }

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
Console.WriteLine("SUCCESS NBA profile compatibility and controller feedback checks.");
