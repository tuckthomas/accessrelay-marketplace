using EliteScriptStudio.Vision;

if (args is ["--meter-color-replay", var replay, var models, var replayRuntime, var report])
{
    MeterColorReplay.Run(replay, models, replayRuntime, report);
    return;
}

if (args is ["--prepare-recorded-scene", var sceneRuntime, var sceneAssets, var sceneDirectory])
{
    AutomaticCaptureModelChecks.PrepareScene(sceneRuntime, sceneAssets, sceneDirectory);
    return;
}

if (args is ["--trace-recorded-scene", var traceRuntime, var traceAssets, var traceDirectory, var traceOutput])
{
    AutomaticCaptureModelChecks.TraceScene(traceRuntime, traceAssets, traceDirectory, traceOutput);
    return;
}

if (args is ["--pose-suppression-only"])
{
    AutomaticCaptureModelChecks.CheckPoseSuppression();
    return;
}

if (args is ["--acquisition-worker", var acquisitionEvidence])
{
    TrainingPluginChecks.CheckAcquisitionWorker(acquisitionEvidence);
    return;
}

if (args is ["--automatic-gameplay-frame", var gameRuntime, var gameAssets, var gameImage, var gameOutput])
{
    AutomaticCaptureModelChecks.ProbeFrame(gameRuntime, gameAssets, gameImage, gameOutput);
    return;
}

if (args is ["--automatic-capture-models", var runtimeRoot, var assets, var fixtureDirectory, var provider])
{
    AutomaticCaptureModelChecks.Run(runtimeRoot, assets, fixtureDirectory, provider);
    return;
}

if (args is ["--training-plugin-only", var trainingEvidence])
{
    TrainingPluginChecks.Run(trainingEvidence);
    return;
}

if (args is ["--datasets"]) { DatasetChecks.Run(); return; }
throw new ArgumentException("Choose a plugin verification case; these checks do not operate automatically on live gameplay.");
