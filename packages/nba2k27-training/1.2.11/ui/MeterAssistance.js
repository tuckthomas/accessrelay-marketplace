import { React, useEffect, useRef, useState, Button, Card, Field, Input, Notice, Select, SelectOption, ProfilePicker, GameplayPreview, Icon, useUnsavedChanges } from './host.js';
import { adjustMeterCalibration } from './MeterCalibration.js';
export const meterDefaults = { version: 1, enabled: true, inputMode: 'rhythm', style: 'curved', viewport: { left: 0, top: 0, width: 1, height: 1 },
    targetRed: 80, targetGreen: 210, targetBlue: 95, colorToleranceDegrees: 30, holdMs: 70, acquisitionWindowMs: 800, strokeDurationMs: 56, anchorFraction: .85,
    upHoldMs: 48, targetProgress: .75, smoothStroke: false, calibrationTrial: false, confirmed: false, gameBuild: '', results: [], calibratedWidth: 0, calibratedHeight: 0 };
export function meterArguments(configuration, settings) {
    return { configuration, videoDelayMs: settings.estimatedVideoDelayMs ?? 0, inputDelayMs: settings.estimatedInputDelayMs ?? 0,
        correctionMs: settings.correctionMs ?? 0, minimumConfidence: settings.minimumConfidence ?? .65,
        maximumUncertaintyMs: settings.maximumUncertaintyMs ?? 12, shootButton: settings.shootButton ?? 'x' };
}
const fmt = (v, digits = 1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const timingOptions = [['early', 'Early'], ['slightlyEarly', 'Slightly early'], ['excellent', 'Excellent'], ['slightlyLate', 'Slightly late'], ['late', 'Late']];
const tempoOptions = [['none', 'No tempo shown'], ['fast', 'Fast'], ['slightlyFast', 'Slightly fast'], ['excellent', 'Excellent'], ['slightlySlow', 'Slightly slow'], ['slow', 'Slow']];
const initialConfig = (s) => {
    const p = s.pluginAssistance;
    const hasExcellent = p?.results?.some((r) => r.timing === 'excellent' && ((p.inputMode ?? 'rhythm') === 'button' || r.tempo === 'excellent'));
    const legacyUncalibrated = p && !p.confirmed && !hasExcellent && (p.inputMode ?? 'rhythm') === 'rhythm'
        && (p.targetProgress === 1 || p.targetProgress === .88);
    return { ...meterDefaults, ...p, ...(legacyUncalibrated ? { strokeDurationMs: 56, anchorFraction: .85, targetProgress: .75 } : {}),
        enabled: true, gameBuild: p?.gameBuild || s.trainingCapture?.gameBuild || '' };
};
const initialTiming = (s) => {
    const p = s.pluginAssistance;
    const hasExcellent = p?.results?.some((r) => r.timing === 'excellent' && ((p.inputMode ?? 'rhythm') === 'button' || r.tempo === 'excellent'));
    const uncalibrated = !p?.confirmed && !hasExcellent;
    const zeroDelays = (s.estimatedVideoDelayMs ?? 0) === 0 && (s.estimatedInputDelayMs ?? 0) === 0 && (s.correctionMs ?? 0) === 0;
    const legacyLateTarget = uncalibrated && (p?.inputMode ?? 'rhythm') === 'rhythm' && (p?.targetProgress === 1 || p?.targetProgress === .88);
    return { ...s, minimumConfidence: p?.enabled ? s.minimumConfidence : .65,
        maximumUncertaintyMs: p?.enabled ? s.maximumUncertaintyMs : 12,
        ...(uncalibrated && zeroDelays ? { estimatedVideoDelayMs: 60, estimatedInputDelayMs: 15 } : {}),
        ...(legacyLateTarget && (s.correctionMs ?? 0) < 0 ? { correctionMs: 0 } : {}) };
};
const practiceTrial = (before = '') => ({ active: false, before, pauseStarted: false, pausePromise: null });
const emptySettings = {};
export function MeterAssistance({ state = {}, status, command, captureWindow, editProfile }) {
    const saved = state.settings ?? emptySettings, s = status ?? state.status ?? {}, session = s.session ?? {}, signal = s.signal ?? {}, profile = state.selectedProfile;
    const [config, setConfig] = useState(() => initialConfig(saved)), [timing, setTiming] = useState(() => initialTiming(saved));
    const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
    const [feedback, setFeedback] = useState({ timing: '', tempo: '' }), [skipped, setSkipped] = useState('');
    const [savedResult, setSavedResult] = useState('');
    const [resultMessage, setResultMessage] = useState('');
    const [adjustmentFailed, setAdjustmentFailed] = useState(false);
    const savingFeedback = useRef(false);
    const appliedAdjustment = useRef(null);
    const [connectionConfirmed, setConnectionConfirmed] = useState(false);
    const [startingAssistedRecording, setStartingAssistedRecording] = useState(false);
    const trial = useRef(practiceTrial());
    const commandRef = useRef(command), lifecycle = useRef({ mounted: false, epoch: 0 });
    const starting = useRef(null);
    commandRef.current = command;
    useEffect(() => {
        lifecycle.current.mounted = true;
        lifecycle.current.epoch++;
        return () => {
            lifecycle.current.mounted = false;
            lifecycle.current.epoch++;
            const pending = starting.current;
            if (pending) {
                pending.cancelled = true;
                void cleanupStart(pending);
            }
            else if (trial.current.active)
                void pauseTrial(trial.current);
        };
    }, []);
    useUnsavedChanges(dirty);
    useEffect(() => {
        if (dirty)
            return;
        const expected = appliedAdjustment.current;
        if (expected && (saved.correctionMs !== expected.correctionMs || saved.pluginAssistance?.strokeDurationMs !== expected.strokeDurationMs))
            return;
        appliedAdjustment.current = null;
        setConfig(initialConfig(saved));
        setTiming(initialTiming(saved));
    }, [saved, dirty]);
    const locked = !!session.running || !!s.stopping || (!!s.diagnosticRecording && !s.diagnosticRecording.isFinalized), working = !!busy || !!s.busy || startingAssistedRecording;
    const output = s.output ?? {}, calibration = state.assistance ?? {}, receipt = s.lastAction;
    const diagnostic = s.diagnosticRecording, recordingDiagnostics = !!diagnostic?.isRecording;
    const savingDiagnostics = !!diagnostic && !diagnostic.isRecording && !diagnostic.isFinalized;
    const signature = receipt ? `${receipt.runId}:${receipt.id}` : '';
    const matching = !!receipt && receipt.configurationKey === calibration.key;
    const used = (calibration.currentResults ?? []).some((r) => r.receiptId === receipt?.id && r.runId === receipt?.runId);
    const connected = s.controllerConnection?.connected ?? connectionConfirmed;
    const inputMissing = s.controllerConnection?.inputConnected === false;
    const source = s.selectedSourceId ?? state.selectedSourceId;
    const differentSize = session.captureWidth > 0 && config.calibratedWidth > 0
        && (session.captureWidth !== config.calibratedWidth || session.captureHeight !== config.calibratedHeight);
    const accepted = !!calibration.accepted && !differentSize, successes = differentSize ? 0 : calibration.successfulTrials ?? 0;
    const awaitingFeedback = !accepted && matching && !used && signature !== skipped;
    useEffect(() => { setFeedback({ timing: '', tempo: '' }); }, [signature]);
    async function run(action, args) {
        if (lifecycle.current.mounted) {
            setBusy(action);
            setError('');
        }
        try {
            return await commandRef.current(action, args);
        }
        catch (e) {
            if (lifecycle.current.mounted)
                setError(e instanceof Error ? e.message : String(e));
            throw e;
        }
        finally {
            if (lifecycle.current.mounted)
                setBusy('');
        }
    }
    const invoke = (action, args) => { void run(action, args).catch(() => { }); };
    async function pauseTrial(owner, force = false) {
        if (owner.pausePromise) {
            const message = await owner.pausePromise;
            if (!force)
                return message;
        }
        if (!owner.active && !force)
            return '';
        owner.pauseStarted = true;
        if (lifecycle.current.mounted)
            setBusy('armedSet');
        owner.pausePromise = (async () => {
            try {
                await commandRef.current('armedSet', { armed: false });
                owner.active = false;
                return '';
            }
            catch (e) {
                let message = `Could not pause automatic reversal: ${e instanceof Error ? e.message : String(e)}`;
                try {
                    await commandRef.current('stop');
                    owner.active = false;
                    message += ' Preview stopped to disable assistance.';
                }
                catch (stopError) {
                    message += ` Preview could not be stopped: ${stopError instanceof Error ? stopError.message : String(stopError)}`;
                }
                if (lifecycle.current.mounted)
                    setError(message);
                return message;
            }
        })();
        try {
            return await owner.pausePromise;
        }
        finally {
            owner.pausePromise = null;
            if (lifecycle.current.mounted)
                setBusy('');
        }
    }
    function startOperation() {
        const operation = { epoch: lifecycle.current.epoch, cancelled: false, recording: false,
            armAttempted: false, trial: practiceTrial(signature) };
        starting.current = operation;
        return operation;
    }
    const currentStart = (operation) => lifecycle.current.mounted && !operation.cancelled
        && operation.epoch === lifecycle.current.epoch && starting.current === operation;
    async function cleanupStart(operation, afterArm = false) {
        const errors = [];
        if (operation.armAttempted) {
            const message = await pauseTrial(operation.trial, afterArm || !operation.trial.active);
            if (message)
                errors.push(message);
        }
        if (operation.recording) {
            operation.recording = false;
            try {
                await commandRef.current('diagnosticStop');
            }
            catch (e) {
                errors.push(`Could not stop the diagnostic recording: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        return errors;
    }
    function cancelStart() { if (starting.current)
        starting.current.cancelled = true; }
    async function pauseAssistance() {
        cancelStart();
        await pauseTrial(trial.current, true);
    }
    async function stopPreview() {
        cancelStart();
        try {
            await run('stop');
            trial.current.active = false;
        }
        catch { /* Keep ownership so navigation can retry disabling this trial. */ }
    }
    // Pause only a practice trial explicitly started here after its new native receipt.
    // Opening the page or receiving an old receipt never changes controller output.
    useEffect(() => {
        if (!trial.current.active || trial.current.pauseStarted || !matching || signature === trial.current.before)
            return;
        void pauseTrial(trial.current);
    }, [signature, matching]);
    const edit = (key, value) => { setConfig((old) => ({ ...old, [key]: value })); setDirty(true); };
    const editTiming = (key, value) => { setTiming((old) => ({ ...old, [key]: value })); setDirty(true); };
    async function save(next = config, restart = false) {
        if (appliedAdjustment.current)
            appliedAdjustment.current = { correctionMs: timing.correctionMs ?? 0, strokeDurationMs: next.strokeDurationMs };
        await run('signalConfigure', { ...meterArguments(next, timing), restart });
        setConfig(next);
        setDirty(false);
        if (savedResult)
            setResultMessage('Result saved. Timing settings applied for the next trial. Start the next practice trial when ready.');
        setAdjustmentFailed(false);
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
        setSavedResult('');
        const operation = startOperation();
        trial.current = operation.trial;
        operation.trial.active = !accepted;
        operation.armAttempted = true;
        try {
            await run('armedSet', { armed: true });
            if (!currentStart(operation))
                await cleanupStart(operation, true);
        }
        catch {
            await cleanupStart(operation, true);
        }
        finally {
            if (starting.current === operation)
                starting.current = null;
        }
    }
    async function recordAssisted() {
        setStartingAssistedRecording(true);
        const operation = startOperation();
        try {
            // The explicit assisted action records first so the enabled trial is captured.
            await run('diagnosticStart');
            operation.recording = true;
            if (!currentStart(operation)) {
                await cleanupStart(operation);
                return;
            }
            trial.current = operation.trial;
            operation.trial.active = !accepted;
            operation.armAttempted = true;
            await run('armedSet', { armed: true });
            if (!currentStart(operation)) {
                await cleanupStart(operation, true);
                return;
            }
            // Keep an unsaved result available if recording or arming fails.
            if (awaitingFeedback)
                setSkipped(signature);
            setSavedResult('');
            setFeedback({ timing: '', tempo: '' });
        }
        catch (e) {
            const cleanupErrors = await cleanupStart(operation, true);
            if (lifecycle.current.mounted)
                setError([e instanceof Error ? e.message : String(e), ...cleanupErrors].join(' '));
        }
        finally {
            if (starting.current === operation)
                starting.current = null;
            if (lifecycle.current.mounted)
                setStartingAssistedRecording(false);
        }
    }
    async function saveFeedback() {
        if (savingFeedback.current)
            return;
        savingFeedback.current = true;
        setAdjustmentFailed(false);
        let resultSaved = false;
        try {
            cancelStart();
            if (output.armed)
                await run('armedSet', { armed: false });
            trial.current.active = false;
            await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId, feedback });
            resultSaved = true;
            setSkipped(signature);
            setSavedResult(signature);
            const adjustment = adjustMeterCalibration(config, timing, feedback, calibration.tuningContextKey);
            setFeedback({ timing: '', tempo: '' });
            if (adjustment.changed) {
                // Save the receipt against its original settings first. The host retains
                // that history when configuring the next trial and restarts disarmed.
                setDirty(true);
                setConfig(adjustment.configuration);
                setTiming(adjustment.timing);
                appliedAdjustment.current = { correctionMs: adjustment.timing.correctionMs, strokeDurationMs: adjustment.configuration.strokeDurationMs };
                await run('signalConfigure', { ...meterArguments(adjustment.configuration, adjustment.timing), restart: true });
                setDirty(false);
            }
            setResultMessage(`Result saved. ${adjustment.message} Start the next practice trial when ready.`);
        }
        catch {
            if (resultSaved) {
                setAdjustmentFailed(true);
                setResultMessage('Result saved, but the next-trial adjustment could not be applied. Retry the adjustment before starting another trial.');
            }
            // Keep selections if saving failed; keep the proposed settings if applying failed.
        }
        finally {
            savingFeedback.current = false;
        }
    }
    async function confirm() {
        try {
            cancelStart();
            if (output.armed)
                await run('armedSet', { armed: false });
            trial.current.active = false;
            await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId, feedback: { confirmOnly: true } });
            await save({ ...config, calibrationTrial: false }, true);
        }
        catch { /* shown beside actions */ }
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
                        ? React.createElement(Button, { active: !!session.running, disabled: !!s.stopping, onClick: () => void stopPreview() }, "Stop preview")
                        : React.createElement(Button, { active: false, disabled: working || !profile?.usesShotMeter || !source, busy: busy === 'start', onClick: () => void preview() }, "Start preview") }),
                React.createElement(Card, { title: "Diagnostic recording", description: "Save gameplay frames and detection details from a failed attempt." },
                    React.createElement("p", { className: "subtle" }, output.armed
                        ? accepted ? 'Automatic reversal is on. Record diagnostics captures up to 15 seconds without changing assistance.'
                            : 'Automatic reversal is on for one practice shot. Record diagnostics captures up to 15 seconds; assistance still pauses after the completed action.'
                        : accepted ? 'Automatic reversal is off. Record diagnostics captures observations only. Record assisted shots enables assistance and records up to 15 seconds.'
                            : 'Automatic reversal is off. Record diagnostics captures observations only. Record an assisted trial to enable and capture one automatic reversal.'),
                    !output.armed && React.createElement(React.Fragment, null,
                        awaitingFeedback && React.createElement(Notice, { tone: "info" }, "The previous result has not been saved. Starting the next recorded trial skips that feedback; saved calibration results are kept."),
                        React.createElement(Button, { active: false, className: "meter-primary", disabled: working || !ready || recordingDiagnostics || savingDiagnostics || !!s.training?.isRecording, busy: startingAssistedRecording, onClick: () => void recordAssisted() }, awaitingFeedback ? 'Skip result and record next trial' : accepted ? 'Record assisted shots' : 'Record assisted trial')),
                    React.createElement("div", { className: "button-group" },
                        React.createElement(Button, { active: recordingDiagnostics, disabled: startingAssistedRecording || savingDiagnostics || (!recordingDiagnostics && (working || !session.running || !!s.stopping || !!s.training?.isRecording)), busy: busy === 'diagnosticStart', onClick: () => invoke(recordingDiagnostics ? 'diagnosticStop' : 'diagnosticStart') }, recordingDiagnostics ? 'Stop diagnostic recording' : 'Record diagnostics'),
                        diagnostic?.isFinalized && React.createElement(Button, { disabled: working, onClick: () => invoke('openDiagnosticFolder') }, "Open diagnostic folder")),
                    diagnostic && React.createElement("div", { role: "status", "aria-live": "polite" },
                        React.createElement("p", null, diagnostic.message),
                        React.createElement("p", { className: "subtle" },
                            diagnostic.observedFrames ?? 0,
                            " frames analyzed \u00B7 ",
                            diagnostic.storedFrames ?? 0,
                            " images saved \u00B7 ",
                            diagnostic.droppedFrames ?? 0,
                            " images skipped")),
                    diagnostic?.failed && React.createElement(Notice, { tone: "danger" }, "The diagnostic recording could not finish. Open its folder to inspect any saved evidence.")),
                React.createElement("details", { className: "meter-diagnostics" },
                    React.createElement("summary", null, "Detection details"),
                    React.createElement("p", { role: "status" }, signal.message || 'Detection runs when you hold the shooting input.'),
                    React.createElement("div", { className: "meter-readings" }, [['Fill', `${fmt(signal.progress * 100)}%`], ['Predicted target', `${fmt(signal.timeToTargetMs)} ms`],
                        ['Fill velocity', signal.continueCommittedAction ? '—' : `${fmt(signal.velocityPerMs * 1000 * 100)}% / s`], ['Samples', signal.samples ?? 0],
                        ['Action phase', signal.continueCommittedAction ? output.armed ? 'Finishing anchored stroke' : 'Observation only — assistance off'
                                : signal.invalidateAttempt ? 'Attempt cancelled' : signal.timeToTargetMs != null ? output.armed ? 'Live forecast' : 'Observation only — assistance off' : 'Observing'],
                        ['Uncertainty', signal.continueCommittedAction ? '—' : `${fmt(signal.uncertaintyMs)} ms`], ['Processing', `${fmt(signal.processingMs, 2)} ms`], ['Geometry score', fmt(signal.confidence, 2)]].map(([label, value]) => React.createElement("div", { key: label },
                        React.createElement("span", null, label),
                        React.createElement("strong", null, value)))))),
            React.createElement(Card, { title: accepted ? 'Meter assistance' : 'Calibrate your shot', className: "meter-practice" },
                React.createElement("div", { className: "meter-assistance-state", role: "status", "aria-live": "polite" },
                    React.createElement("span", null, "Automatic reversal"),
                    React.createElement("strong", { className: output.armed ? 'meter-connected' : '' }, output.armed ? 'On' : 'Off'),
                    React.createElement("p", null, output.armed ? accepted ? 'Assistance stays on until you pause it.' : 'One practice shot is armed. Assistance pauses after the completed action so you can save its result.'
                        : awaitingFeedback ? 'Practice action completed. Automatic reversal is off. Save or skip this result before starting another trial.'
                            : 'Automatic reversal is disabled. Gameplay capture and detection can continue while assistance is off.')),
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
                savedResult && (!signature || savedResult === signature) && resultMessage && React.createElement(Notice, { tone: "info" }, resultMessage),
                adjustmentFailed && dirty && React.createElement(Button, { disabled: working || !!output.armed, onClick: () => { void save(config, true).catch(() => { }); } }, "Retry adjustment"),
                !output.armed && !awaitingFeedback && React.createElement("p", { role: "status" }, nextStep),
                output.armed ? React.createElement("div", { className: "stack" },
                    React.createElement(Notice, { tone: "info" }, accepted ? 'Meter assistance is on.' : 'Take one stationary shot. Hold the right stick down through the automatic reversal, then return to neutral.'),
                    output.message && React.createElement("p", { role: "status" }, output.message),
                    React.createElement(Button, { active: true, onClick: () => void pauseAssistance() },
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
                        React.createElement("p", { className: "subtle" }, "Enter the timing and tempo shown by the game. Saving adjusts the next trial; Excellent settings stay unchanged."),
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
                    dirty && React.createElement(Button, { disabled: working, onClick: () => {
                            appliedAdjustment.current = null;
                            setDirty(false);
                            setAdjustmentFailed(false);
                            if (savedResult)
                                setResultMessage('Result saved. Proposed timing changes discarded. The previous timing settings will be used.');
                        } }, "Discard changes")))));
}
const styles = `
.meter-profile-row{display:flex;align-items:end;gap:16px;flex-wrap:wrap}.meter-profile-row>.field,.meter-profile-row>.profile-picker{flex:1;min-width:220px}.meter-profile-summary{margin:16px 0 0}
.meter-layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(340px,.85fr);gap:20px;align-items:start}.meter-layout>*{min-width:0}.meter-capture{display:grid;gap:16px}
.meter-readiness{display:grid;margin-bottom:16px}.meter-readiness>div{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:52px;padding:10px 0;border-bottom:1px solid var(--line)}
.meter-assistance-state{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;padding:16px;margin-bottom:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.meter-assistance-state>span{font-weight:600}.meter-assistance-state>strong{font-size:24px}.meter-assistance-state>p{grid-column:1/-1;margin:0;font-size:14px}
.meter-connected{display:flex;align-items:center;gap:6px;color:var(--success)}.meter-primary{width:100%;margin:4px 0 12px}.meter-progress{display:flex;align-items:baseline;gap:10px;padding:16px 0;border-bottom:1px solid var(--line)}
.meter-progress strong{font-size:24px}.meter-progress span{font-size:14px;color:var(--muted)}.meter-feedback{display:grid;gap:12px;margin-top:16px}.meter-feedback h3,.meter-feedback p{margin:0}
.meter-diagnostics,.meter-advanced{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:16px}.meter-diagnostics summary,.meter-advanced>summary{cursor:pointer;font-weight:600;font-size:14px}
.meter-advanced[open]>summary{margin-bottom:16px}.meter-advanced>.card{border:0;padding:8px 0 0}.meter-readings{display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:12px;margin-top:16px}
.meter-readings>div{display:grid;gap:6px}.meter-readings span{font-size:14px;color:var(--muted)}
@media(max-width:1080px){.meter-layout{grid-template-columns:minmax(0,1fr)}}
`;
