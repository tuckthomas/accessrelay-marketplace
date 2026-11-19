import { React, useEffect, useRef, useState, Button, Card, Field, Input, Notice, Select, SelectOption,
  ProfilePicker, GameplayPreview, Icon, Checkbox, useUnsavedChanges, type VisionWorkspaceProps } from './host.js';
import { adjustMeterCalibration, successfulMeterResult } from './MeterCalibration.js';

export const meterDefaults = { version: 1, enabled: true, inputMode: 'rhythm', trigger: 'largeRight', activation: 'hold', style: 'curved', viewport: { left: 0, top: 0, width: 1, height: 1 },
  targetRed: 80, targetGreen: 210, targetBlue: 95, colorToleranceDegrees: 30, holdMs: 70, acquisitionWindowMs: 800, strokeDurationMs: 56, anchorFraction: .85,
  upHoldMs: 48, targetProgress: .75, smoothStroke: false, autoOcrTiming: true, calibrationTrial: false, confirmed: false, gameBuild: '', results: [], calibratedWidth: 0, calibratedHeight: 0 };
export function meterArguments(configuration: any, settings: any) {
  return { configuration, videoDelayMs: settings.estimatedVideoDelayMs ?? 0, inputDelayMs: settings.estimatedInputDelayMs ?? 0,
    correctionMs: settings.correctionMs ?? 0, tempoCorrectionMs: settings.tempoCorrectionMs ?? 0,
    minimumConfidence: settings.minimumConfidence ?? .65, maximumUncertaintyMs: settings.maximumUncertaintyMs ?? 12,
    shootButton: settings.shootButton ?? 'x', streamTelemetry: settings.streamTelemetry ?? { enabled: true, region: { left: .45, top: 0, width: .55, height: .22 } } };
}
const fmt = (v: any, digits = 1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const paddleTriggers = ['largeRight', 'largeLeft', 'smallRight', 'smallLeft'];
const triggerLabels: Record<string, string> = {
  a: 'A', b: 'B', x: 'X', y: 'Y', leftBumper: 'LB', rightBumper: 'RB', leftTrigger: 'LT', rightTrigger: 'RT',
  dPadUp: 'D-pad up', dPadDown: 'D-pad down', dPadLeft: 'D-pad left', dPadRight: 'D-pad right',
  leftStick: 'Left stick click', rightStick: 'Right stick click', menu: 'Menu', view: 'View',
  leftUp: 'Left stick up', leftDown: 'Left stick down', leftLeft: 'Left stick left', leftRight: 'Left stick right',
  rightUp: 'Right stick up', rightDown: 'Right stick down', rightLeft: 'Right stick left', rightRight: 'Right stick right',
  largeRight: 'P4 · Large right paddle', largeLeft: 'P3 · Large left paddle',
  smallRight: 'P2 · Small right paddle', smallLeft: 'P1 · Small left paddle', physicalStick: 'Physical right-stick down' };
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
  const [copying, setCopying] = useState(false);
  const [copyName, setCopyName] = useState('');
  const savingFeedback = useRef(false);
  const appliedAdjustment = useRef<{ correctionMs: number; strokeDurationMs: number } | null>(null);
  const rearmProfile = useRef('');
  const previousProfileId = useRef(profile?.id ?? '');
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
    const profileChanged = previousProfileId.current !== (profile?.id ?? '');
    if (profileChanged) previousProfileId.current = profile?.id ?? '';
    if (dirty && !profileChanged) return;
    const expected = appliedAdjustment.current;
    if (!profileChanged && expected && (saved.correctionMs !== expected.correctionMs || saved.pluginAssistance?.strokeDurationMs !== expected.strokeDurationMs)) return;
    appliedAdjustment.current = null;
    if (profileChanged) setDirty(false);
    setConfig(initialConfig(saved)); setTiming(initialTiming(saved));
  }, [saved, dirty, profile?.id]);
  const locked = !!session.running || !!s.stopping || (!!s.diagnosticRecording && !s.diagnosticRecording.isFinalized), working = !!busy || !!s.busy;
  const output = s.output ?? {}, calibration = state.assistance ?? {}, receipt = s.lastAction;
  const diagnostic = s.diagnosticRecording, recordingDiagnostics = !!diagnostic?.isRecording;
  const savingDiagnostics = !!diagnostic && !diagnostic.isRecording && !diagnostic.isFinalized;
  const switchingBlocked = !!s.stopping || recordingDiagnostics || savingDiagnostics || !!s.training?.isRecording || working || dirty;
  const nativeStats = s.streamTelemetry?.direct;
  const streamStats = nativeStats ?? s.streamTelemetry?.latest;
  const signature = receipt ? `${receipt.runId}:${receipt.id}` : '';
  const matching = !!receipt && receipt.configurationKey === calibration.key
    && (!s.lastAttempt || (s.lastAttempt.id === receipt.id && s.lastAttempt.runId === receipt.runId && s.lastAttempt.outcome !== 'cancelled'));
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
    if (!awaitingFeedback || !ocrMatches || !config.autoOcrTiming || ocr.feedbackEligible === false || receipt?.eligibleForFeedback === false) return;
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
  function changeActivation(value: string) {
    if (dirty || !profile) edit('activation', value);
    else void save({ ...config, activation: value }, !!session.running).catch(() => {});
  }
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
    trial.current = operation.trial; operation.trial.active = !accepted;
    try {
      if (prepare) {
        const next = { ...config, calibrationTrial: !accepted };
        await run('signalConfigure', { ...meterArguments(next, timing), restart: !!session.running });
        if (!currentStart(operation)) return;
        setConfig(next); setDirty(false);
        if (savedResult) setResultMessage('Result saved. Timing settings applied for the next trial. Start the next practice trial when ready.');
        setAdjustmentFailed(false);
      }
      if (!session.running || session.modelReady === false) {
        if (session.running && !prepare) await run('stop');
        if (!currentStart(operation)) return;
        operation.armAttempted = true;
        await run('start', { loadModel: true, armed: true });
      } else {
        operation.armAttempted = true;
        await run('armedSet', { armed: true });
      }
      if (!currentStart(operation)) await cleanupStart(operation, true);
    } catch { await cleanupStart(operation, true); }
    finally { if (starting.current === operation) starting.current = null; }
  }
  useEffect(() => {
    if (!rearmProfile.current || profile?.id !== rearmProfile.current || !session.running || !session.canArm || !accepted || output.armed) return;
    rearmProfile.current = '';
    void begin();
  }, [profile?.id, session.running, session.canArm, accepted, output.armed]);
  async function switchProfile(id: string) {
    if (!id || id === profile?.id) return;
    const wasArmed = !!output.armed;
    rearmProfile.current = wasArmed ? id : '';
    try {
      if (wasArmed) { cancelStart(); await pauseTrial(trial.current, true); }
      await run('profileSelect', { id, restart: !!session.running });
    } catch { rearmProfile.current = ''; }
  }
  async function duplicateProfile() {
    const trimmed = copyName.trim();
    if (!profile || !trimmed) return;
    const wasArmed = !!output.armed;
    try {
      if (wasArmed) { cancelStart(); await pauseTrial(trial.current, true); }
      const created = await run('profileDuplicate', { id: profile.id, name: trimmed, restart: !!session.running });
      rearmProfile.current = wasArmed && created?.id ? created.id : '';
      setCopying(false);
    } catch { rearmProfile.current = ''; }
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
  const prepare = !accepted && (!saved.pluginAssistance?.calibrationTrial
    || (saved.pluginAssistance?.targetProgress != null && saved.pluginAssistance.targetProgress !== config.targetProgress));
  const ready = !!profile?.usesShotMeter && !!source && connected && !inputMissing && !dirty && !s.stopping && !(session.running && session.sourceStale)
    && (!session.running || session.canArm || prepare);
  const nextStep = !profile ? 'Choose your shot profile.' : !profile.usesShotMeter ? 'Enable the shot meter in this profile and in NBA 2K27.'
    : !source ? (s.xbox?.direct ? 'Connect your Xbox above.' : 'Choose a capture source above.')
    : session.sourceStale ? 'Resume the Remote Play stream in your browser.' : inputMissing ? 'Connect your physical controller.'
    : dirty ? 'Apply or discard your settings changes before starting a trial.'
    : !connected ? 'Connect controller output below.'
    : !session.running ? (accepted ? 'Start assistance to begin capture and automatic reversal.' : 'Start a practice trial to begin capture and one automatic reversal.')
    : !accepted && successes >= 3 ? matching ? 'Three matching results are saved. Save this calibration to continue.' : 'Complete a trial in this session to confirm your saved results.'
    : !session.canArm && !prepare ? session.message || 'Waiting for live capture.' : accepted
      ? 'Start assistance to enable automatic reversal.' : 'Start a practice trial to enable one automatic reversal.';
  function number(label: string, key: string, min: number, max: number, step = 1, info?: string) {
    return <Field key={key} label={label} info={info}><Input type="number" min={min} max={max} step={step} value={config[key]}
      disabled={working || !!output.armed} onChange={e => edit(key, e.target.value === '' ? NaN : +e.target.value)} /></Field>;
  }
  const directional = config.inputMode === 'rhythm' && (config.trigger === 'physicalStick' || /^(left|right)(Up|Down|Left|Right)$/.test(config.trigger));
  const activationHelp = config.activation === 'tap'
    ? directional ? 'Push the stick in the assigned direction once. You can center it immediately.' : 'Tap the assigned control once. You can release it immediately.'
    : 'Hold the assigned control through the shot.';
  return <div className="page-stack meter-workflow"><style>{styles}</style>
    <Card title="Profile presets" description="Save separate calibrated presets for different modes or jumpshots and switch live."><div className="meter-profile-row">
      <ProfilePicker label="Shot profile" value={profile?.id ?? ''} disabled={switchingBlocked}
        options={[{ id: '', name: 'Choose a shot profile', disabled: true }, ...(state.profiles ?? [])]}
        onSelect={id => { void switchProfile(id); }} onCreate={() => editProfile()} />
      <Button disabled={!profile || locked || working || dirty} onClick={() => editProfile(profile)}><Icon name="pencil" size={16} />Edit profile</Button>
      <Button disabled={!profile || switchingBlocked} onClick={() => { setCopyName(`${profile.name} copy`); setCopying(true); }}><Icon name="copy" size={16} />Duplicate</Button>
      <Field label="Shooting input"><Select value={config.inputMode} disabled={locked || working} onValueChange={v => edit('inputMode', v)}>
        <SelectOption value="rhythm">Rhythm · right stick</SelectOption><SelectOption value="button">Shoot button</SelectOption></Select></Field>
      {config.inputMode === 'rhythm' && <Field label="Shot trigger"><Select value={config.trigger ?? 'largeRight'} disabled={locked || working} onValueChange={v => edit('trigger', v)}>
        {Object.entries(triggerLabels).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>}
      <Field label="Shot activation"><Select value={config.activation} disabled={working || !!output.armed || !!s.stopping || (!!diagnostic && !diagnostic.isFinalized)} onValueChange={changeActivation}>
        <SelectOption value="tap">{directional ? 'Push once' : 'Tap once'}</SelectOption>
        <SelectOption value="hold">Hold through shot</SelectOption></Select></Field>
    </div>{copying && profile && <div className="meter-profile-row meter-copy-row">
      <Field label="New profile name"><Input value={copyName} maxLength={80} autoFocus placeholder="For example, MyCourt, Rec, or Park" onChange={e => setCopyName(e.target.value)} /></Field>
      <Button variant="primary" disabled={switchingBlocked || !copyName.trim()} busy={busy === 'profileDuplicate'} onClick={() => { void duplicateProfile(); }}>Save copy</Button>
      <Button disabled={working} onClick={() => setCopying(false)}>Cancel</Button>
    </div>}{profile && <p className="subtle meter-profile-summary">{profile.cameraView} camera · {profile.meterReleaseType || 'Release cue not set'} · {profile.usesShotMeter ? 'Meter on' : 'Meter off'}</p>}
    <p className="subtle meter-profile-summary">{config.inputMode === 'rhythm' && paddleTriggers.includes(config.trigger) && 'Map the selected paddle to its PC Profile Numpad key in Xbox Accessories. '}{activationHelp}</p></Card>
    <Card title="Xbox stream statistics" description={s.xbox?.direct ? 'Studio reads network and decoder statistics from the active Xbox stream.' : 'Enable the statistics overlay in the Xbox app so Studio can read it during window capture.'}>
      <p role="status">{s.streamTelemetry?.message || 'Statistics will appear when gameplay capture starts.'}</p>
      {s.streamTelemetryReader && <p className="subtle">{s.streamTelemetryReader}</p>}
      <div className="meter-readings">{[[nativeStats?.rttSource === 'ICMP to selected LAN peer' ? 'LAN ping' : nativeStats ? 'ICE RTT' : 'Ping', nativeStats ? nativeStats.rttMs : streamStats?.pingMs, 'ms'], ['Jitter', streamStats?.jitterMs, 'ms'],
        ['Decode', streamStats?.decodeMs, 'ms'], ['Stream FPS', streamStats?.fps, 'FPS']].map(([label, value, unit]) =>
        <div key={label}><span>{label}</span><strong>{typeof value !== 'number' ? '—' : `${fmt(value)} ${unit}`}</strong></div>)}</div>
      <p className="subtle">Unstable or unreadable statistics pause automatic tuning. Reliable repeated shot feedback tunes the effective correction; ping is never subtracted directly from release timing.</p>
      {receipt?.eligibleForFeedback === false && s.lastAttempt?.outcome !== 'cancelled' && <Notice>Local output timing was not validated. This attempt is diagnostic only; complete a new practice trial.</Notice>}
      {s.lastAttempt?.outcome === 'cancelled' && <Notice>Attempt cancelled: {s.lastAttempt.cancellationReason}. {output.holdingCancelledTriggerShot ? 'Release the shot control to return the stick to neutral.' : 'No successful release was recorded.'}</Notice>}
    </Card>
    <div className="meter-layout">
      <div className="meter-capture"><GameplayPreview status={s} window={captureWindow} onError={setError} actions={locked
        ? <Button active={!!session.running} disabled={!!s.stopping} onClick={() => void stopPreview()}>Stop preview</Button>
        : <Button active={false} disabled={working || !profile?.usesShotMeter || !source} busy={busy === 'start'} onClick={() => void preview()}>Start preview</Button>} />
        <details className="meter-diagnostics"><summary>Detection details</summary><p role="status">{signal.message || 'Detection runs when you hold the shooting input.'}</p>
          <div className="meter-readings">{[['Fill', `${fmt(signal.progress * 100)}%`], ['Predicted target', `${fmt(signal.timeToTargetMs)} ms`],
            ['Fill velocity', signal.continueCommittedAction ? '—' : `${fmt(signal.velocityPerMs * 1000 * 100)}% / s`], ['Samples', signal.samples ?? 0],
            ['Action phase', signal.continueCommittedAction ? output.armed ? 'Finishing anchored stroke' : 'Observation only — assistance off'
              : signal.invalidateAttempt ? 'Attempt cancelled' : signal.timeToTargetMs != null ? output.armed ? 'Live forecast' : 'Observation only — assistance off' : 'Observing'],
            ['Uncertainty', signal.continueCommittedAction ? '—' : `${fmt(signal.uncertaintyMs)} ms`], ['Processing', `${fmt(signal.processingMs, 2)} ms`], ['Geometry score', fmt(signal.confidence, 2)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></details>
        <details className="meter-diagnostics"><summary>Diagnostic recording</summary><div className="stack" style={{ marginTop: '12px' }}>
          <p className="subtle" style={{ margin: 0 }}>Save gameplay frames and detection telemetry continuously until you stop recording. {output.armed
            ? accepted
              ? 'Automatic reversal is on; recording captures your live assisted shots.'
              : 'Automatic reversal is on for one practice shot.'
            : 'Automatic reversal is off; recording captures observations only.'}</p>
          <div className="button-group"><Button active={recordingDiagnostics} disabled={savingDiagnostics || (!recordingDiagnostics && (working || !session.running || !!s.stopping || !!s.training?.isRecording))}
            busy={busy === 'diagnosticStart'} onClick={() => invoke(recordingDiagnostics ? 'diagnosticStop' : 'diagnosticStart')}>
            {recordingDiagnostics ? 'Stop diagnostic recording' : 'Record diagnostics'}</Button>
            {diagnostic?.isFinalized && <Button disabled={working} onClick={() => invoke('openDiagnosticFolder')}>Open diagnostic folder</Button>}
          </div>
          {diagnostic && <div role="status" aria-live="polite"><p style={{ margin: 0 }}>{diagnostic.message}</p>
            <p className="subtle" style={{ margin: 0 }}>{diagnostic.observedFrames ?? 0} frames analyzed · {diagnostic.storedFrames ?? 0} images saved · {diagnostic.droppedFrames ?? 0} images skipped</p></div>}
          {diagnostic?.failed && <Notice tone="danger">The diagnostic recording could not finish. Open its folder to inspect any saved evidence.</Notice>}
        </div></details>
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
          : config.activation === 'tap' || config.inputMode === 'button' ? `Take one stationary shot. ${activationHelp}`
          : (config.trigger ?? 'largeRight') !== 'physicalStick'
            ? `Take one stationary shot. Hold ${triggerLabels[config.trigger ?? 'largeRight'] ?? 'the assigned control'} down through the automatic reversal, then release it.${['rightUp', 'rightDown', 'rightLeft', 'rightRight'].includes(config.trigger) ? '' : ' Keep the right stick centered.'}`
            : 'Take one stationary shot. Hold the right stick down through the automatic reversal, then return to neutral.'}</Notice>
          {output.message && <p role="status">{output.message}</p>}
          <Button active={true} onClick={() => void pauseAssistance()}>Pause {accepted ? 'assistance' : 'trial'}</Button></div>
          : !awaitingFeedback && (accepted || successes < 3 || !matching) && <Button active={false} className="meter-primary" disabled={working || !ready} busy={busy === 'start' || busy === 'armedSet' || busy === 'signalConfigure'}
            onClick={() => void begin()}>
            <Icon name="play" size={18} />{accepted ? 'Start assistance' : 'Start practice trial'}</Button>}
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
            <div className="button-group"><Button variant="primary" busy={busy === 'signalFeedback'} disabled={working || dirty || receipt?.eligibleForFeedback === false || !feedback.timing || (config.inputMode === 'rhythm' && (!feedback.shotType || !feedback.tempo))} onClick={() => void saveFeedbackWith()}>Save result</Button>
              <Button disabled={working} onClick={() => { setSkipped(signature); setFeedback({ timing: '', tempo: '', shotType: '' }); }}>Skip this result</Button></div></div>
            : <p className="subtle">{used ? 'Result saved. Start another practice trial when ready.' : 'Shot feedback appears here after Studio completes a controller action.'}</p>}
          {successes >= 3 && <Button variant="primary" disabled={working || !matching || awaitingFeedback} onClick={() => void confirm()}>Save calibration</Button>}
        </>}
        {accepted && <p className="subtle">Calibration saved for this profile, capture size and timing setup.</p>}
        <div className="meter-ocr-box">
          <label className="meter-ocr-toggle"><Checkbox checked={config.autoOcrTiming !== false} disabled={working || !!output.armed}
            onChange={e => { const next = { ...config, autoOcrTiming: e.target.checked }; setConfig(next); if (profile) void save(next, true).catch(() => {}); }} />
            <span>Auto-adapt timing from shot feedback (OCR)</span></label>
          {s.ocrReaderStatus && <p role="status">{s.ocrReaderStatus}{typeof s.ocrEffectiveTimingMs === 'number'
            ? ` Current timing correction ${fmt(s.ocrEffectiveTimingMs)} ms.` : ''}</p>}
          {!accepted && <label className="meter-ocr-toggle"><Checkbox checked={autoSubmitPractice} disabled={working || config.autoOcrTiming === false}
            onChange={e => setAutoSubmitPractice(e.target.checked)} />
            <span>Auto-save OCR practice results &amp; re-arm</span></label>}
          {ocr?.message && <p className="subtle" role="status">{ocr.message}{ocr.distance || ocr.coverage ? ` [${[ocr.distance, ocr.coverage].filter(Boolean).join(' · ')}]` : ''}{ocr.rawText ? ` (${ocr.rawText})` : ''}</p>}
          {Array.isArray(s.ocrHistory) && s.ocrHistory.length > 0 && <details className="meter-ocr-history"><summary>Shot feedback log ({s.ocrHistory.length})</summary>
            <div className="meter-ocr-summary">{Object.entries(s.ocrHistory.reduce((acc: any, r: any) => {
              const key = r.distance || 'Distance unknown';
              const g = acc[key] ?? { total: 0, excellent: 0, early: 0, late: 0, fast: 0, slow: 0 };
              g.total++;
              if (r.timing === 'excellent') g.excellent++;
              else if (r.timing === 'early' || r.timing === 'slightlyEarly') g.early++;
              else if (r.timing === 'late' || r.timing === 'slightlyLate') g.late++;
              if (r.tempo === 'fast' || r.tempo === 'slightlyFast') g.fast++;
              else if (r.tempo === 'slow' || r.tempo === 'slightlySlow') g.slow++;
              acc[key] = g;
              return acc;
            }, {})).map(([dist, g]: [string, any]) => <p key={dist} className="subtle">{dist}: {g.total} shots · {g.excellent} excellent · {g.early} early · {g.late} late · {g.fast} fast · {g.slow} slow</p>)}</div>
            {s.ocrHistoryPath && <p className="subtle">Saved to {s.ocrHistoryPath}</p>}</details>}
        </div>
      </Card>
    </div>
    <details className="meter-advanced"><summary>Advanced settings</summary><Card title="Timing & detection">
      <label className="meter-ocr-toggle"><Checkbox checked={timing.streamTelemetry?.enabled !== false} disabled={working || !!output.armed}
        onChange={e => { setTiming((old: any) => ({ ...old, streamTelemetry: { ...meterArguments(config, old).streamTelemetry, enabled: e.target.checked } })); setDirty(true); }} />Monitor Xbox stream statistics</label>
      {!s.xbox?.direct && <div className="form-grid">{(['left', 'top', 'width', 'height'] as const).map(key => <Field key={key} label={`Statistics region ${key} · %`}>
        <Input type="number" min={0} max={100} step={1} value={Math.round(meterArguments(config, timing).streamTelemetry.region[key] * 100)} disabled={working || !!output.armed}
          onChange={e => { const stats = meterArguments(config, timing).streamTelemetry; setTiming((old: any) => ({ ...old, streamTelemetry: { ...stats, region: { ...stats.region, [key]: +e.target.value / 100 } } })); setDirty(true); }} /></Field>)}</div>}
      <div className="form-grid"><Field label="Game build" info="Tracks the NBA 2K27 patch version for this calibration so results are kept separate across game updates."><Input value={config.gameBuild} maxLength={80} disabled={working || !!output.armed} onChange={e => edit('gameBuild', e.target.value)} /></Field>
        {number('Stroke duration · ms', 'strokeDurationMs', 8, 500, 1, 'How fast the virtual right stick flips from down to up for a rhythm shot. Lower = faster tempo; higher = slower tempo.')}
        {number('Timing anchor · axis fraction', 'anchorFraction', 0, 1, .05, 'Point along the stick flip that counts as your release timing point (0.5 = center crossing; 0.85 = near full-up).')}
        {number('Full-up hold · ms', 'upHoldMs', 0, 500, 1, 'How long the virtual stick stays held at full-up after flipping so NBA 2K27 reliably registers the finish.')}
        {config.activation === 'hold' && number('Hold qualification · ms', 'holdMs', 0, 250, 1, 'How long you must hold the assigned shot control before meter tracking starts.')}
        {number('Target fill', 'targetProgress', .7, 1.1, .01, 'How full the shot meter reaches (for example, 0.75 = 75%) before triggering the reversal so it finishes inside the green window after stream delay.')}
        <Field label="Stroke curve" info="How the stick moves during the flip. Linear moves at constant speed; Smooth eases in and out like a thumbstick motion."><Select value={config.smoothStroke ? 'smooth' : 'linear'} disabled={working || !!output.armed} onValueChange={v => edit('smoothStroke', v === 'smooth')}>
          <SelectOption value="linear">Linear</SelectOption><SelectOption value="smooth">Smooth</SelectOption></Select></Field>
        {([
          ['estimatedVideoDelayMs', 'Video delay estimate · ms', 'Estimated time between NBA 2K27 rendering a frame on Xbox and it appearing on your PC screen (typically 50–80 ms on Remote Play).'],
          ['estimatedInputDelayMs', 'Input delay estimate · ms', 'Estimated time for a controller command from Studio to reach NBA 2K27 on this Remote Play setup.'],
          ['correctionMs', 'Timing correction · ms', 'Fine-tune release offset in milliseconds. Negative values (for example, -5) release earlier to fix Late; positive values release later to fix Early.'],
          ['tempoCorrectionMs', 'Tempo correction · ms', 'Fine-tune live stick-flip duration offset in milliseconds. Positive values slow a Fast flip; negative values speed up a Slow flip.'],
          ['maximumUncertaintyMs', 'Maximum uncertainty · ms', 'Largest prediction error in milliseconds allowed before releasing. Lower is stricter; higher tolerates noisier streams.'],
          ['minimumConfidence', 'Minimum geometry score', 'Minimum visual match score (0–1) needed to trust that the detected bar on screen is actually the NBA 2K27 shot meter.']
        ] as const).map(([key, label, info]) => <Field key={key} label={label} info={info}>
          <Input type="number" min={key === 'correctionMs' ? -1000 : key === 'tempoCorrectionMs' ? -200 : 0}
            max={key === 'minimumConfidence' ? 1 : key === 'tempoCorrectionMs' ? 200 : 1000} step={key === 'minimumConfidence' ? .05 : 1}
            value={timing[key] ?? 0} disabled={working || !!output.armed} onChange={e => editTiming(key, e.target.value === '' ? NaN : +e.target.value)} /></Field>)}
        {config.inputMode === 'button' && <Field label="Shoot button" info="Xbox controller button Studio holds and releases when Shooting input is set to Shoot button."><Select value={timing.shootButton ?? 'x'} disabled={working || !!output.armed}
          onValueChange={v => { setTiming((old: any) => ({ ...old, shootButton: v })); setDirty(true); }}>{[['x','X'],['y','Y'],['a','A'],['b','B'],['leftBumper','LB'],['rightBumper','RB']].map(([value,label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>}
      </div><p className="subtle">A 0.5 timing anchor is the neutral crossing. Negative timing correction sends earlier; positive sends later. Applying changes pauses assistance and resumes the preview.</p>
      <details><summary>Meter appearance & gameplay viewport</summary><div className="form-grid">
        {number('Acquisition window · ms', 'acquisitionWindowMs', 100, 3000, 1, 'Maximum time after pressing shot input that Studio keeps scanning for the shot meter to appear.')}
        {number('Target red', 'targetRed', 0, 255, 1, 'Expected red channel (0–255) of the shot meter bar color used for visual matching.')}
        {number('Target green', 'targetGreen', 0, 255, 1, 'Expected green channel (0–255) of the shot meter bar color used for visual matching.')}
        {number('Target blue', 'targetBlue', 0, 255, 1, 'Expected blue channel (0–255) of the shot meter bar color used for visual matching.')}
        {number('Hue tolerance · degrees', 'colorToleranceDegrees', 5, 60, 1, 'How far (in hue degrees) pixels may differ from the target meter color and still count. Higher handles dimmer courts; lower rejects background noise.')}
        {([
          ['left', 'Left edge of the gameplay area inside the captured window (0–1 fraction) so black bars or browser tabs are ignored.'],
          ['top', 'Top edge of the gameplay area inside the captured window (0–1 fraction) so title bars or browser chrome are ignored.'],
          ['width', 'Width of the gameplay area inside the captured window (0–1 fraction).'],
          ['height', 'Height of the gameplay area inside the captured window (0–1 fraction).']
        ] as const).map(([key, info]) => <Field key={key} label={`Gameplay ${key} · fraction`} info={info}><Input type="number" min={0} max={1} step={.01} value={config.viewport[key]}
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
.meter-profile-row{display:flex;align-items:end;gap:16px;flex-wrap:wrap}.meter-profile-row>.field,.meter-profile-row>.profile-picker{flex:1;min-width:220px}.meter-copy-row{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.meter-profile-summary{margin:16px 0 0}
.meter-layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(340px,.85fr);gap:20px;align-items:start}.meter-layout>*{min-width:0}.meter-capture{display:grid;gap:16px}
.meter-readiness{display:grid;margin-bottom:16px}.meter-readiness>div{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:52px;padding:10px 0;border-bottom:1px solid var(--line)}
.meter-connected{display:flex;align-items:center;gap:6px;color:var(--success)}.meter-primary{width:100%;margin:4px 0 12px}.meter-progress{display:flex;align-items:baseline;gap:10px;padding:16px 0;border-bottom:1px solid var(--line)}
.meter-progress strong{font-size:24px}.meter-progress span{font-size:14px;color:var(--muted)}.meter-feedback{display:grid;gap:12px;margin-top:16px}.meter-feedback h3,.meter-feedback p{margin:0}
.meter-diagnostics,.meter-advanced{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:16px}.meter-diagnostics summary,.meter-advanced>summary{cursor:pointer;font-weight:600;font-size:14px}
.meter-advanced[open]>summary{margin-bottom:16px}.meter-advanced>.card{border:0;padding:8px 0 0}.meter-readings{display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:12px;margin-top:16px}
.meter-readings>div{display:grid;gap:6px}.meter-readings span{font-size:14px;color:var(--muted)}
.meter-ocr-box{display:grid;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.meter-ocr-toggle{display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer}.meter-ocr-box p{margin:0}.meter-ocr-history summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--muted)}.meter-ocr-summary{display:grid;gap:4px;margin:6px 0}
@media(max-width:1080px){.meter-layout{grid-template-columns:minmax(0,1fr)}}
`;
