import { React, useEffect, useRef, useState, Button, Card, Field, Input, Notice, Select, SelectOption, ProfilePicker, GameplayPreview, Icon, useUnsavedChanges } from './host.js';
export const meterDefaults = { version: 1, enabled: true, inputMode: 'rhythm', style: 'curved', viewport: { left: 0, top: 0, width: 1, height: 1 },
    targetRed: 80, targetGreen: 210, targetBlue: 95, colorToleranceDegrees: 30, holdMs: 70, acquisitionWindowMs: 800, strokeDurationMs: 80, anchorFraction: .5,
    upHoldMs: 48, targetProgress: 1, smoothStroke: false, calibrationTrial: false, confirmed: false, gameBuild: '', results: [], calibratedWidth: 0, calibratedHeight: 0 };
export function meterArguments(configuration, settings) {
    return { configuration, videoDelayMs: settings.estimatedVideoDelayMs ?? 0, inputDelayMs: settings.estimatedInputDelayMs ?? 0,
        correctionMs: settings.correctionMs ?? 0, minimumConfidence: settings.minimumConfidence ?? .65,
        maximumUncertaintyMs: settings.maximumUncertaintyMs ?? 12, shootButton: settings.shootButton ?? 'x' };
}
const fmt = (v, digits = 1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const timingOptions = [['early', 'Early'], ['slightlyEarly', 'Slightly early'], ['excellent', 'Excellent'], ['slightlyLate', 'Slightly late'], ['late', 'Late']];
const tempoOptions = [['fast', 'Fast'], ['slightlyFast', 'Slightly fast'], ['excellent', 'Excellent'], ['slightlySlow', 'Slightly slow'], ['slow', 'Slow']];
const initialConfig = (s) => ({ ...meterDefaults, ...s.pluginAssistance, enabled: true, gameBuild: s.pluginAssistance?.gameBuild || s.trainingCapture?.gameBuild || '' });
const initialTiming = (s) => ({ ...s, minimumConfidence: s.pluginAssistance?.enabled ? s.minimumConfidence : .65,
    maximumUncertaintyMs: s.pluginAssistance?.enabled ? s.maximumUncertaintyMs : 12 });
export function MeterAssistance({ state = {}, status, command, captureWindow, editProfile }) {
    const saved = state.settings ?? {}, s = status ?? state.status ?? {}, session = s.session ?? {}, signal = s.signal ?? {}, profile = state.selectedProfile;
    const [config, setConfig] = useState(() => initialConfig(saved)), [timing, setTiming] = useState(() => initialTiming(saved));
    const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
    const [feedback, setFeedback] = useState({ timing: '', tempo: '' }), [skipped, setSkipped] = useState('');
    const [connectionConfirmed, setConnectionConfirmed] = useState(false);
    const trial = useRef({ active: false, before: '' });
    useUnsavedChanges(dirty);
    useEffect(() => { if (!dirty) {
        setConfig(initialConfig(saved));
        setTiming(initialTiming(saved));
    } }, [saved, dirty]);
    const locked = !!session.running || !!s.stopping, working = !!busy || !!s.busy;
    const output = s.output ?? {}, calibration = state.assistance ?? {}, receipt = s.lastAction;
    const signature = receipt ? `${receipt.runId}:${receipt.id}` : '';
    const matching = !!receipt && receipt.configurationKey === calibration.key;
    const used = (calibration.currentResults ?? []).some((r) => r.receiptId === receipt?.id && r.runId === receipt?.runId);
    const awaitingFeedback = matching && !used && signature !== skipped;
    const connected = s.controllerConnection?.connected ?? connectionConfirmed;
    const inputMissing = s.controllerConnection?.inputConnected === false;
    const source = s.selectedSourceId ?? state.selectedSourceId;
    const differentSize = session.captureWidth > 0 && config.calibratedWidth > 0
        && (session.captureWidth !== config.calibratedWidth || session.captureHeight !== config.calibratedHeight);
    const accepted = !!calibration.accepted && !differentSize, successes = differentSize ? 0 : calibration.successfulTrials ?? 0;
    useEffect(() => { setFeedback({ timing: '', tempo: '' }); }, [signature]);
    async function run(action, args) {
        setBusy(action);
        setError('');
        try {
            return await command(action, args);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            throw e;
        }
        finally {
            setBusy('');
        }
    }
    const invoke = (action, args) => { void run(action, args).catch(() => { }); };
    // Pause only a practice trial explicitly started here after its new native receipt.
    // Opening the page or receiving an old receipt never changes controller output.
    useEffect(() => {
        if (!trial.current.active || !matching || signature === trial.current.before)
            return;
        trial.current.active = false;
        void run('armedSet', { armed: false }).catch(() => { });
    }, [signature, matching]);
    const edit = (key, value) => { setConfig((old) => ({ ...old, [key]: value })); setDirty(true); };
    const editTiming = (key, value) => { setTiming((old) => ({ ...old, [key]: value })); setDirty(true); };
    async function save(next = config, restart = false) {
        await run('signalConfigure', { ...meterArguments(next, timing), restart });
        setConfig(next);
        setDirty(false);
    }
    async function preview() {
        try {
            await save({ ...config, calibrationTrial: !accepted });
            await run('start', { loadModel: true });
        }
        catch { /* shown beside actions */ }
    }
    async function connect() {
        try {
            const result = await run('connectOutput');
            if (result?.connected === true)
                setConnectionConfirmed(true);
        }
        catch { /* shown beside actions */ }
    }
    async function begin() {
        trial.current = { active: !accepted, before: signature };
        try {
            await run('armedSet', { armed: true });
        }
        catch {
            trial.current.active = false;
        }
    }
    async function saveFeedback() {
        try {
            trial.current.active = false;
            if (output.armed)
                await run('armedSet', { armed: false });
            await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId, feedback });
            setFeedback({ timing: '', tempo: '' });
        }
        catch { /* retain selections on failure */ }
    }
    async function confirm() {
        try {
            if (output.armed)
                await run('armedSet', { armed: false });
            await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId, feedback: { confirmOnly: true } });
            await save({ ...config, calibrationTrial: false }, true);
        }
        catch { /* shown beside actions */ }
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
    function number(label, key, min, max, step = 1) {
        return React.createElement(Field, { key: key, label: label },
            React.createElement(Input, { type: "number", min: min, max: max, step: step, value: config[key], disabled: working || !!output.armed, onChange: e => edit(key, e.target.value === '' ? NaN : +e.target.value) }));
    }
    return React.createElement("div", { className: "page-stack meter-workflow" },
        React.createElement("style", null, styles),
        React.createElement(Card, { title: "Shot setup" },
            React.createElement("div", { className: "meter-profile-row" },
                React.createElement(ProfilePicker, { label: "Shot profile", value: profile?.id ?? '', disabled: locked || working || dirty, options: [{ id: '', name: 'Choose a shot profile', disabled: true }, ...(state.profiles ?? [])], onSelect: id => invoke('profileSelect', { id }), onCreate: () => editProfile() }),
                React.createElement(Button, { disabled: !profile || locked || working || dirty, onClick: () => editProfile(profile) },
                    React.createElement(Icon, { name: "pencil", size: 16 }),
                    "Edit profile"),
                React.createElement(Field, { label: "Shooting input" },
                    React.createElement(Select, { value: config.inputMode, disabled: locked || working, onValueChange: v => edit('inputMode', v) },
                        React.createElement(SelectOption, { value: "rhythm" }, "Rhythm \u00B7 right stick"),
                        React.createElement(SelectOption, { value: "button" }, "Shoot button")))),
            profile && React.createElement("p", { className: "subtle meter-profile-summary" },
                profile.cameraView,
                " camera \u00B7 ",
                profile.meterReleaseType || 'Release cue not set',
                " \u00B7 ",
                profile.usesShotMeter ? 'Meter on' : 'Meter off')),
        React.createElement("div", { className: "meter-layout" },
            React.createElement("div", { className: "meter-capture" },
                React.createElement(GameplayPreview, { status: s, window: captureWindow, onError: setError, actions: locked
                        ? React.createElement(Button, { active: !!session.running, disabled: !!s.stopping, onClick: () => { trial.current.active = false; invoke('stop'); } }, "Stop preview")
                        : React.createElement(Button, { active: false, disabled: working || !profile?.usesShotMeter || !source, busy: busy === 'start', onClick: () => void preview() }, "Start preview") }),
                React.createElement("details", { className: "meter-diagnostics" },
                    React.createElement("summary", null, "Detection details"),
                    React.createElement("p", { role: "status" }, signal.message || 'Detection runs when you hold the shooting input.'),
                    React.createElement("div", { className: "meter-readings" }, [['Fill', `${fmt(signal.progress * 100)}%`], ['Predicted target', `${fmt(signal.timeToTargetMs)} ms`],
                        ['Uncertainty', `${fmt(signal.uncertaintyMs)} ms`], ['Processing', `${fmt(signal.processingMs, 2)} ms`], ['Geometry score', fmt(signal.confidence, 2)]].map(([label, value]) => React.createElement("div", { key: label },
                        React.createElement("span", null, label),
                        React.createElement("strong", null, value)))))),
            React.createElement(Card, { title: accepted ? 'Meter assistance' : 'Calibrate your shot', className: "meter-practice" },
                React.createElement("div", { className: "meter-readiness", "aria-label": "Connection readiness" },
                    React.createElement("div", null,
                        React.createElement("span", null, "Gameplay"),
                        React.createElement("strong", null, session.sourceStale ? 'Stream paused' : session.running ? 'Capture running' : 'Preview stopped')),
                    React.createElement("div", null,
                        React.createElement("span", null, "Controller output"),
                        connected ? React.createElement("strong", { className: "meter-connected" },
                            React.createElement(Icon, { name: "check", size: 17 }),
                            "Connected")
                            : React.createElement(Button, { active: false, disabled: working || inputMissing, busy: busy === 'connectOutput', onClick: () => void connect() }, busy === 'connectOutput' ? 'Connecting…' : 'Connect controller'))),
                error && React.createElement(Notice, { tone: "danger" }, error),
                !output.armed && !awaitingFeedback && React.createElement("p", { role: "status" }, nextStep),
                output.armed ? React.createElement("div", { className: "stack" },
                    React.createElement(Notice, { tone: "info" }, accepted ? 'Meter assistance is on.' : 'Take one stationary shot. Hold the right stick down through the automatic reversal, then return to neutral.'),
                    output.message && React.createElement("p", { role: "status" }, output.message),
                    React.createElement(Button, { active: true, onClick: () => { trial.current.active = false; invoke('armedSet', { armed: false }); } },
                        "Pause ",
                        accepted ? 'assistance' : 'trial'))
                    : !awaitingFeedback && (accepted || successes < 3 || !matching) && React.createElement(Button, { active: false, className: "meter-primary", disabled: working || (prepare ? !connected || dirty : !ready), busy: busy === 'armedSet', onClick: () => { if (prepare) {
                            void save({ ...config, calibrationTrial: true }, true).catch(() => { });
                        }
                        else
                            void begin(); } },
                        React.createElement(Icon, { name: "play", size: 18 }),
                        prepare ? 'Prepare calibration' : accepted ? 'Start assistance' : 'Start practice trial'),
                !accepted && React.createElement(React.Fragment, null,
                    React.createElement("div", { className: "meter-progress", "aria-label": `${successes} of 3 matching Excellent results` },
                        React.createElement("strong", null,
                            successes,
                            " of 3"),
                        React.createElement("span", null, "matching Excellent results")),
                    awaitingFeedback ? React.createElement("div", { className: "meter-feedback" },
                        React.createElement("h3", null, "What did NBA 2K27 report?"),
                        React.createElement("p", { className: "subtle" }, "Enter the timing and tempo shown by the game after this shot."),
                        React.createElement(Field, { label: "Shot timing" },
                            React.createElement(Select, { value: feedback.timing, disabled: working, onValueChange: v => setFeedback(old => ({ ...old, timing: v })) },
                                React.createElement(SelectOption, { value: "", disabled: true }, "Choose timing\u2026"),
                                timingOptions.map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label)))),
                        config.inputMode === 'rhythm' && React.createElement(Field, { label: "Shot tempo" },
                            React.createElement(Select, { value: feedback.tempo, disabled: working, onValueChange: v => setFeedback(old => ({ ...old, tempo: v })) },
                                React.createElement(SelectOption, { value: "", disabled: true }, "Choose tempo\u2026"),
                                tempoOptions.map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label)))),
                        React.createElement("div", { className: "button-group" },
                            React.createElement(Button, { variant: "primary", busy: busy === 'signalFeedback', disabled: working || dirty || !feedback.timing || (config.inputMode === 'rhythm' && !feedback.tempo), onClick: () => void saveFeedback() }, "Save result"),
                            React.createElement(Button, { disabled: working, onClick: () => { setSkipped(signature); setFeedback({ timing: '', tempo: '' }); } }, "Skip this result")))
                        : React.createElement("p", { className: "subtle" }, used ? 'Result saved. Start another practice trial when ready.' : 'Shot feedback appears here after Studio completes a controller action.'),
                    successes >= 3 && React.createElement(Button, { variant: "primary", disabled: working || !matching || awaitingFeedback, onClick: () => void confirm() }, "Save calibration")),
                accepted && React.createElement("p", { className: "subtle" }, "Calibration saved for this profile, capture size and timing setup."))),
        React.createElement("details", { className: "meter-advanced" },
            React.createElement("summary", null, "Advanced settings"),
            React.createElement(Card, { title: "Timing & detection" },
                React.createElement("div", { className: "form-grid" },
                    React.createElement(Field, { label: "Game build" },
                        React.createElement(Input, { value: config.gameBuild, maxLength: 80, disabled: working || !!output.armed, onChange: e => edit('gameBuild', e.target.value) })),
                    number('Stroke duration · ms', 'strokeDurationMs', 8, 500),
                    number('Timing anchor · axis fraction', 'anchorFraction', 0, 1, .05),
                    number('Full-up hold · ms', 'upHoldMs', 0, 500),
                    number('Hold qualification · ms', 'holdMs', 0, 250),
                    number('Target fill', 'targetProgress', .7, 1.1, .01),
                    React.createElement(Field, { label: "Stroke curve" },
                        React.createElement(Select, { value: config.smoothStroke ? 'smooth' : 'linear', disabled: working || !!output.armed, onValueChange: v => edit('smoothStroke', v === 'smooth') },
                            React.createElement(SelectOption, { value: "linear" }, "Linear"),
                            React.createElement(SelectOption, { value: "smooth" }, "Smooth"))),
                    ['estimatedVideoDelayMs', 'estimatedInputDelayMs', 'correctionMs', 'maximumUncertaintyMs', 'minimumConfidence'].map((key, i) => React.createElement(Field, { key: key, label: ['Video delay estimate · ms', 'Input delay estimate · ms', 'Timing correction · ms', 'Maximum uncertainty · ms', 'Minimum geometry score'][i] },
                        React.createElement(Input, { type: "number", min: key === 'correctionMs' ? -1000 : 0, max: key === 'minimumConfidence' ? 1 : 1000, step: key === 'minimumConfidence' ? .05 : 1, value: timing[key] ?? 0, disabled: working || !!output.armed, onChange: e => editTiming(key, e.target.value === '' ? NaN : +e.target.value) }))),
                    config.inputMode === 'button' && React.createElement(Field, { label: "Shoot button" },
                        React.createElement(Select, { value: timing.shootButton ?? 'x', disabled: working || !!output.armed, onValueChange: v => { setTiming((old) => ({ ...old, shootButton: v })); setDirty(true); } }, [['x', 'X'], ['y', 'Y'], ['a', 'A'], ['b', 'B'], ['leftBumper', 'LB'], ['rightBumper', 'RB']].map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label))))),
                React.createElement("p", { className: "subtle" }, "A 0.5 timing anchor is the neutral crossing. Negative timing correction sends earlier; positive sends later. Applying changes pauses assistance and resumes the preview."),
                React.createElement("details", null,
                    React.createElement("summary", null, "Meter appearance & gameplay viewport"),
                    React.createElement("div", { className: "form-grid" },
                        number('Acquisition window · ms', 'acquisitionWindowMs', 100, 3000),
                        number('Target red', 'targetRed', 0, 255),
                        number('Target green', 'targetGreen', 0, 255),
                        number('Target blue', 'targetBlue', 0, 255),
                        number('Hue tolerance · degrees', 'colorToleranceDegrees', 5, 60),
                        ['left', 'top', 'width', 'height'].map(key => React.createElement(Field, { key: key, label: `Gameplay ${key} · fraction` },
                            React.createElement(Input, { type: "number", min: 0, max: 1, step: .01, value: config.viewport[key], disabled: working || !!output.armed, onChange: e => edit('viewport', { ...config.viewport, [key]: +e.target.value }) }))))),
                React.createElement("div", { className: "button-group" },
                    React.createElement(Button, { variant: "primary", disabled: working || !!output.armed || !profile || !dirty, busy: busy === 'signalConfigure', onClick: () => { void save(config, true).catch(() => { }); } }, "Apply settings"),
                    dirty && React.createElement(Button, { disabled: working, onClick: () => setDirty(false) }, "Discard changes")))));
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
