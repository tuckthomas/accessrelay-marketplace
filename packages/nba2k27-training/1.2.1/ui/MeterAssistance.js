import { React, useEffect, useState, Button, Card, Field, Input, Notice, Select, SelectOption, Toggle, ProfilePicker, GameplayPreview, useUnsavedChanges } from './host.js';
export const meterDefaults = { version: 1, enabled: true, inputMode: 'rhythm', style: 'curved', viewport: { left: 0, top: 0, width: 1, height: 1 },
    targetRed: 80, targetGreen: 210, targetBlue: 95, colorToleranceDegrees: 30, holdMs: 70, acquisitionWindowMs: 800, strokeDurationMs: 80, anchorFraction: .5,
    upHoldMs: 48, targetProgress: 1, smoothStroke: false, calibrationTrial: false, confirmed: false, gameBuild: '', results: [], calibratedWidth: 0, calibratedHeight: 0 };
export function meterArguments(configuration, settings) {
    return { configuration, videoDelayMs: settings.estimatedVideoDelayMs ?? 0, inputDelayMs: settings.estimatedInputDelayMs ?? 0,
        correctionMs: settings.correctionMs ?? 0, minimumConfidence: settings.minimumConfidence ?? .65,
        maximumUncertaintyMs: settings.maximumUncertaintyMs ?? 12, shootButton: settings.shootButton ?? 'x' };
}
const fmt = (value, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
export function MeterAssistance({ state = {}, status, command, captureWindow, editProfile }) {
    const saved = state.settings ?? {}, s = status ?? state.status ?? {}, session = s.session ?? {}, signal = s.signal ?? {}, profile = state.selectedProfile;
    const [config, setConfig] = useState(() => ({ ...meterDefaults, ...saved.pluginAssistance, enabled: true,
        gameBuild: saved.pluginAssistance?.gameBuild || saved.trainingCapture?.gameBuild || '' }));
    const [timing, setTiming] = useState({ ...saved, minimumConfidence: saved.pluginAssistance?.enabled ? saved.minimumConfidence : .65,
        maximumUncertaintyMs: saved.pluginAssistance?.enabled ? saved.maximumUncertaintyMs : 12 });
    const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
    const [feedback, setFeedback] = useState({ timing: 'excellent', tempo: 'excellent' });
    useUnsavedChanges(dirty);
    useEffect(() => {
        if (!dirty) {
            setConfig({ ...meterDefaults, ...saved.pluginAssistance, enabled: true,
                gameBuild: saved.pluginAssistance?.gameBuild || saved.trainingCapture?.gameBuild || '' });
            setTiming({ ...saved,
                minimumConfidence: saved.pluginAssistance?.enabled ? saved.minimumConfidence : .65, maximumUncertaintyMs: saved.pluginAssistance?.enabled ? saved.maximumUncertaintyMs : 12 });
        }
    }, [saved, dirty]);
    const locked = !!session.running || !!s.stopping, working = !!busy || !!s.busy;
    const output = s.output ?? {}, calibration = state.assistance ?? {}, receipt = s.lastAction;
    const used = (calibration.currentResults ?? []).some((r) => r.receiptId === receipt?.id && r.runId === receipt?.runId);
    const currentReceipt = receipt && receipt.configurationKey === calibration.key;
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
    const edit = (key, value) => { setConfig((old) => ({ ...old, [key]: value })); setDirty(true); };
    const editTiming = (key, value) => { setTiming((old) => ({ ...old, [key]: value })); setDirty(true); };
    const save = async () => { await run('signalConfigure', meterArguments(config, timing)); setDirty(false); };
    const start = async () => { try {
        await save();
        await run('start', { loadModel: true });
    }
    catch { /* error shown below */ } };
    async function saveFeedback(confirmOnly = false) {
        try {
            if (output.armed)
                await run('armedSet', { armed: false });
            await run('signalFeedback', { feedback: { ...feedback, confirmOnly } });
        }
        catch { /* error shown below */ }
    }
    function number(label, key, min, max, step = 1) {
        return React.createElement(Field, { key: key, label: label },
            React.createElement(Input, { type: "number", min: min, max: max, step: step, value: config[key], disabled: locked || working, onChange: e => edit(key, e.target.value === '' ? NaN : +e.target.value) }));
    }
    return React.createElement("div", { className: "page-stack" },
        error && React.createElement(Notice, { tone: "danger" }, error),
        React.createElement(Card, { title: "Shot meter assistance" },
            React.createElement("div", { className: "form-grid" },
                React.createElement(ProfilePicker, { label: "Shot profile", value: profile?.id ?? '', disabled: locked || working || dirty, options: [{ id: '', name: 'Choose a meter-on profile', disabled: true }, ...(state.profiles ?? [])], onSelect: id => invoke('profileSelect', { id }), onCreate: () => editProfile() }),
                React.createElement("div", { className: "button-group" },
                    React.createElement(Button, { disabled: !profile || locked || working || dirty, onClick: () => editProfile(profile) }, "Edit shot profile")),
                React.createElement(Field, { label: "Shooting input" },
                    React.createElement(Select, { value: config.inputMode, disabled: locked || working, onValueChange: v => edit('inputMode', v) },
                        React.createElement(SelectOption, { value: "rhythm" }, "Rhythm \u00B7 right stick"),
                        React.createElement(SelectOption, { value: "button" }, "Shoot button"))),
                config.inputMode === 'button' && React.createElement(Field, { label: "Shoot button" },
                    React.createElement(Select, { value: timing.shootButton ?? 'x', disabled: locked || working, onValueChange: v => { setTiming((old) => ({ ...old, shootButton: v })); setDirty(true); } }, [['x', 'X'], ['y', 'Y'], ['a', 'A'], ['b', 'B'], ['leftBumper', 'LB'], ['rightBumper', 'RB']].map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label)))),
                React.createElement(Field, { label: "Meter style" },
                    React.createElement(Select, { value: config.style, disabled: locked || working, onValueChange: v => edit('style', v) },
                        React.createElement(SelectOption, { value: "curved" }, "Curved"))),
                React.createElement(Field, { label: "Game build" },
                    React.createElement(Input, { value: config.gameBuild, maxLength: 80, disabled: locked || working, placeholder: "For example, 2.0.0.12", onChange: e => edit('gameBuild', e.target.value) }))),
            profile && !profile.usesShotMeter && React.createElement(Notice, { tone: "warning" }, "Select a meter-on profile and turn the curved meter on in NBA 2K27."),
            React.createElement("p", { className: "subtle" }, "Finds the meter across the gameplay viewport, then follows its moving region. No player tracking or AI model is required."),
            React.createElement("div", { className: "button-group" },
                React.createElement(Button, { variant: "primary", disabled: !profile || locked || working || !dirty, onClick: () => { void save().catch(() => { }); } }, "Save settings"),
                dirty && React.createElement(Button, { disabled: locked || working, onClick: () => setDirty(false) }, "Discard changes"),
                React.createElement(Button, { disabled: locked || working || !profile || !profile.usesShotMeter, onClick: () => { edit('calibrationTrial', true); } }, "Set up calibration trial"))),
        React.createElement(GameplayPreview, { status: s, window: captureWindow, onError: setError, actions: locked
                ? React.createElement(Button, { disabled: !!s.stopping, onClick: () => invoke('stop') }, "Stop analysis")
                : React.createElement(Button, { variant: "primary", disabled: working || !profile?.usesShotMeter || !(s.selectedSourceId ?? state.selectedSourceId), onClick: () => void start() }, "Start meter analysis") }),
        React.createElement(Card, { title: "Meter tracking" },
            React.createElement("p", { role: "status" }, signal.message || 'Start analysis, then take a manual shot to check detection.'),
            React.createElement("div", { className: "form-grid" }, [['Fill', `${fmt(signal.progress * 100)}%`], ['Target forecast', `${fmt(signal.timeToTargetMs)} ms`],
                ['Forecast uncertainty', `${fmt(signal.uncertaintyMs)} ms`], ['Detector', `${fmt(signal.processingMs, 2)} ms`],
                ['Geometry score', fmt(signal.confidence, 2)]].map(([label, value]) => React.createElement("div", { key: label },
                React.createElement("span", { className: "subtle" }, label),
                React.createElement("p", null,
                    React.createElement("strong", null, value))))),
            React.createElement("p", { className: "subtle" }, session.message),
            React.createElement("div", { className: "button-group" },
                React.createElement(Button, { disabled: working, onClick: () => invoke('connectOutput') }, "Connect controller output")),
            React.createElement(Toggle, { label: config.calibrationTrial ? 'Enable calibration trial' : 'Enable meter assistance', checked: !!output.armed, disabled: working || (!output.armed && !session.canArm), onChange: armed => invoke('armedSet', { armed }) }),
            !calibration.accepted && React.createElement("p", { className: "subtle" },
                "Normal assistance requires three saved Excellent timing",
                config.inputMode === 'rhythm' ? ' and tempo' : '',
                " results for the same setup, followed by confirmation.")),
        React.createElement(Card, { title: "Timing & rhythm calibration" },
            React.createElement(Toggle, { label: "Calibration trial", checked: config.calibrationTrial, disabled: locked || working, onChange: value => edit('calibrationTrial', value) }),
            React.createElement("p", { className: "subtle" }, "Trial mode permits unverified settings while you calibrate in practice. Start analysis, connect output, enable the trial, and hold the physical shooting input through the completed action."),
            React.createElement("div", { className: "form-grid" },
                number('Hold qualification · ms', 'holdMs', 0, 250),
                config.inputMode === 'rhythm' && React.createElement(React.Fragment, null,
                    number('Down-to-up stroke · ms', 'strokeDurationMs', 8, 500),
                    number('Timing anchor · axis travel fraction', 'anchorFraction', 0, 1, .05),
                    number('Full-up hold · ms', 'upHoldMs', 0, 500),
                    React.createElement(Field, { label: "Stroke curve" },
                        React.createElement(Select, { value: config.smoothStroke ? 'smooth' : 'linear', disabled: locked || working, onValueChange: v => edit('smoothStroke', v === 'smooth') },
                            React.createElement(SelectOption, { value: "linear" }, "Linear"),
                            React.createElement(SelectOption, { value: "smooth" }, "Smooth")))),
                number('Target fill', 'targetProgress', .7, 1.1, .01),
                ['estimatedVideoDelayMs', 'estimatedInputDelayMs', 'correctionMs', 'maximumUncertaintyMs', 'minimumConfidence'].map((key, i) => React.createElement(Field, { key: key, label: ['Video delay estimate · ms', 'Input delay estimate · ms', 'Timing correction · ms', 'Maximum forecast uncertainty · ms', 'Minimum geometry score'][i] },
                    React.createElement(Input, { type: "number", min: key === 'correctionMs' ? -1000 : 0, max: key === 'minimumConfidence' ? 1 : 1000, step: key === 'minimumConfidence' ? .05 : 1, value: timing[key] ?? 0, disabled: locked || working, onChange: e => editTiming(key, e.target.value === '' ? NaN : +e.target.value) })))),
            React.createElement("p", { className: "subtle" }, "An anchor of 0.5 means the neutral crossing. For a linear 80 ms stroke, motion starts 40 ms before that anchor. Delay fields are estimates until measured; local processing age is already accounted for."),
            React.createElement("details", null,
                React.createElement("summary", null, "Meter appearance & gameplay viewport"),
                React.createElement("div", { className: "form-grid" },
                    number('Acquisition window after hold · ms', 'acquisitionWindowMs', 100, 3000),
                    number('Target red', 'targetRed', 0, 255),
                    number('Target green', 'targetGreen', 0, 255),
                    number('Target blue', 'targetBlue', 0, 255),
                    number('Hue tolerance · degrees', 'colorToleranceDegrees', 5, 60),
                    ['left', 'top', 'width', 'height'].map(key => React.createElement(Field, { key: key, label: `Gameplay ${key} · fraction` },
                        React.createElement(Input, { type: "number", min: 0, max: 1, step: .01, value: config.viewport[key], disabled: locked || working, onChange: e => edit('viewport', { ...config.viewport, [key]: +e.target.value }) }))))),
            React.createElement("div", { className: "button-group" },
                React.createElement(Button, { disabled: locked || working || !profile || !dirty, onClick: () => { void save().catch(() => { }); } }, "Save calibration settings")),
            React.createElement("h3", null, "Shot feedback"),
            React.createElement("p", null,
                calibration.successfulTrials ?? 0,
                " / 3 Excellent results for this setup",
                calibration.accepted ? ' · calibration confirmed' : ''),
            React.createElement("div", { className: "form-grid" },
                React.createElement(Field, { label: "Timing" },
                    React.createElement(Select, { value: feedback.timing, disabled: working, onValueChange: v => setFeedback(old => ({ ...old, timing: v })) }, [['early', 'Early'], ['slightlyEarly', 'Slightly early'], ['excellent', 'Excellent'], ['slightlyLate', 'Slightly late'], ['late', 'Late']].map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label)))),
                config.inputMode === 'rhythm' && React.createElement(Field, { label: "Tempo" },
                    React.createElement(Select, { value: feedback.tempo, disabled: working, onValueChange: v => setFeedback(old => ({ ...old, tempo: v })) }, [['fast', 'Fast'], ['slightlyFast', 'Slightly fast'], ['excellent', 'Excellent'], ['slightlySlow', 'Slightly slow'], ['slow', 'Slow']].map(([value, label]) => React.createElement(SelectOption, { key: value, value: value }, label))))),
            React.createElement("div", { className: "button-group" },
                React.createElement(Button, { disabled: working || !currentReceipt || used || dirty, onClick: () => void saveFeedback() }, "Save shot feedback"),
                React.createElement(Button, { variant: "primary", disabled: working || !currentReceipt || dirty || (calibration.successfulTrials ?? 0) < 3 || calibration.accepted, onClick: () => void saveFeedback(true) }, "Confirm calibration")),
            React.createElement("p", { className: "subtle" }, "Saving feedback disables assistance. After confirmation, stop and restart analysis to use the saved calibration. Profile, build, source, resolution or timing changes require a matching calibration.")));
}
