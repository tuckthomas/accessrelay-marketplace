import { React, useEffect, useState, Button, Card, Field, Input, Notice, Select, SelectOption, Toggle,
  ProfilePicker, GameplayPreview, useUnsavedChanges, type VisionWorkspaceProps } from './host.js';

export const meterDefaults = { version: 1, enabled: true, inputMode: 'rhythm', style: 'curved', viewport: { left: 0, top: 0, width: 1, height: 1 },
  targetRed: 80, targetGreen: 210, targetBlue: 95, colorToleranceDegrees: 30, holdMs: 70, acquisitionWindowMs: 800, strokeDurationMs: 80, anchorFraction: .5,
  upHoldMs: 48, targetProgress: 1, smoothStroke: false, calibrationTrial: false, confirmed: false, gameBuild: '', results: [], calibratedWidth: 0, calibratedHeight: 0 };
export function meterArguments(configuration: any, settings: any) {
  return { configuration, videoDelayMs: settings.estimatedVideoDelayMs ?? 0, inputDelayMs: settings.estimatedInputDelayMs ?? 0,
    correctionMs: settings.correctionMs ?? 0, minimumConfidence: settings.minimumConfidence ?? .65,
    maximumUncertaintyMs: settings.maximumUncertaintyMs ?? 12, shootButton: settings.shootButton ?? 'x' };
}
const fmt = (value: any, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
export function MeterAssistance({ state = {}, status, command, captureWindow, editProfile }: VisionWorkspaceProps & { editProfile: (profile?: any) => void }) {
  const saved = state.settings ?? {}, s = status ?? state.status ?? {}, session = s.session ?? {}, signal = s.signal ?? {}, profile = state.selectedProfile;
  const [config, setConfig] = useState<any>(() => ({ ...meterDefaults, ...saved.pluginAssistance, enabled: true,
    gameBuild: saved.pluginAssistance?.gameBuild || saved.trainingCapture?.gameBuild || '' }));
  const [timing, setTiming] = useState<any>({ ...saved, minimumConfidence: saved.pluginAssistance?.enabled ? saved.minimumConfidence : .65,
    maximumUncertaintyMs: saved.pluginAssistance?.enabled ? saved.maximumUncertaintyMs : 12 });
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [feedback, setFeedback] = useState({ timing: 'excellent', tempo: 'excellent' });
  useUnsavedChanges(dirty);
  useEffect(() => { if (!dirty) { setConfig({ ...meterDefaults, ...saved.pluginAssistance, enabled: true,
    gameBuild: saved.pluginAssistance?.gameBuild || saved.trainingCapture?.gameBuild || '' }); setTiming({ ...saved,
      minimumConfidence: saved.pluginAssistance?.enabled ? saved.minimumConfidence : .65, maximumUncertaintyMs: saved.pluginAssistance?.enabled ? saved.maximumUncertaintyMs : 12 }); } }, [saved, dirty]);
  const locked = !!session.running || !!s.stopping, working = !!busy || !!s.busy;
  const output = s.output ?? {}, calibration = state.assistance ?? {}, receipt = s.lastAction;
  const used = (calibration.currentResults ?? []).some((r: any) => r.receiptId === receipt?.id && r.runId === receipt?.runId);
  const currentReceipt = receipt && receipt.configurationKey === calibration.key;
  async function run(action: string, args?: any) { setBusy(action); setError(''); try { return await command(action, args); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); throw e; } finally { setBusy(''); } }
  const invoke = (action: string, args?: any) => { void run(action, args).catch(() => {}); };
  const edit = (key: string, value: any) => { setConfig((old: any) => ({ ...old, [key]: value })); setDirty(true); };
  const editTiming = (key: string, value: number) => { setTiming((old: any) => ({ ...old, [key]: value })); setDirty(true); };
  const save = async () => { await run('signalConfigure', meterArguments(config, timing)); setDirty(false); };
  const start = async () => { try { await save(); await run('start', { loadModel: true }); } catch { /* error shown below */ } };
  async function saveFeedback(confirmOnly = false) { try { if (output.armed) await run('armedSet', { armed: false });
    await run('signalFeedback', { feedback: { ...feedback, confirmOnly } }); } catch { /* error shown below */ } }
  function number(label: string, key: string, min: number, max: number, step = 1) {
    return <Field key={key} label={label}><Input type="number" min={min} max={max} step={step} value={config[key]} disabled={locked || working}
      onChange={e => edit(key, e.target.value === '' ? NaN : +e.target.value)} /></Field>;
  }
  return <div className="page-stack">
    {error && <Notice tone="danger">{error}</Notice>}
    <Card title="Shot meter assistance"><div className="form-grid">
      <ProfilePicker label="Shot profile" value={profile?.id ?? ''} disabled={locked || working || dirty}
        options={[{ id: '', name: 'Choose a meter-on profile', disabled: true }, ...(state.profiles ?? [])]}
        onSelect={id => invoke('profileSelect', { id })} onCreate={() => editProfile()} />
      <div className="button-group"><Button disabled={!profile || locked || working || dirty} onClick={() => editProfile(profile)}>Edit shot profile</Button></div>
      <Field label="Shooting input"><Select value={config.inputMode} disabled={locked || working} onValueChange={v => edit('inputMode', v)}>
        <SelectOption value="rhythm">Rhythm · right stick</SelectOption><SelectOption value="button">Shoot button</SelectOption></Select></Field>
      {config.inputMode === 'button' && <Field label="Shoot button"><Select value={timing.shootButton ?? 'x'} disabled={locked || working}
        onValueChange={v => { setTiming((old: any) => ({ ...old, shootButton: v })); setDirty(true); }}>
        {[['x','X'], ['y','Y'], ['a','A'], ['b','B'], ['leftBumper','LB'], ['rightBumper','RB']].map(([value,label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>}
      <Field label="Meter style"><Select value={config.style} disabled={locked || working} onValueChange={v => edit('style', v)}><SelectOption value="curved">Curved</SelectOption></Select></Field>
      <Field label="Game build"><Input value={config.gameBuild} maxLength={80} disabled={locked || working} placeholder="For example, 2.0.0.12" onChange={e => edit('gameBuild', e.target.value)} /></Field>
    </div>{profile && !profile.usesShotMeter && <Notice tone="warning">Select a meter-on profile and turn the curved meter on in NBA 2K27.</Notice>}
    <p className="subtle">Finds the meter across the gameplay viewport, then follows its moving region. No player tracking or AI model is required.</p>
    <div className="button-group"><Button variant="primary" disabled={!profile || locked || working || !dirty} onClick={() => { void save().catch(() => {}); }}>Save settings</Button>
      {dirty && <Button disabled={locked || working} onClick={() => setDirty(false)}>Discard changes</Button>}
      <Button disabled={locked || working || !profile || !profile.usesShotMeter} onClick={() => { edit('calibrationTrial', true); }}>Set up calibration trial</Button></div>
    </Card>
    <GameplayPreview status={s} window={captureWindow} onError={setError} actions={locked
      ? <Button disabled={!!s.stopping} onClick={() => invoke('stop')}>Stop analysis</Button>
      : <Button variant="primary" disabled={working || !profile?.usesShotMeter || !(s.selectedSourceId ?? state.selectedSourceId)} onClick={() => void start()}>Start meter analysis</Button>} />
    <Card title="Meter tracking"><p role="status">{signal.message || 'Start analysis, then take a manual shot to check detection.'}</p>
      <div className="form-grid">{[['Fill', `${fmt(signal.progress * 100)}%`], ['Target forecast', `${fmt(signal.timeToTargetMs)} ms`],
        ['Forecast uncertainty', `${fmt(signal.uncertaintyMs)} ms`], ['Detector', `${fmt(signal.processingMs, 2)} ms`],
        ['Geometry score', fmt(signal.confidence, 2)]].map(([label, value]) => <div key={label}><span className="subtle">{label}</span><p><strong>{value}</strong></p></div>)}</div>
      <p className="subtle">{session.message}</p>
      <div className="button-group"><Button disabled={working} onClick={() => invoke('connectOutput')}>Connect controller output</Button></div>
      <Toggle label={config.calibrationTrial ? 'Enable calibration trial' : 'Enable meter assistance'} checked={!!output.armed}
        disabled={working || (!output.armed && !session.canArm)} onChange={armed => invoke('armedSet', { armed })} />
      {!calibration.accepted && <p className="subtle">Normal assistance requires three saved Excellent timing{config.inputMode === 'rhythm' ? ' and tempo' : ''} results for the same setup, followed by confirmation.</p>}
    </Card>
    <Card title="Timing & rhythm calibration"><Toggle label="Calibration trial" checked={config.calibrationTrial} disabled={locked || working}
      onChange={value => edit('calibrationTrial', value)} />
      <p className="subtle">Trial mode permits unverified settings while you calibrate in practice. Start analysis, connect output, enable the trial, and hold the physical shooting input through the completed action.</p>
      <div className="form-grid">{number('Hold qualification · ms', 'holdMs', 0, 250)}
        {config.inputMode === 'rhythm' && <>{number('Down-to-up stroke · ms', 'strokeDurationMs', 8, 500)}
          {number('Timing anchor · axis travel fraction', 'anchorFraction', 0, 1, .05)}{number('Full-up hold · ms', 'upHoldMs', 0, 500)}
          <Field label="Stroke curve"><Select value={config.smoothStroke ? 'smooth' : 'linear'} disabled={locked || working} onValueChange={v => edit('smoothStroke', v === 'smooth')}>
            <SelectOption value="linear">Linear</SelectOption><SelectOption value="smooth">Smooth</SelectOption></Select></Field></>}
        {number('Target fill', 'targetProgress', .7, 1.1, .01)}
        {(['estimatedVideoDelayMs', 'estimatedInputDelayMs', 'correctionMs', 'maximumUncertaintyMs', 'minimumConfidence'] as const).map((key, i) => <Field key={key}
          label={['Video delay estimate · ms', 'Input delay estimate · ms', 'Timing correction · ms', 'Maximum forecast uncertainty · ms', 'Minimum geometry score'][i]}>
          <Input type="number" min={key === 'correctionMs' ? -1000 : 0} max={key === 'minimumConfidence' ? 1 : 1000} step={key === 'minimumConfidence' ? .05 : 1}
            value={timing[key] ?? 0} disabled={locked || working} onChange={e => editTiming(key, e.target.value === '' ? NaN : +e.target.value)} /></Field>)}
      </div><p className="subtle">An anchor of 0.5 means the neutral crossing. For a linear 80 ms stroke, motion starts 40 ms before that anchor. Delay fields are estimates until measured; local processing age is already accounted for.</p>
      <details><summary>Meter appearance & gameplay viewport</summary><div className="form-grid">
        {number('Acquisition window after hold · ms', 'acquisitionWindowMs', 100, 3000)}
        {number('Target red', 'targetRed', 0, 255)}{number('Target green', 'targetGreen', 0, 255)}{number('Target blue', 'targetBlue', 0, 255)}{number('Hue tolerance · degrees', 'colorToleranceDegrees', 5, 60)}
        {['left', 'top', 'width', 'height'].map(key => <Field key={key} label={`Gameplay ${key} · fraction`}><Input type="number" min={0} max={1} step={.01} value={config.viewport[key]} disabled={locked || working}
          onChange={e => edit('viewport', { ...config.viewport, [key]: +e.target.value })} /></Field>)}</div></details>
      <div className="button-group"><Button disabled={locked || working || !profile || !dirty} onClick={() => { void save().catch(() => {}); }}>Save calibration settings</Button></div>
      <h3>Shot feedback</h3><p>{calibration.successfulTrials ?? 0} / 3 Excellent results for this setup{calibration.accepted ? ' · calibration confirmed' : ''}</p>
      <div className="form-grid"><Field label="Timing"><Select value={feedback.timing} disabled={working} onValueChange={v => setFeedback(old => ({ ...old, timing: v }))}>
        {[['early', 'Early'], ['slightlyEarly', 'Slightly early'], ['excellent', 'Excellent'], ['slightlyLate', 'Slightly late'], ['late', 'Late']].map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>
        {config.inputMode === 'rhythm' && <Field label="Tempo"><Select value={feedback.tempo} disabled={working} onValueChange={v => setFeedback(old => ({ ...old, tempo: v }))}>
          {[['fast', 'Fast'], ['slightlyFast', 'Slightly fast'], ['excellent', 'Excellent'], ['slightlySlow', 'Slightly slow'], ['slow', 'Slow']].map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Field>}</div>
      <div className="button-group"><Button disabled={working || !currentReceipt || used || dirty} onClick={() => void saveFeedback()}>Save shot feedback</Button>
        <Button variant="primary" disabled={working || !currentReceipt || dirty || (calibration.successfulTrials ?? 0) < 3 || calibration.accepted} onClick={() => void saveFeedback(true)}>Confirm calibration</Button></div>
      <p className="subtle">Saving feedback disables assistance. After confirmation, stop and restart analysis to use the saved calibration. Profile, build, source, resolution or timing changes require a matching calibration.</p>
    </Card>
  </div>;
}
