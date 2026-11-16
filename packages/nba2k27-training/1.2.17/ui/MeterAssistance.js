import { React, useEffect, useRef, useState, Button, Card, Field, Input, Notice, Select, SelectOption, ProfilePicker, GameplayPreview, Icon, useUnsavedChanges } from './host.js';
import { adjustMeterCalibration, successfulMeterResult } from './MeterCalibration.js';
export const meterDefaults = { version: 1, enabled: true, inputMode: 'rhythm', trigger: 'largeRight', style: 'curved', viewport: { left: 0, top: 0, width: 1, height: 1 },
    targetRed: 80, targetGreen: 210, targetBlue: 95, colorToleranceDegrees: 30, holdMs: 70, acquisitionWindowMs: 800, strokeDurationMs: 56, anchorFraction: .85,
    upHoldMs: 48, targetProgress: .75, smoothStroke: false, autoOcrTiming: true, calibrationTrial: false, confirmed: false, gameBuild: '', results: [], calibratedWidth: 0, calibratedHeight: 0 };
export function meterArguments(configuration, settings) {
    return { configuration, videoDelayMs: settings.estimatedVideoDelayMs ?? 0, inputDelayMs: settings.estimatedInputDelayMs ?? 0,
        correctionMs: settings.correctionMs ?? 0, minimumConfidence: settings.minimumConfidence ?? .65,
        maximumUncertaintyMs: settings.maximumUncertaintyMs ?? 12, shootButton: settings.shootButton ?? 'x' };
}
const fmt = (v, digits = 1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const triggerLabels = { largeRight: 'P4 · Large right paddle', largeLeft: 'P3 · Large left paddle',
    smallRight: 'P2 · Small right paddle', smallLeft: 'P1 · Small left paddle', physicalStick: 'Right stick (browser Remote Play)' };
const timingOptions = [['early', 'Early'], ['slightlyEarly', 'Slightly early'], ['excellent', 'Excellent'], ['slightlyLate', 'Slightly late'], ['late', 'Late']];
const tempoOptions = [['none', 'No tempo shown'], ['fast', 'Fast'], ['slightlyFast', 'Slightly fast'], ['excellent', 'Excellent'], ['slightlySlow', 'Slightly slow'], ['slow', 'Slow']];
const initialConfig = (s) => {
    const p = s.pluginAssistance;
    const hasExcellent = p?.results?.some((r) => successfulMeterResult(r, p.inputMode));
    const legacyUncalibrated = p && !p.confirmed && !hasExcellent && (p.inputMode ?? 'rhythm') === 'rhythm'
        && (p.targetProgress === 1 || p.targetProgress === .88);
    const legacyStick = p && p.confirmed && !p.trigger ? { trigger: 'physicalStick' } : {};
    return { ...meterDefaults, ...p, ...legacyStick, ...(legacyUncalibrated ? { strokeDurationMs: 56, anchorFraction: .85, targetProgress: .75 } : {}),
        enabled: true, gameBuild: p?.gameBuild || s.trainingCapture?.gameBuild || '' };
};
const initialTiming = (s) => {
    const p = s.pluginAssistance;
    const hasExcellent = p?.results?.some((r) => successfulMeterResult(r, p.inputMode));
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
    const [feedback, setFeedback] = useState({ timing: '', tempo: '', shotType: '' }), [skipped, setSkipped] = useState('');
    const [savedResult, setSavedResult] = useState('');
    const [autoSubmitPractice, setAutoSubmitPractice] = useState(false);
    const autoAppliedReceipt = useRef('');
    const [resultMessage, setResultMessage] = useState('');
    const [adjustmentFailed, setAdjustmentFailed] = useState(false);
    const savingFeedback = useRef(false);
    const appliedAdjustment = useRef(null);
    const [connectionConfirmed, setConnectionConfirmed] = useState(false);
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
    const locked = !!session.running || !!s.stopping || (!!s.diagnosticRecording && !s.diagnosticRecording.isFinalized), working = !!busy || !!s.busy;
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
    const ocr = s.ocrFeedback;
    const ocrMatches = !!ocr && !!receipt && ocr.receiptId === receipt.id && ocr.runId === receipt.runId;
    useEffect(() => { setFeedback({ timing: '', tempo: '', shotType: '' }); }, [signature]);
    useEffect(() => {
        if (!awaitingFeedback || !ocrMatches || !config.autoOcrTiming)
            return;
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
                    try {
                        await run('armedSet', { armed: true });
                        trial.current.active = true;
                    }
                    catch { /* shown in UI */ }
                }
            })();
        }
    }, [awaitingFeedback, ocrMatches, signature, config.autoOcrTiming, autoSubmitPractice]);
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
        const operation = { epoch: lifecycle.current.epoch, cancelled: false, armAttempted: false, trial: practiceTrial(signature) };
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
    async function saveFeedbackWith(chosen = feedback) {
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
            await run('signalFeedback', { receiptId: receipt.id, runId: receipt.runId,
                feedback: config.inputMode === 'rhythm' ? chosen : { timing: chosen.timing, tempo: 'none' } });
            resultSaved = true;
            setSkipped(signature);
            setSavedResult(signature);
            const adjustment = adjustMeterCalibration(config, timing, chosen, calibration.tuningContextKey);
            setFeedback({ timing: '', tempo: '', shotType: '' });
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
                        React.createElement(SelectOption, { value: "button" }, "Shoot button"))),
                config.inputMode === 'rhythm' && React.createElement(Field, { label: "Shot trigger" },
                    React.createElement(Select, { value: config.trigger ?? 'largeRight', disabled: locked || working, onValueChange: v => edit('trigger', v) }, Object.entries(triggerLabels).map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label))))),
            profile && React.createElement("p", { className: "subtle meter-profile-summary" },
                profile.cameraView,
                " camera \u00B7 ",
                profile.meterReleaseType || 'Release cue not set',
                " \u00B7 ",
                profile.usesShotMeter ? 'Meter on' : 'Meter off'),
            config.inputMode === 'rhythm' && (config.trigger ?? 'largeRight') !== 'physicalStick' && React.createElement("p", { className: "subtle meter-profile-summary" }, "Paddle trigger: map the selected paddle to its PC Profile Numpad key in Xbox Accessories so the Xbox app ignores it and Studio drives the full virtual stick stroke. Keep the physical right stick centered.")),
        React.createElement("div", { className: "meter-layout" },
            React.createElement("div", { className: "meter-capture" },
                React.createElement(GameplayPreview, { status: s, window: captureWindow, onError: setError, actions: locked
                        ? React.createElement(Button, { active: !!session.running, disabled: !!s.stopping, onClick: () => void stopPreview() }, "Stop preview")
                        : React.createElement(Button, { active: false, disabled: working || !profile?.usesShotMeter || !source, busy: busy === 'start', onClick: () => void preview() }, "Start preview") }),
                React.createElement(Card, { title: "Diagnostic recording", description: "Save gameplay frames and detection telemetry for up to 15 seconds." },
                    React.createElement("p", { className: "subtle" }, output.armed
                        ? accepted
                            ? 'Automatic reversal is on. Recording captures your live assisted shots.'
                            : 'Automatic reversal is on for one practice shot. Recording captures your shot; assistance still pauses after it finishes.'
                        : 'Automatic reversal is off. Recording captures observations only — start assistance or a practice trial first to record with assistance on.'),
                    React.createElement("div", { className: "button-group" },
                        React.createElement(Button, { active: recordingDiagnostics, disabled: savingDiagnostics || (!recordingDiagnostics && (working || !session.running || !!s.stopping || !!s.training?.isRecording)), busy: busy === 'diagnosticStart', onClick: () => invoke(recordingDiagnostics ? 'diagnosticStop' : 'diagnosticStart') }, recordingDiagnostics ? 'Stop diagnostic recording' : 'Record diagnostics'),
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
                    React.createElement(Notice, { tone: "info" }, accepted ? 'Meter assistance is on.'
                        : config.inputMode === 'rhythm' && (config.trigger ?? 'largeRight') !== 'physicalStick'
                            ? `Take one stationary shot. Hold ${triggerLabels[config.trigger ?? 'largeRight'] ?? 'the selected paddle'} down through the automatic reversal, then release it. Keep the right stick centered.`
                            : 'Take one stationary shot. Hold the right stick down through the automatic reversal, then return to neutral.'),
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
                        React.createElement("p", { className: "subtle" }, config.inputMode === 'rhythm'
                            ? "Copy the game's feedback heading and result. RHYTHM Excellent counts without a separate tempo grade. TIMING alone does not confirm a rhythm shot."
                            : 'Enter the timing shown by the game. Saving adjusts the next trial; Excellent settings stay unchanged.'),
                        config.inputMode === 'rhythm' && React.createElement(Field, { label: "Feedback heading" },
                            React.createElement(Select, { value: feedback.shotType, disabled: working, onValueChange: v => setFeedback(old => ({ ...old, shotType: v, tempo: v === 'timing' ? 'none' : old.tempo || 'none' })) },
                                React.createElement(SelectOption, { value: "", disabled: true }, "Choose heading\u2026"),
                                React.createElement(SelectOption, { value: "rhythm" }, "RHYTHM"),
                                React.createElement(SelectOption, { value: "timing" }, "TIMING"))),
                        React.createElement(Field, { label: "Shot timing" },
                            React.createElement(Select, { value: feedback.timing, disabled: working, onValueChange: v => setFeedback(old => ({ ...old, timing: v })) },
                                React.createElement(SelectOption, { value: "", disabled: true }, "Choose timing\u2026"),
                                timingOptions.map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label)))),
                        config.inputMode === 'rhythm' && React.createElement(Field, { label: "Shot tempo" },
                            React.createElement(Select, { value: feedback.tempo, disabled: working || feedback.shotType === 'timing', onValueChange: v => setFeedback(old => ({ ...old, tempo: v })) },
                                React.createElement(SelectOption, { value: "", disabled: true }, "Choose tempo\u2026"),
                                tempoOptions.map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label)))),
                        React.createElement("div", { className: "button-group" },
                            React.createElement(Button, { variant: "primary", busy: busy === 'signalFeedback', disabled: working || dirty || !feedback.timing || (config.inputMode === 'rhythm' && (!feedback.shotType || !feedback.tempo)), onClick: () => void saveFeedbackWith() }, "Save result"),
                            React.createElement(Button, { disabled: working, onClick: () => { setSkipped(signature); setFeedback({ timing: '', tempo: '', shotType: '' }); } }, "Skip this result")))
                        : React.createElement("p", { className: "subtle" }, used ? 'Result saved. Start another practice trial when ready.' : 'Shot feedback appears here after Studio completes a controller action.'),
                    successes >= 3 && React.createElement(Button, { variant: "primary", disabled: working || !matching || awaitingFeedback, onClick: () => void confirm() }, "Save calibration")),
                accepted && React.createElement("p", { className: "subtle" }, "Calibration saved for this profile, capture size and timing setup."),
                React.createElement("div", { className: "meter-ocr-box" },
                    React.createElement("label", { className: "meter-ocr-toggle" },
                        React.createElement("input", { type: "checkbox", checked: config.autoOcrTiming !== false, disabled: working || !!output.armed, onChange: e => { const next = { ...config, autoOcrTiming: e.target.checked }; setConfig(next); if (profile)
                                void save(next, true).catch(() => { }); } }),
                        React.createElement("span", null, "Auto-adapt timing from shot feedback (OCR)")),
                    !accepted && React.createElement("label", { className: "meter-ocr-toggle" },
                        React.createElement("input", { type: "checkbox", checked: autoSubmitPractice, disabled: working || config.autoOcrTiming === false, onChange: e => setAutoSubmitPractice(e.target.checked) }),
                        React.createElement("span", null, "Auto-save OCR practice results & re-arm")),
                    ocr?.message && React.createElement("p", { className: "subtle", role: "status" },
                        ocr.message,
                        ocr.rawText ? ` (${ocr.rawText})` : '')))),
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
.meter-connected{display:flex;align-items:center;gap:6px;color:var(--success)}.meter-primary{width:100%;margin:4px 0 12px}.meter-progress{display:flex;align-items:baseline;gap:10px;padding:16px 0;border-bottom:1px solid var(--line)}
.meter-progress strong{font-size:24px}.meter-progress span{font-size:14px;color:var(--muted)}.meter-feedback{display:grid;gap:12px;margin-top:16px}.meter-feedback h3,.meter-feedback p{margin:0}
.meter-diagnostics,.meter-advanced{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:16px}.meter-diagnostics summary,.meter-advanced>summary{cursor:pointer;font-weight:600;font-size:14px}
.meter-advanced[open]>summary{margin-bottom:16px}.meter-advanced>.card{border:0;padding:8px 0 0}.meter-readings{display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:12px;margin-top:16px}
.meter-readings>div{display:grid;gap:6px}.meter-readings span{font-size:14px;color:var(--muted)}
.meter-ocr-box{display:grid;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.meter-ocr-toggle{display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer}.meter-ocr-box p{margin:0}
@media(max-width:1080px){.meter-layout{grid-template-columns:minmax(0,1fr)}}
`;
