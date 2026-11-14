import { React, useEffect, useRef, useState, Button, Card, Field, Input, Notice, Select, SelectOption,
  ProfilePicker, GameplayPreview, Icon, useUnsavedChanges, type VisionWorkspaceProps } from './host.js';

export const meterDefaults = { version: 1, enabled: true, inputMode: 'rhythm', style: 'curved', viewport: { left: 0, top: 0, width: 1, height: 1 },
  targetRed: 80, targetGreen: 210, targetBlue: 95, colorToleranceDegrees: 30, holdMs: 70, acquisitionWindowMs: 800, strokeDurationMs: 80, anchorFraction: .5,
  upHoldMs: 48, targetProgress: 1, smoothStroke: false, calibrationTrial: false, confirmed: false, gameBuild: '', results: [], calibratedWidth: 0, calibratedHeight: 0 };
export function meterArguments(configuration: any, settings: any) {
  return { configuration, videoDelayMs: settings.estimatedVideoDelayMs ?? 0, inputDelayMs: settings.estimatedInputDelayMs ?? 0,
    correctionMs: settings.correctionMs ?? 0, minimumConfidence: settings.minimumConfidence ?? .65,
    maximumUncertaintyMs: settings.maximumUncertaintyMs ?? 12, shootButton: settings.shootButton ?? 'x' };
}
const fmt = (v: any, digits = 1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const timingOptions = [['early', 'Early'], ['slightlyEarly', 'Slightly early'], ['excellent', 'Excellent'], ['slightlyLate', 'Slightly late'], ['late', 'Late']];
const tempoOptions = [['fast', 'Fast'], ['slightlyFast', 'Slightly fast'], ['excellent', 'Excellent'], ['slightlySlow', 'Slightly slow'], ['slow', 'Slow']];
const initialConfig = (s: any) => ({ ...meterDefaults, ...s.pluginAssistance, enabled: true, gameBuild: s.pluginAssistance?.gameBuild || s.trainingCapture?.gameBuild || '' });
const initialTiming = (s: any) => ({ ...s, minimumConfidence: s.pluginAssistance?.enabled ? s.minimumConfidence : .65,
  maximumUncertaintyMs: s.pluginAssistance?.enabled ? s.maximumUncertaintyMs : 12 });

export function MeterAssistance({ state = {}, status, command, captureWindow, editProfile }: VisionWorkspaceProps & { editProfile: (profile?: any) => void }) {
  const saved = state.settings ?? {}, s = status ?? state.status ?? {}, session = s.session ?? {}, signal = s.signal ?? {}, profile = state.selectedProfile;
  const [config, setConfig] = useState<any>(() => initialConfig(saved)), [timing, setTiming] = useState<any>(() => initialTiming(saved));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [feedback, setFeedback] = useState({ timing: '', tempo: '' }), [skipped, setSkipped] = useState('');
  const [connectionConfirmed, setConnectionConfirmed] = useState(false);
  const trial = useRef<{ active: boolean; before: string }>({ active: false, before: '' });
  useUnsavedChanges(dirty);
  useEffect(() => { if (!dirty) { setConfig(initialConfig(saved)); setTiming(initialTiming(saved)); } }, [saved, dirty]);
  const locked = !!session.running || !!s.stopping, working = !!busy || !!s.busy;
  const output = s.output ?? {}, calibration = state.assistance ?? {}, receipt = s.lastAction;
  const signature = receipt ? `${receipt.runId}:${receipt.id}` : '';
  const matching = !!receipt && receipt.configurationKey === calibration.key;
  const used = (calibration.currentResults ?? []).some((r: any) => r.receiptId === receipt?.id && r.runId === receipt?.runId);
  const awaitingFeedback = matching && !used && signature !== skipped;
  const connected = s.controllerConnection?.connected ?? connectionConfirmed;
  const inputMissing = s.controllerConnection?.inputConnected === false;
  const source = s.selectedSourceId ?? state.selectedSourceId;
  const differentSize = session.captureWidth > 0 && config.calibratedWidth > 0
    && (session.captureWidth !== config.calibratedWidth || session.captureHeight !== config.calibratedHeight);
  const accepted = !!calibration.accepted && !differentSize, successes = differentSize ? 0 : calibration.successfulTrials ?? 0;
  useEffect(() => { setFeedback({ timing: '', tempo: '' }); }, [signature]);

  async function run(action: string, args?: any) {
    setBusy(action); setError('');
    try { return await command(action, args); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); throw e; }
    finally { setBusy(''); }
  }
  const invoke = (action: string, args?: any) => { void run(action, args).catch(() => {}); };
  // Pause only a practice trial explicitly started here after its new native receipt.
  // Opening the page or receiving an old receipt never changes controller output.
  useEffect(() => {
    if (!trial.current.active || !matching || signature === trial.current.before) return;
    trial.current.active = false;
    void run('armedSet', { armed: false }).catch(() => {});
  }, [signature, matching]);
  const edit = (key: string, value: any) => { setConfig((old: any) => ({ ...old, [key]: value })); setDirty(true); };
  const editTiming = (key: string, value: number) => { setTiming((old: any) => ({ ...old, [key]: value })); setDirty(true); };
  async function save(next = config, restart = false) {
    await run('signalConfigure', { ...meterArguments(next, timing), restart }); setConfig(next); setDirty(false);
  }
  async function preview() {
    try { await save({ ...config, calibrationTrial: !accepted }); await run('start', { loadModel: true }); } catch { /* shown beside actions */ }
  }
  async function connect() {
    try { const result = await run('connectOutput'); if (result?.connected === true) setConnectionConfirmed(true); } catch { /* shown beside actions */ }
  }
  async function begin() {
    trial.current = { active: !accepted, before: signature };
    try { await run('armedSet', { armed: true }); } catch { trial.current.active = false; }
  }
  async function saveFeedback() {
    try {
      trial.current.active = false;
      if (output.armed) await run('armedSet', { armed: false });
      await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId, feedback });
      setFeedback({ timing: '', tempo: '' });
    } catch { /* retain selections on failure */ }
  }
  async function confirm() {
    try {
      if (output.armed) await run('armedSet', { armed: false });
      await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId, feedback: { confirmOnly: true } });
      await save({ ...config, calibrationTrial: false }, true);
    } catch { /* shown beside actions */ }
  }
  const ready = session.running && session.canArm && connected && !inputMissing && !dirty && !s.stopping;
  const prepare = session.running && !accepted && !saved.pluginAssistance?.calibrationTrial;
  const nextStep = !profile ? 'Choose your shot profile.' : !profile.usesShotMeter ? 'Enable the shot meter in this profile and in NBA 2K27.'
    : !source ? 'Choose the Remote Play window above.' : !session.running ? 'Start the preview to check your gameplay.'
    : session.sourceStale ? 'Resume the Remote Play stream in your browser.' : inputMissing ? 'Connect your physical controller.'
    : dirty ? 'Apply or discard your settings changes before starting a trial.'
    : !connected ? 'Connect controller output below.' : prepare ? 'Prepare the preview for practice calibration.'
    : !accepted && successes >= 3 ? matching ? 'Three matching results are saved. Save this calibration to continue.' : 'Complete a trial in this session to confirm your saved results.'
    : !session.canArm ? session.message || 'Waiting for live capture.' : 'Ready for a stationary practice shot.';
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
    </div>{profile && <p className="subtle meter-profile-summary">{profile.cameraView} camera · {profile.meterReleaseType || 'Release cue not set'} · {profile.usesShotMeter ? 'Meter on' : 'Meter off'}</p>}</Card>
    <div className="meter-layout">
      <div className="meter-capture"><GameplayPreview status={s} window={captureWindow} onError={setError} actions={locked
        ? <Button active={!!session.running} disabled={!!s.stopping} onClick={() => { trial.current.active = false; invoke('stop'); }}>Stop preview</Button>
        : <Button active={false} disabled={working || !profile?.usesShotMeter || !source} busy={busy === 'start'} onClick={() => void preview()}>Start preview</Button>} />
        <details className="meter-diagnostics"><summary>Detection details</summary><p role="status">{signal.message || 'Detection runs when you hold the shooting input.'}</p>
          <div className="meter-readings">{[['Fill', `${fmt(signal.progress * 100)}%`], ['Predicted target', `${fmt(signal.timeToTargetMs)} ms`],
            ['Uncertainty', `${fmt(signal.uncertaintyMs)} ms`], ['Processing', `${fmt(signal.processingMs, 2)} ms`], ['Geometry score', fmt(signal.confidence, 2)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></details>
      </div>
      <Card title={accepted ? 'Meter assistance' : 'Calibrate your shot'} className="meter-practice">
        <div className="meter-readiness" aria-label="Connection readiness">
          <div><span>Gameplay</span><strong>{session.sourceStale ? 'Stream paused' : session.running ? 'Capture running' : 'Preview stopped'}</strong></div>
          <div><span>Controller output</span>{connected ? <strong className="meter-connected"><Icon name="check" size={17} />Connected</strong>
            : <Button active={false} disabled={working || inputMissing} busy={busy === 'connectOutput'} onClick={() => void connect()}>{busy === 'connectOutput' ? 'Connecting…' : 'Connect controller'}</Button>}</div>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        {!output.armed && !awaitingFeedback && <p role="status">{nextStep}</p>}
        {output.armed ? <div className="stack"><Notice tone="info">{accepted ? 'Meter assistance is on.' : 'Take one stationary shot. Hold the right stick down through the automatic reversal, then return to neutral.'}</Notice>
          {output.message && <p role="status">{output.message}</p>}
          <Button active={true} onClick={() => { trial.current.active = false; invoke('armedSet', { armed: false }); }}>Pause {accepted ? 'assistance' : 'trial'}</Button></div>
          : !awaitingFeedback && (accepted || successes < 3 || !matching) && <Button active={false} className="meter-primary" disabled={working || (prepare ? !connected || dirty : !ready)} busy={busy === 'armedSet'}
            onClick={() => { if (prepare) { void save({ ...config, calibrationTrial: true }, true).catch(() => {}); } else void begin(); }}>
            <Icon name="play" size={18} />{prepare ? 'Prepare calibration' : accepted ? 'Start assistance' : 'Start practice trial'}</Button>}
        {!accepted && <>
          <div className="meter-progress" aria-label={`${successes} of 3 matching Excellent results`}><strong>{successes} of 3</strong><span>matching Excellent results</span></div>
          {awaitingFeedback ? <div className="meter-feedback"><h3>What did NBA 2K27 report?</h3><p className="subtle">Enter the timing and tempo shown by the game after this shot.</p>
            <Field label="Shot timing"><Select value={feedback.timing} disabled={working} onValueChange={v => setFeedback(old => ({ ...old, timing: v }))}>
              <SelectOption value="" disabled>Choose timing…</SelectOption>{timingOptions.map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>
            {config.inputMode === 'rhythm' && <Field label="Shot tempo"><Select value={feedback.tempo} disabled={working} onValueChange={v => setFeedback(old => ({ ...old, tempo: v }))}>
              <SelectOption value="" disabled>Choose tempo…</SelectOption>{tempoOptions.map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>}
            <div className="button-group"><Button variant="primary" busy={busy === 'signalFeedback'} disabled={working || dirty || !feedback.timing || (config.inputMode === 'rhythm' && !feedback.tempo)} onClick={() => void saveFeedback()}>Save result</Button>
              <Button disabled={working} onClick={() => { setSkipped(signature); setFeedback({ timing: '', tempo: '' }); }}>Skip this result</Button></div></div>
            : <p className="subtle">{used ? 'Result saved. Start another practice trial when ready.' : 'Shot feedback appears here after Studio completes a controller action.'}</p>}
          {successes >= 3 && <Button variant="primary" disabled={working || !matching || awaitingFeedback} onClick={() => void confirm()}>Save calibration</Button>}
        </>}
        {accepted && <p className="subtle">Calibration saved for this profile, capture size and timing setup.</p>}
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
        onClick={() => { void save(config, true).catch(() => {}); }}>Apply settings</Button>{dirty && <Button disabled={working} onClick={() => setDirty(false)}>Discard changes</Button>}</div>
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
@media(max-width:1080px){.meter-layout{grid-template-columns:minmax(0,1fr)}}
`;
