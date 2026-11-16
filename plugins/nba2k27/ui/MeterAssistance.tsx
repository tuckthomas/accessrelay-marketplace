import { React, useEffect, useRef, useState, Button, Card, Field, Input, Notice, Select, SelectOption,
  ProfilePicker, GameplayPreview, Icon, useUnsavedChanges, type VisionWorkspaceProps } from './host.js';
import { adjustMeterCalibration, successfulMeterResult } from './MeterCalibration.js';

export const meterDefaults = { version: 1, enabled: true, inputMode: 'rhythm', trigger: 'largeRight', style: 'curved', viewport: { left: 0, top: 0, width: 1, height: 1 },
  targetRed: 80, targetGreen: 210, targetBlue: 95, colorToleranceDegrees: 30, holdMs: 70, acquisitionWindowMs: 800, strokeDurationMs: 56, anchorFraction: .85,
  upHoldMs: 48, targetProgress: .75, smoothStroke: false, autoOcrTiming: true, calibrationTrial: false, confirmed: false, gameBuild: '', results: [], calibratedWidth: 0, calibratedHeight: 0 };
export function meterArguments(configuration: any, settings: any) {
  return { configuration, videoDelayMs: settings.estimatedVideoDelayMs ?? 0, inputDelayMs: settings.estimatedInputDelayMs ?? 0,
    correctionMs: settings.correctionMs ?? 0, minimumConfidence: settings.minimumConfidence ?? .65,
    maximumUncertaintyMs: settings.maximumUncertaintyMs ?? 12, shootButton: settings.shootButton ?? 'x' };
}
const fmt = (v: any, digits = 1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const triggerLabels: Record<string, string> = { largeRight: 'P4 · Large right paddle', largeLeft: 'P3 · Large left paddle',
  smallRight: 'P2 · Small right paddle', smallLeft: 'P1 · Small left paddle', physicalStick: 'Right stick (browser Remote Play)' };
const timingOptions = [['early', 'Early'], ['slightlyEarly', 'Slightly early'], ['excellent', 'Excellent'], ['slightlyLate', 'Slightly late'], ['late', 'Late']];
const tempoOptions = [['none', 'No tempo shown'], ['fast', 'Fast'], ['slightlyFast', 'Slightly fast'], ['excellent', 'Excellent'], ['slightlySlow', 'Slightly slow'], ['slow', 'Slow']];
const initialConfig = (s: any) => {
  const p = s.pluginAssistance;
  const hasExcellent = p?.results?.some((r: any) => successfulMeterResult(r, p.inputMode));
  const legacyUncalibrated = p && !p.confirmed && !hasExcellent && (p.inputMode ?? 'rhythm') === 'rhythm'
    && (p.targetProgress === 1 || p.targetProgress === .88);
  const legacyStick = p && p.confirmed && !p.trigger ? { trigger: 'physicalStick' } : {};
  return { ...meterDefaults, ...p, ...legacyStick, ...(legacyUncalibrated ? { strokeDurationMs: 56, anchorFraction: .85, targetProgress: .75 } : {}),
    enabled: true, gameBuild: p?.gameBuild || s.trainingCapture?.gameBuild || '' };
};
const initialTiming = (s: any) => {
  const p = s.pluginAssistance;
  const hasExcellent = p?.results?.some((r: any) => successfulMeterResult(r, p.inputMode));
  const uncalibrated = !p?.confirmed && !hasExcellent;
  const zeroDelays = (s.estimatedVideoDelayMs ?? 0) === 0 && (s.estimatedInputDelayMs ?? 0) === 0 && (s.correctionMs ?? 0) === 0;
  const legacyLateTarget = uncalibrated && (p?.inputMode ?? 'rhythm') === 'rhythm' && (p?.targetProgress === 1 || p?.targetProgress === .88);
  return { ...s, minimumConfidence: p?.enabled ? s.minimumConfidence : .65,
    maximumUncertaintyMs: p?.enabled ? s.maximumUncertaintyMs : 12,
    ...(uncalibrated && zeroDelays ? { estimatedVideoDelayMs: 60, estimatedInputDelayMs: 15 } : {}),
    ...(legacyLateTarget && (s.correctionMs ?? 0) < 0 ? { correctionMs: 0 } : {}) };
};
type PracticeTrial = { active: boolean; before: string; pauseStarted: boolean; pausePromise: Promise<string> | null };
type AssistanceStart = { epoch: number; cancelled: boolean; armAttempted: boolean; trial: PracticeTrial };
const practiceTrial = (before = ''): PracticeTrial => ({ active: false, before, pauseStarted: false, pausePromise: null });
const emptySettings = {};

export function MeterAssistance({ state = {}, status, command, captureWindow, editProfile }: VisionWorkspaceProps & { editProfile: (profile?: any) => void }) {
  const saved = state.settings ?? emptySettings, s = status ?? state.status ?? {}, session = s.session ?? {}, signal = s.signal ?? {}, profile = state.selectedProfile;
  const [config, setConfig] = useState<any>(() => initialConfig(saved)), [timing, setTiming] = useState<any>(() => initialTiming(saved));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [feedback, setFeedback] = useState({ timing: '', tempo: '', shotType: '' }), [skipped, setSkipped] = useState('');
  const [savedResult, setSavedResult] = useState('');
  const [autoSubmitPractice, setAutoSubmitPractice] = useState(false);
  const autoAppliedReceipt = useRef('');
  const [resultMessage, setResultMessage] = useState('');
  const [adjustmentFailed, setAdjustmentFailed] = useState(false);
  const savingFeedback = useRef(false);
  const appliedAdjustment = useRef<{ correctionMs: number; strokeDurationMs: number } | null>(null);
  const [connectionConfirmed, setConnectionConfirmed] = useState(false);
  const trial = useRef<PracticeTrial>(practiceTrial());
  const commandRef = useRef(command), lifecycle = useRef({ mounted: false, epoch: 0 });
  const starting = useRef<AssistanceStart | null>(null);
  commandRef.current = command;
  useEffect(() => {
    lifecycle.current.mounted = true; lifecycle.current.epoch++;
    return () => {
      lifecycle.current.mounted = false; lifecycle.current.epoch++;
      const pending = starting.current;
      if (pending) { pending.cancelled = true; void cleanupStart(pending); }
      else if (trial.current.active) void pauseTrial(trial.current);
    };
  }, []);
  useUnsavedChanges(dirty);
  useEffect(() => {
    if (dirty) return;
    const expected = appliedAdjustment.current;
    if (expected && (saved.correctionMs !== expected.correctionMs || saved.pluginAssistance?.strokeDurationMs !== expected.strokeDurationMs)) return;
    appliedAdjustment.current = null;
    setConfig(initialConfig(saved)); setTiming(initialTiming(saved));
  }, [saved, dirty]);
  const locked = !!session.running || !!s.stopping || (!!s.diagnosticRecording && !s.diagnosticRecording.isFinalized), working = !!busy || !!s.busy;
  const output = s.output ?? {}, calibration = state.assistance ?? {}, receipt = s.lastAction;
  const diagnostic = s.diagnosticRecording, recordingDiagnostics = !!diagnostic?.isRecording;
  const savingDiagnostics = !!diagnostic && !diagnostic.isRecording && !diagnostic.isFinalized;
  const signature = receipt ? `${receipt.runId}:${receipt.id}` : '';
  const matching = !!receipt && receipt.configurationKey === calibration.key;
  const used = (calibration.currentResults ?? []).some((r: any) => r.receiptId === receipt?.id && r.runId === receipt?.runId);
  const connected = s.controllerConnection?.connected ?? connectionConfirmed;
  const inputMissing = s.controllerConnection?.inputConnected === false;
  const source = s.selectedSourceId ?? state.selectedSourceId;
  const differentSize = session.captureWidth > 0 && config.calibratedWidth > 0
    && (session.captureWidth !== config.calibratedWidth || session.captureHeight !== config.calibratedHeight);
  const accepted = !!calibration.accepted && !differentSize, successes = differentSize ? 0 : calibration.successfulTrials ?? 0;
  const awaitingFeedback = !accepted && matching && !used && signature !== skipped;
  const ocr = s.ocrFeedback;
  const ocrMatches = !!ocr && !!receipt && ocr.receiptId === receipt.id && ocr.runId === receipt.runId;
  useEffect(() => { setFeedback({ timing: '', tempo: '', shotType: '' }); }, [signature]);
  useEffect(() => {
    if (!awaitingFeedback || !ocrMatches || !config.autoOcrTiming) return;
    const nextFeedback = {
      shotType: config.inputMode === 'rhythm' ? (ocr.shotType || 'rhythm') : '',
      timing: ocr.timing || '',
      tempo: config.inputMode === 'rhythm' ? (ocr.shotType === 'timing' ? 'none' : (ocr.tempo || 'none')) : 'none'
    };
    setFeedback(old => (old.timing || old.shotType ? old : nextFeedback));
    if (autoSubmitPractice && autoAppliedReceipt.current !== signature && nextFeedback.timing && (config.inputMode !== 'rhythm' || (nextFeedback.shotType && nextFeedback.tempo))) {
      autoAppliedReceipt.current = signature;
      void (async () => {
        await saveFeedbackWith(nextFeedback);
        if (config.inputMode !== 'rhythm' || nextFeedback.shotType === 'rhythm') {
          try { await run('armedSet', { armed: true }); trial.current.active = true; } catch { /* shown in UI */ }
        }
      })();
    }
  }, [awaitingFeedback, ocrMatches, signature, config.autoOcrTiming, autoSubmitPractice]);

  async function run(action: string, args?: any) {
    if (lifecycle.current.mounted) { setBusy(action); setError(''); }
    try { return await commandRef.current(action, args); }
    catch (e) { if (lifecycle.current.mounted) setError(e instanceof Error ? e.message : String(e)); throw e; }
    finally { if (lifecycle.current.mounted) setBusy(''); }
  }
  const invoke = (action: string, args?: any) => { void run(action, args).catch(() => {}); };
  async function pauseTrial(owner: PracticeTrial, force = false): Promise<string> {
    if (owner.pausePromise) { const message = await owner.pausePromise; if (!force) return message; }
    if (!owner.active && !force) return '';
    owner.pauseStarted = true;
    if (lifecycle.current.mounted) setBusy('armedSet');
    owner.pausePromise = (async () => {
      try { await commandRef.current('armedSet', { armed: false }); owner.active = false; return ''; }
      catch (e) {
        let message = `Could not pause automatic reversal: ${e instanceof Error ? e.message : String(e)}`;
        try { await commandRef.current('stop'); owner.active = false; message += ' Preview stopped to disable assistance.'; }
        catch (stopError) { message += ` Preview could not be stopped: ${stopError instanceof Error ? stopError.message : String(stopError)}`; }
        if (lifecycle.current.mounted) setError(message);
        return message;
      }
    })();
    try { return await owner.pausePromise; }
    finally { owner.pausePromise = null; if (lifecycle.current.mounted) setBusy(''); }
  }
  function startOperation() {
    const operation: AssistanceStart = { epoch: lifecycle.current.epoch, cancelled: false, armAttempted: false, trial: practiceTrial(signature) };
    starting.current = operation; return operation;
  }
  const currentStart = (operation: AssistanceStart) => lifecycle.current.mounted && !operation.cancelled
    && operation.epoch === lifecycle.current.epoch && starting.current === operation;
  async function cleanupStart(operation: AssistanceStart, afterArm = false) {
    const errors: string[] = [];
    if (operation.armAttempted) { const message = await pauseTrial(operation.trial, afterArm || !operation.trial.active); if (message) errors.push(message); }
    return errors;
  }
  function cancelStart() { if (starting.current) starting.current.cancelled = true; }
  async function pauseAssistance() {
    cancelStart();
    await pauseTrial(trial.current, true);
  }
  async function stopPreview() {
    cancelStart();
    try { await run('stop'); trial.current.active = false; }
    catch { /* Keep ownership so navigation can retry disabling this trial. */ }
  }
  // Pause only a practice trial explicitly started here after its new native receipt.
  // Opening the page or receiving an old receipt never changes controller output.
  useEffect(() => {
    if (!trial.current.active || trial.current.pauseStarted || !matching || signature === trial.current.before) return;
    void pauseTrial(trial.current);
  }, [signature, matching]);
  const edit = (key: string, value: any) => { setConfig((old: any) => ({ ...old, [key]: value })); setDirty(true); };
  const editTiming = (key: string, value: number) => { setTiming((old: any) => ({ ...old, [key]: value })); setDirty(true); };
  async function save(next = config, restart = false) {
    if (appliedAdjustment.current) appliedAdjustment.current = { correctionMs: timing.correctionMs ?? 0, strokeDurationMs: next.strokeDurationMs };
    await run('signalConfigure', { ...meterArguments(next, timing), restart }); setConfig(next); setDirty(false);
    if (savedResult) setResultMessage('Result saved. Timing settings applied for the next trial. Start the next practice trial when ready.');
    setAdjustmentFailed(false);
  }
  async function preview() {
    try { await save({ ...config, calibrationTrial: !accepted }); await run('start', { loadModel: true }); } catch { /* shown beside actions */ }
  }
  async function connect() {
    try { const result = await run('connectOutput'); if (result?.connected === true) setConnectionConfirmed(true); } catch { /* shown beside actions */ }
  }
  async function begin() {
    setSavedResult('');
    const operation = startOperation();
    trial.current = operation.trial; operation.trial.active = !accepted; operation.armAttempted = true;
    try {
      await run('armedSet', { armed: true });
      if (!currentStart(operation)) await cleanupStart(operation, true);
    } catch { await cleanupStart(operation, true); }
    finally { if (starting.current === operation) starting.current = null; }
  }
  async function saveFeedbackWith(chosen = feedback) {
    if (savingFeedback.current) return;
    savingFeedback.current = true;
    setAdjustmentFailed(false);
    let resultSaved = false;
    try {
      cancelStart();
      if (output.armed) await run('armedSet', { armed: false });
      trial.current.active = false;
      await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId,
        feedback: config.inputMode === 'rhythm' ? chosen : { timing: chosen.timing, tempo: 'none' } });
      resultSaved = true;
      setSkipped(signature); setSavedResult(signature);
      const adjustment = adjustMeterCalibration(config, timing, chosen, calibration.tuningContextKey);
      setFeedback({ timing: '', tempo: '', shotType: '' });
      if (adjustment.changed) {
        // Save the receipt against its original settings first. The host retains
        // that history when configuring the next trial and restarts disarmed.
        setDirty(true); setConfig(adjustment.configuration); setTiming(adjustment.timing);
        appliedAdjustment.current = { correctionMs: adjustment.timing.correctionMs, strokeDurationMs: adjustment.configuration.strokeDurationMs };
        await run('signalConfigure', { ...meterArguments(adjustment.configuration, adjustment.timing), restart: true });
        setDirty(false);
      }
      setResultMessage(`Result saved. ${adjustment.message} Start the next practice trial when ready.`);
    } catch {
      if (resultSaved) {
        setAdjustmentFailed(true);
        setResultMessage('Result saved, but the next-trial adjustment could not be applied. Retry the adjustment before starting another trial.');
      }
      // Keep selections if saving failed; keep the proposed settings if applying failed.
    } finally { savingFeedback.current = false; }
  }
  async function confirm() {
    try {
      cancelStart();
      if (output.armed) await run('armedSet', { armed: false });
      trial.current.active = false;
      await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId, feedback: { confirmOnly: true } });
      await save({ ...config, calibrationTrial: false }, true);
    } catch { /* shown beside actions */ }
  }
  const ready = session.running && session.canArm && connected && !inputMissing && !dirty && !s.stopping;
  const prepare = session.running && !accepted && (!saved.pluginAssistance?.calibrationTrial
    || (saved.pluginAssistance?.targetProgress != null && saved.pluginAssistance.targetProgress !== config.targetProgress));
  const nextStep = !profile ? 'Choose your shot profile.' : !profile.usesShotMeter ? 'Enable the shot meter in this profile and in NBA 2K27.'
    : !source ? 'Choose the Remote Play window above.' : !session.running ? 'Start the preview to check your gameplay.'
    : session.sourceStale ? 'Resume the Remote Play stream in your browser.' : inputMissing ? 'Connect your physical controller.'
    : dirty ? 'Apply or discard your settings changes before starting a trial.'
    : !connected ? 'Connect controller output below.' : prepare ? 'Prepare the preview for practice calibration.'
    : !accepted && successes >= 3 ? matching ? 'Three matching results are saved. Save this calibration to continue.' : 'Complete a trial in this session to confirm your saved results.'
    : !session.canArm ? session.message || 'Waiting for live capture.' : accepted
      ? 'Start assistance to enable automatic reversal.' : 'Start a practice trial to enable one automatic reversal.';
  function number(label: string, key: string, min: number, max: number, step = 1) {
    return <Field key={key} label={label}><Input type="number" min={min} max={max} step={step} value={config[key]}
      disabled={working || !!output.armed} onChange={e => edit(key, e.target.value === '' ? NaN : +e.target.value)} /></Field>;
  }
  return <div className="page-stack meter-workflow"><style>{styles}</style>
    <Card title="Shot setup"><div className="meter-profile-row">
      <ProfilePicker label="Shot profile" value={profile?.id ?? ''} disabled={locked || working || dirty}
        options={[{ id: '', name: 'Choose a shot profile', disabled: true }, ...(state.profiles ?? [])]}
        onSelect={id => invoke('profileSelect', { id })} onCreate={() => editProfile()} />
      <Button disabled={!profile || locked || working || dirty} onClick={() => editProfile(profile)}><Icon name="pencil" size={16} />Edit profile</Button>
      <Field label="Shooting input"><Select value={config.inputMode} disabled={locked || working} onValueChange={v => edit('inputMode', v)}>
        <SelectOption value="rhythm">Rhythm · right stick</SelectOption><SelectOption value="button">Shoot button</SelectOption></Select></Field>
      {config.inputMode === 'rhythm' && <Field label="Shot trigger"><Select value={config.trigger ?? 'largeRight'} disabled={locked || working} onValueChange={v => edit('trigger', v)}>
        {Object.entries(triggerLabels).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>}
    </div>{profile && <p className="subtle meter-profile-summary">{profile.cameraView} camera · {profile.meterReleaseType || 'Release cue not set'} · {profile.usesShotMeter ? 'Meter on' : 'Meter off'}</p>}
    {config.inputMode === 'rhythm' && (config.trigger ?? 'largeRight') !== 'physicalStick' && <p className="subtle meter-profile-summary">Paddle trigger: map the selected paddle to its PC Profile Numpad key in Xbox Accessories so the Xbox app ignores it and Studio drives the full virtual stick stroke. Keep the physical right stick centered.</p>}</Card>
    <div className="meter-layout">
      <div className="meter-capture"><GameplayPreview status={s} window={captureWindow} onError={setError} actions={locked
        ? <Button active={!!session.running} disabled={!!s.stopping} onClick={() => void stopPreview()}>Stop preview</Button>
        : <Button active={false} disabled={working || !profile?.usesShotMeter || !source} busy={busy === 'start'} onClick={() => void preview()}>Start preview</Button>} />
        <Card title="Diagnostic recording" description="Save gameplay frames and detection telemetry for up to 15 seconds.">
          <p className="subtle">{output.armed
            ? accepted
              ? 'Automatic reversal is on. Recording captures your live assisted shots.'
              : 'Automatic reversal is on for one practice shot. Recording captures your shot; assistance still pauses after it finishes.'
            : 'Automatic reversal is off. Recording captures observations only — start assistance or a practice trial first to record with assistance on.'}</p>
          <div className="button-group"><Button active={recordingDiagnostics} disabled={savingDiagnostics || (!recordingDiagnostics && (working || !session.running || !!s.stopping || !!s.training?.isRecording))}
            busy={busy === 'diagnosticStart'} onClick={() => invoke(recordingDiagnostics ? 'diagnosticStop' : 'diagnosticStart')}>
            {recordingDiagnostics ? 'Stop diagnostic recording' : 'Record diagnostics'}</Button>
            {diagnostic?.isFinalized && <Button disabled={working} onClick={() => invoke('openDiagnosticFolder')}>Open diagnostic folder</Button>}
          </div>
          {diagnostic && <div role="status" aria-live="polite"><p>{diagnostic.message}</p>
            <p className="subtle">{diagnostic.observedFrames ?? 0} frames analyzed · {diagnostic.storedFrames ?? 0} images saved · {diagnostic.droppedFrames ?? 0} images skipped</p></div>}
          {diagnostic?.failed && <Notice tone="danger">The diagnostic recording could not finish. Open its folder to inspect any saved evidence.</Notice>}
        </Card>
        <details className="meter-diagnostics"><summary>Detection details</summary><p role="status">{signal.message || 'Detection runs when you hold the shooting input.'}</p>
          <div className="meter-readings">{[['Fill', `${fmt(signal.progress * 100)}%`], ['Predicted target', `${fmt(signal.timeToTargetMs)} ms`],
            ['Fill velocity', signal.continueCommittedAction ? '—' : `${fmt(signal.velocityPerMs * 1000 * 100)}% / s`], ['Samples', signal.samples ?? 0],
            ['Action phase', signal.continueCommittedAction ? output.armed ? 'Finishing anchored stroke' : 'Observation only — assistance off'
              : signal.invalidateAttempt ? 'Attempt cancelled' : signal.timeToTargetMs != null ? output.armed ? 'Live forecast' : 'Observation only — assistance off' : 'Observing'],
            ['Uncertainty', signal.continueCommittedAction ? '—' : `${fmt(signal.uncertaintyMs)} ms`], ['Processing', `${fmt(signal.processingMs, 2)} ms`], ['Geometry score', fmt(signal.confidence, 2)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></details>
      </div>
      <Card title={accepted ? 'Meter assistance' : 'Calibrate your shot'} className="meter-practice">
        <div className="meter-readiness" aria-label="Connection readiness">
          <div><span>Gameplay</span><strong>{session.sourceStale ? 'Stream paused' : session.running ? 'Capture running' : 'Preview stopped'}</strong></div>
          <div><span>Controller output</span>{connected ? <strong className="meter-connected"><Icon name="check" size={17} />Connected</strong>
            : <Button active={false} disabled={working || inputMissing} busy={busy === 'connectOutput'} onClick={() => void connect()}>{busy === 'connectOutput' ? 'Connecting…' : 'Connect controller'}</Button>}</div>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        {savedResult && (!signature || savedResult === signature) && resultMessage && <Notice tone="info">{resultMessage}</Notice>}
        {adjustmentFailed && dirty && <Button disabled={working || !!output.armed} onClick={() => { void save(config, true).catch(() => {}); }}>Retry adjustment</Button>}
        {!output.armed && !awaitingFeedback && <p role="status">{nextStep}</p>}
        {output.armed ? <div className="stack"><Notice tone="info">{accepted ? 'Meter assistance is on.'
          : config.inputMode === 'rhythm' && (config.trigger ?? 'largeRight') !== 'physicalStick'
            ? `Take one stationary shot. Hold ${triggerLabels[config.trigger ?? 'largeRight'] ?? 'the selected paddle'} down through the automatic reversal, then release it. Keep the right stick centered.`
            : 'Take one stationary shot. Hold the right stick down through the automatic reversal, then return to neutral.'}</Notice>
          {output.message && <p role="status">{output.message}</p>}
          <Button active={true} onClick={() => void pauseAssistance()}>Pause {accepted ? 'assistance' : 'trial'}</Button></div>
          : !awaitingFeedback && (accepted || successes < 3 || !matching) && <Button active={false} className="meter-primary" disabled={working || (prepare ? !connected || dirty : !ready)} busy={busy === 'armedSet'}
            onClick={() => { if (prepare) { void save({ ...config, calibrationTrial: true }, true).catch(() => {}); } else void begin(); }}>
            <Icon name="play" size={18} />{prepare ? 'Prepare calibration' : accepted ? 'Start assistance' : 'Start practice trial'}</Button>}
        {!accepted && <>
          <div className="meter-progress" aria-label={`${successes} of 3 matching Excellent results`}><strong>{successes} of 3</strong><span>matching Excellent results</span></div>
          {awaitingFeedback ? <div className="meter-feedback"><h3>What did NBA 2K27 report?</h3><p className="subtle">{config.inputMode === 'rhythm'
            ? "Copy the game's feedback heading and result. RHYTHM Excellent counts without a separate tempo grade. TIMING alone does not confirm a rhythm shot."
            : 'Enter the timing shown by the game. Saving adjusts the next trial; Excellent settings stay unchanged.'}</p>
            {config.inputMode === 'rhythm' && <Field label="Feedback heading"><Select value={feedback.shotType} disabled={working}
              onValueChange={v => setFeedback(old => ({ ...old, shotType: v, tempo: v === 'timing' ? 'none' : old.tempo || 'none' }))}>
              <SelectOption value="" disabled>Choose heading…</SelectOption><SelectOption value="rhythm">RHYTHM</SelectOption><SelectOption value="timing">TIMING</SelectOption></Select></Field>}
            <Field label="Shot timing"><Select value={feedback.timing} disabled={working} onValueChange={v => setFeedback(old => ({ ...old, timing: v }))}>
              <SelectOption value="" disabled>Choose timing…</SelectOption>{timingOptions.map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>
            {config.inputMode === 'rhythm' && <Field label="Shot tempo"><Select value={feedback.tempo} disabled={working || feedback.shotType === 'timing'} onValueChange={v => setFeedback(old => ({ ...old, tempo: v }))}>
              <SelectOption value="" disabled>Choose tempo…</SelectOption>{tempoOptions.map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>}
            <div className="button-group"><Button variant="primary" busy={busy === 'signalFeedback'} disabled={working || dirty || !feedback.timing || (config.inputMode === 'rhythm' && (!feedback.shotType || !feedback.tempo))} onClick={() => void saveFeedbackWith()}>Save result</Button>
              <Button disabled={working} onClick={() => { setSkipped(signature); setFeedback({ timing: '', tempo: '', shotType: '' }); }}>Skip this result</Button></div></div>
            : <p className="subtle">{used ? 'Result saved. Start another practice trial when ready.' : 'Shot feedback appears here after Studio completes a controller action.'}</p>}
          {successes >= 3 && <Button variant="primary" disabled={working || !matching || awaitingFeedback} onClick={() => void confirm()}>Save calibration</Button>}
        </>}
        {accepted && <p className="subtle">Calibration saved for this profile, capture size and timing setup.</p>}
        <div className="meter-ocr-box">
          <label className="meter-ocr-toggle"><input type="checkbox" checked={config.autoOcrTiming !== false} disabled={working || !!output.armed}
            onChange={e => { const next = { ...config, autoOcrTiming: e.target.checked }; setConfig(next); if (profile) void save(next, true).catch(() => {}); }} />
            <span>Auto-adapt timing from shot feedback (OCR)</span></label>
          {!accepted && <label className="meter-ocr-toggle"><input type="checkbox" checked={autoSubmitPractice} disabled={working || config.autoOcrTiming === false}
            onChange={e => setAutoSubmitPractice(e.target.checked)} />
            <span>Auto-save OCR practice results &amp; re-arm</span></label>}
          {ocr?.message && <p className="subtle" role="status">{ocr.message}{ocr.rawText ? ` (${ocr.rawText})` : ''}</p>}
        </div>
      </Card>
    </div>
    <details className="meter-advanced"><summary>Advanced settings</summary><Card title="Timing & detection">
      <div className="form-grid"><Field label="Game build"><Input value={config.gameBuild} maxLength={80} disabled={working || !!output.armed} onChange={e => edit('gameBuild', e.target.value)} /></Field>
        {number('Stroke duration · ms', 'strokeDurationMs', 8, 500)}
        {number('Timing anchor · axis fraction', 'anchorFraction', 0, 1, .05)}{number('Full-up hold · ms', 'upHoldMs', 0, 500)}
        {number('Hold qualification · ms', 'holdMs', 0, 250)}{number('Target fill', 'targetProgress', .7, 1.1, .01)}
        <Field label="Stroke curve"><Select value={config.smoothStroke ? 'smooth' : 'linear'} disabled={working || !!output.armed} onValueChange={v => edit('smoothStroke', v === 'smooth')}>
          <SelectOption value="linear">Linear</SelectOption><SelectOption value="smooth">Smooth</SelectOption></Select></Field>
        {(['estimatedVideoDelayMs', 'estimatedInputDelayMs', 'correctionMs', 'maximumUncertaintyMs', 'minimumConfidence'] as const).map((key, i) => <Field key={key}
          label={['Video delay estimate · ms', 'Input delay estimate · ms', 'Timing correction · ms', 'Maximum uncertainty · ms', 'Minimum geometry score'][i]}>
          <Input type="number" min={key === 'correctionMs' ? -1000 : 0} max={key === 'minimumConfidence' ? 1 : 1000} step={key === 'minimumConfidence' ? .05 : 1}
            value={timing[key] ?? 0} disabled={working || !!output.armed} onChange={e => editTiming(key, e.target.value === '' ? NaN : +e.target.value)} /></Field>)}
        {config.inputMode === 'button' && <Field label="Shoot button"><Select value={timing.shootButton ?? 'x'} disabled={working || !!output.armed}
          onValueChange={v => { setTiming((old: any) => ({ ...old, shootButton: v })); setDirty(true); }}>{[['x','X'],['y','Y'],['a','A'],['b','B'],['leftBumper','LB'],['rightBumper','RB']].map(([value,label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>}
      </div><p className="subtle">A 0.5 timing anchor is the neutral crossing. Negative timing correction sends earlier; positive sends later. Applying changes pauses assistance and resumes the preview.</p>
      <details><summary>Meter appearance & gameplay viewport</summary><div className="form-grid">
        {number('Acquisition window · ms', 'acquisitionWindowMs', 100, 3000)}{number('Target red', 'targetRed', 0, 255)}{number('Target green', 'targetGreen', 0, 255)}
        {number('Target blue', 'targetBlue', 0, 255)}{number('Hue tolerance · degrees', 'colorToleranceDegrees', 5, 60)}
        {['left', 'top', 'width', 'height'].map(key => <Field key={key} label={`Gameplay ${key} · fraction`}><Input type="number" min={0} max={1} step={.01} value={config.viewport[key]}
          disabled={working || !!output.armed} onChange={e => edit('viewport', { ...config.viewport, [key]: +e.target.value })} /></Field>)}</div></details>
      <div className="button-group"><Button variant="primary" disabled={working || !!output.armed || !profile || !dirty} busy={busy === 'signalConfigure'}
        onClick={() => { void save(config, true).catch(() => {}); }}>Apply settings</Button>{dirty && <Button disabled={working} onClick={() => {
          appliedAdjustment.current = null; setDirty(false); setAdjustmentFailed(false);
          if (savedResult) setResultMessage('Result saved. Proposed timing changes discarded. The previous timing settings will be used.');
        }}>Discard changes</Button>}</div>
    </Card></details>
  </div>;
}

const styles = `
.meter-profile-row{display:flex;align-items:end;gap:16px;flex-wrap:wrap}.meter-profile-row>.field,.meter-profile-row>.profile-picker{flex:1;min-width:220px}.meter-profile-summary{margin:16px 0 0}
.meter-layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(340px,.85fr);gap:20px;align-items:start}.meter-layout>*{min-width:0}.meter-capture{display:grid;gap:16px}
.meter-readiness{display:grid;margin-bottom:16px}.meter-readiness>div{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:52px;padding:10px 0;border-bottom:1px solid var(--line)}
.meter-connected{display:flex;align-items:center;gap:6px;color:var(--success)}.meter-primary{width:100%;margin:4px 0 12px}.meter-progress{display:flex;align-items:baseline;gap:10px;padding:16px 0;border-bottom:1px solid var(--line)}
.meter-progress strong{font-size:24px}.meter-progress span{font-size:14px;color:var(--muted)}.meter-feedback{display:grid;gap:12px;margin-top:16px}.meter-feedback h3,.meter-feedback p{margin:0}
.meter-diagnostics,.meter-advanced{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:16px}.meter-diagnostics summary,.meter-advanced>summary{cursor:pointer;font-weight:600;font-size:14px}
.meter-advanced[open]>summary{margin-bottom:16px}.meter-advanced>.card{border:0;padding:8px 0 0}.meter-readings{display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:12px;margin-top:16px}
.meter-readings>div{display:grid;gap:6px}.meter-readings span{font-size:14px;color:var(--muted)}
.meter-ocr-box{display:grid;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.meter-ocr-toggle{display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer}.meter-ocr-box p{margin:0}
@media(max-width:1080px){.meter-layout{grid-template-columns:minmax(0,1fr)}}
`;
