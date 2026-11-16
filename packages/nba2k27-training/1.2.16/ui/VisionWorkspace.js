import { React, useEffect, useRef, useState, ProfilePicker, GameplayPreview, Select, SelectOption, Input, Slider, Checkbox, Badge, Button, Card, DiscardDialog, EmptyState, Field, Icon, Modal, Notice, Tabs, Toggle, hasUnsavedChanges, useUnsavedChanges } from './host.js';
import { MeterAssistance, meterArguments, meterDefaults } from './MeterAssistance.js';
const full = { left: 0, top: 0, width: 1, height: 1 };
const areas = [
    ['Gameplay', 'var(--roi-player)', 'Keep the full gameplay picture, including the court and space above it for raised hands and the ball. Leave out browser controls and black bars.'],
    ['Player anchor', 'var(--roi-meter)', 'Mark your intended player once, including their body and feet. Tracking follows the torso; the captured region adds room for raised hands and the ball.'],
    ['Meter anchor', 'var(--roi-feedback)', 'Mark the full meter search area while it is visible. Its position and size follow the player anchor.'],
    ['Shot feedback', 'var(--roi-identity)', 'Include the fixed HUD panel where timing, tempo and contest feedback appear.'],
    ['Court anchor', 'var(--accent)', 'Click four floor corners in order around the court. Court markings track camera motion; this outline does not crop the player’s upper body.'],
];
const categories = ['Mixed / unclassified', 'Stationary', 'Catch-and-shoot', 'Off-dribble', 'Pull-up', 'Fade / leaner', 'Step-back', 'Free throw'];
const num = (value, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
const fresh = () => ({ id: crypto.randomUUID(), name: '', heightInches: 78, threePointRating: 80, base: '', upperRelease1: '', upperRelease2: '', usesShotMeter: true, meterReleaseType: '', shotSpeed: 4, release1Percent: 50, cameraView: '2K', gamertag: '' });
export function Nba2K27VisionWorkspace(props) {
    const [method, setMethod] = useState(props.state?.settings?.pluginAssistance?.enabled === false ? 'animation' : 'meter');
    const [editor, setEditor] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [pendingMethod, setPendingMethod] = useState(null);
    const s = props.status ?? props.state?.status ?? {};
    async function switchMethod(next) {
        if (next === method)
            return;
        setError('');
        setBusy(true);
        try {
            if (props.state?.selectedProfile)
                await props.command('signalConfigure', meterArguments({ ...meterDefaults,
                    ...props.state?.settings?.pluginAssistance, enabled: next === 'meter' }, props.state?.settings ?? {}));
            setMethod(next);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    }
    // Training owns clip recording and review regardless of the selected Live
    // assistance method. Opening training must never configure or arm output.
    if (props.mode === 'training')
        return React.createElement(AnimationWorkspace, { ...props });
    return React.createElement("div", { className: "page-stack" },
        React.createElement("style", null, styles),
        React.createElement(Field, { label: "Assistance method" },
            React.createElement(Select, { value: method, disabled: busy || !!s.session?.running || !!s.stopping, onValueChange: next => { if (hasUnsavedChanges())
                    setPendingMethod(next);
                else
                    void switchMethod(next); } },
                React.createElement(SelectOption, { value: "meter" }, "Shot meter \u00B7 direct detection"),
                React.createElement(SelectOption, { value: "animation" }, "Animation model \u00B7 meter off"))),
        error && React.createElement(Notice, { tone: "danger" }, error),
        method === 'meter' ? React.createElement(MeterAssistance, { ...props, editProfile: profile => setEditor(profile ? { ...profile } : fresh()) }) : React.createElement(AnimationWorkspace, { ...props }),
        React.createElement(DiscardDialog, { open: pendingMethod !== null, onKeep: () => setPendingMethod(null), onDiscard: () => { const next = pendingMethod; setPendingMethod(null); if (next)
                void switchMethod(next); } }),
        editor && React.createElement(ProfileEditor, { key: editor.id, profile: editor, isSaved: (props.state?.profiles ?? []).some((p) => p.id === editor.id), fingerprint: editor.id === props.state?.selectedProfile?.id ? props.state?.selectedFingerprint : '', busy: busy, error: error, close: () => setEditor(null), run: async (action, args, done) => {
                setBusy(true);
                setError('');
                try {
                    const result = await props.command(action, args);
                    done?.(result);
                    return result;
                }
                catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                }
                finally {
                    setBusy(false);
                }
            } }));
}
function AnimationWorkspace({ state = {}, status, command, mode, captureWindow }) {
    const [tab, setTab] = useState('capture'), [busy, setBusy] = useState(''), [error, setError] = useState('');
    const [editor, setEditor] = useState(null), [frozen, setFrozen] = useState(null), [review, setReview] = useState(state?.review);
    const [settings, setSettings] = useState(state?.settings ?? {}), [dirty, setDirty] = useState(false);
    const [runName, setRunName] = useState('Vision practice run');
    const [epochs, setEpochs] = useState(20), [trainingDevice, setTrainingDevice] = useState('cpu');
    const [nextAction, setNextAction] = useState(null), [draftEpoch, setDraftEpoch] = useState(0);
    useUnsavedChanges(dirty);
    const transition = (action) => { if (hasUnsavedChanges())
        setNextAction(() => action);
    else
        action(); };
    const s = status ?? state?.status ?? {}, session = s.session ?? {}, training = s.training ?? {}, profile = state?.selectedProfile;
    const selectedSourceId = s.selectedSourceId ?? state?.selectedSourceId ?? '';
    const locked = !!session.running || !!s.stopping, saving = !!training.hasTake && !training.isFinalized, recording = !!training.isRecording;
    const job = s.trainingJob ?? state.trainingJob ?? {};
    const working = !!busy || !!s.busy || job.state === 'running', context = !!profile && !!selectedSourceId, ready = (s.captureLayoutConfirmed ?? !!state?.settings?.trainingCapture?.configured) && (mode !== 'training' || ['automatic', 'anchored'].includes(state?.settings?.trainingCapture?.evidenceMode));
    const gpuPreparation = settings.preprocessingBackend === 'd3D11Cuda';
    const recordHint = !profile ? 'Choose a saved shot profile first.' : !selectedSourceId ? 'Choose the Gameplay window first.' : !ready ? 'Detect the NBA capture areas before recording.' : saving ? 'The previous clip is finishing.' : working ? 'Another vision action is finishing.' : 'Save up to 10 seconds of gameplay and controller input.';
    useEffect(() => { if (!dirty)
        setSettings(state?.settings ?? {}); }, [state?.settings, dirty]);
    useEffect(() => setReview(state?.review), [state?.review]);
    const seenProposal = useRef('');
    useEffect(() => { const proposal = s.captureProposal; if (proposal?.token && proposal.token !== seenProposal.current) {
        seenProposal.current = proposal.token;
        setFrozen(proposal);
    } }, [s.captureProposal]);
    const run = async (action, args, done) => {
        setError('');
        setBusy(action);
        try {
            const result = await command(action, args);
            done?.(result);
            return result;
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return undefined;
        }
        finally {
            setBusy('');
        }
    };
    const change = (key, value) => { setSettings((old) => ({ ...old, [key]: value })); setDirty(true); };
    return React.createElement("div", { className: "page-stack vision-page" },
        React.createElement("style", null, styles),
        mode === 'training' && React.createElement(Tabs, { value: tab, onChange: next => { if (next !== tab)
                transition(() => setTab(next)); }, ariaLabel: "Training workspace", items: [{ id: 'capture', label: 'Record clips' }, { id: 'clips', label: 'Clips & review' }, { id: 'train', label: 'Train model' }] }),
        error && React.createElement(Notice, { tone: "danger" }, error),
        (mode === 'live' || tab === 'capture') && React.createElement(React.Fragment, null,
            React.createElement(Card, null,
                React.createElement("div", { className: "vision-context-heading" },
                    React.createElement("span", { className: "vision-step" }, "1"),
                    React.createElement("div", null,
                        React.createElement("h2", null, "Your player and game"),
                        React.createElement("p", { className: "subtle" }, "One setup keeps your jump shot and camera together."))),
                React.createElement("div", { className: "vision-context-grid" },
                    React.createElement(ProfilePicker, { label: "Shot profile", value: profile?.id ?? '', disabled: locked || working, options: [{ id: '', name: 'Choose a shot profile', disabled: true }, ...(state?.profiles ?? [])], onSelect: id => transition(() => run('profileSelect', { id })), onCreate: () => setEditor(fresh()) }),
                    React.createElement("div", { className: "vision-context-actions" },
                        React.createElement(Button, { variant: "ghost", disabled: !profile || locked || working, onClick: () => setEditor({ ...profile }) },
                            React.createElement(Icon, { name: "pencil", size: 16 }),
                            "Edit"))),
                profile && React.createElement("div", { className: "vision-summary" },
                    React.createElement("span", null,
                        Math.floor(profile.heightInches / 12),
                        "\u2032 ",
                        profile.heightInches % 12,
                        "\u2033 \u00B7 ",
                        profile.threePointRating,
                        " three-point"),
                    React.createElement("span", null, profile.base),
                    React.createElement("span", null,
                        profile.cameraView,
                        " camera"),
                    React.createElement(Badge, { tone: "mint" }, profile.usesShotMeter ? 'Meter on' : 'Meter off')))),
        mode === 'training' && tab === 'capture' && React.createElement(React.Fragment, null,
            s.tracking && React.createElement(Notice, { tone: s.tracking.valid ? 'info' : 'warning' }, s.tracking.message),
            React.createElement("div", { className: "vision-capture-grid" },
                React.createElement("section", { className: "vision-preview" },
                    React.createElement("div", { className: "vision-preview-head" },
                        React.createElement("div", null,
                            React.createElement("p", { className: "eyebrow" }, "GAMEPLAY PREVIEW"),
                            React.createElement("h2", null, session.running ? 'Your live view' : 'Check the picture first')),
                        React.createElement("div", { className: "vision-preview-actions" },
                            locked ? React.createElement(Button, { active: !!session.running, onClick: () => run('stop') },
                                React.createElement(Icon, { name: "stop", size: 16 }),
                                "Stop preview") : React.createElement(Button, { active: false, disabled: !context || working, busy: busy === 'start', onClick: () => run('start', { loadModel: false }) },
                                React.createElement(Icon, { name: "play", size: 17 }),
                                "Start preview"),
                            recording ? React.createElement(Button, { active: true, "aria-label": "Stop training clip recording", onClick: () => run('recordStop') },
                                React.createElement(Icon, { name: "stop", size: 16 }),
                                "Stop recording") : React.createElement(Button, { active: false, disabled: !context || !ready || working || saving, busy: busy === 'recordStart', title: recordHint, "aria-describedby": "vision-recording-hint", onClick: () => run('recordStart') },
                                React.createElement(Icon, { name: "circle", size: 16 }),
                                "Record training clip"))),
                    React.createElement("div", { className: "vision-recording-state", id: "vision-recording-hint", role: "status" },
                        React.createElement(Icon, { name: recording ? 'circle' : training.isComplete ? 'check' : 'info', size: 16 }),
                        React.createElement("span", null, recording ? `Recording · ${(training.storedFrames ?? 0).toLocaleString()} frames written` : saving ? 'Saving your training clip…' : training.isComplete ? `Clip saved · ${(training.storedFrames ?? 0).toLocaleString()} frames` : ready ? 'Viewing only · Use Record training clip to save footage.' : recordHint)),
                    React.createElement("div", { className: "vision-stage" }, captureWindow?.detached ? React.createElement("div", { className: "vision-stage-empty" },
                        React.createElement("p", null, "Capture is open in a separate window."),
                        React.createElement(Button, { onClick: () => { void captureWindow.attach?.().catch(e => setError(String(e.message))); } }, "Bring back")) : s.preview?.url ? React.createElement(React.Fragment, null,
                        React.createElement("img", { src: s.preview.url, alt: session.running ? 'Live gameplay capture' : 'Last captured gameplay preview' }),
                        s.tracking && React.createElement(AnchorOverlay, { tracking: s.tracking, width: s.preview.sourceWidth, height: s.preview.sourceHeight }),
                        React.createElement("span", { className: "vision-stage-badge" },
                            React.createElement(Badge, { tone: session.running ? 'success' : 'neutral' }, session.running ? 'Preview · not saved' : 'Last preview')))
                        : React.createElement("div", { className: "vision-stage-empty" },
                            React.createElement("span", null,
                                React.createElement(Icon, { name: "camera", size: 42 })),
                            React.createElement("h3", null, "Your gameplay belongs here"),
                            React.createElement("p", null, context ? 'Start a preview to check the picture before recording.' : 'Choose a shot profile and the window showing Remote Play.'),
                            !profile && React.createElement(Button, { onClick: () => setEditor(fresh()) }, "Create a shot profile"))),
                    React.createElement("div", { className: "vision-preview-foot" },
                        React.createElement("span", null, s.preview?.sourceWidth ? `${s.preview.sourceWidth} × ${s.preview.sourceHeight}` : 'Source resolution appears here'),
                        React.createElement("span", null, session.frames ? `${session.frames.toLocaleString()} frames viewed` : 'Viewing alone does not save footage'))),
                React.createElement("div", { className: "vision-aside" },
                    React.createElement(Card, { title: "Capture areas", description: state?.settings?.trainingCapture?.configured && state.settings.trainingCapture.evidenceMode === 'anchored' ? 'Manual appearance setup; player identity is not verified.' : 'Detect your player by gamertag and body joints. Follow the player and meter; keep feedback fixed.', actions: React.createElement("span", { className: "vision-step" }, "2") },
                        React.createElement("div", { className: "vision-areas" }, [areas[1], areas[2], areas[4], areas[3]].map(([label, color]) => React.createElement("div", { key: label },
                            React.createElement("i", { style: { background: color } }),
                            label,
                            React.createElement(Icon, { name: ready ? 'check' : 'circle', size: 15 })))),
                        React.createElement("p", { className: "subtle" }, profile?.gamertag ? `Player: ${profile.gamertag}` : 'Add your exact displayed gamertag to the shot profile first.'),
                        React.createElement(Button, { disabled: !context || !profile?.gamertag?.trim() || locked || working || saving, busy: busy === 'detectAreas', onClick: () => run('detectAreas', undefined, result => { if (result?.token)
                                setFrozen(result); }) },
                            React.createElement(Icon, { name: "search", size: 17 }),
                            "Detect capture areas"),
                        React.createElement("p", { className: "subtle" }, "Setup saves reference frames and a full gameplay clip when the shot starts."),
                        React.createElement("details", { className: "vision-details" },
                            React.createElement("summary", null, "Manual capture setup"),
                            React.createElement(Button, { disabled: !context || working || saving, onClick: () => run('freeze', { nextShot: !!profile?.usesShotMeter }, result => setFrozen(result)) }, "Open manual setup"))),
                    React.createElement(Card, { title: recording ? 'Recording your clip' : saving ? 'Saving your clip' : training.isComplete ? 'Your last clip is saved' : 'Keep the evidence together', actions: React.createElement("span", { className: "vision-step" }, "3"), description: recording ? 'Return to Remote Play. Keep playing through the shot feedback.' : saving ? 'Images and controller samples are being finalized.' : training.isComplete ? `${training.storedFrames?.toLocaleString() ?? 0} synchronized frames saved.` : 'Full gameplay and controller input. Up to 10 seconds.' },
                        React.createElement("div", { className: "stack" },
                            recording ? React.createElement(Button, { active: true, onClick: () => run('recordStop') },
                                React.createElement(Icon, { name: "stop", size: 17 }),
                                "Stop recording") : React.createElement(Button, { active: false, disabled: !context || !ready || working || saving, busy: busy === 'recordStart', onClick: () => run('recordStart') },
                                React.createElement(Icon, { name: "circle", size: 16 }),
                                "Record a clip"),
                            training.isComplete && React.createElement(Button, { disabled: working, onClick: () => run('reviewOpen', { latest: true }, result => { if (result) {
                                    setReview(result);
                                    setTab('clips');
                                } }) },
                                React.createElement(Icon, { name: "eye", size: 17 }),
                                "Review last clip"),
                            !!training.droppedFrames && React.createElement("p", { className: "subtle" },
                                training.droppedFrames.toLocaleString(),
                                " capture frames dropped."),
                            training.hasTake && training.isFinalized && !training.isComplete && React.createElement(Notice, { tone: "warning" }, "This clip is incomplete. Retained evidence is available in its folder."),
                            training.hasTake && React.createElement(Button, { variant: "ghost", onClick: () => run('openClipFolder') },
                                React.createElement(Icon, { name: "folder", size: 16 }),
                                "Open clip folder"))))),
            s.notice && React.createElement("p", { className: "vision-status-line", role: "status" },
                React.createElement(Icon, { name: "info", size: 17 }),
                s.notice),
            React.createElement("details", { className: "vision-details" },
                React.createElement("summary", null, "How clips become training evidence"),
                React.createElement("div", { className: "stack" },
                    React.createElement("p", null, "Meter-on footage records progression, tempo and later shot feedback. Meter-off validation uses a separate purpose and the actual meter-off setup."),
                    React.createElement("p", null, "The full gameplay scene and controller trace are retained. Opening a clip prepares moving player and meter regions offline, using the configured gamertag and pose detection. Frames with lost identity or overlapping HUD are excluded from training and remain in the original recording. Review player framing, shot coverage and target phases before training.")))),
        mode === 'training' && tab === 'clips' && React.createElement(React.Fragment, null,
            React.createElement(Card, { title: "Find a useful moment", description: "Review the player, meter and shot feedback on one timeline.", actions: React.createElement("div", { className: "button-group" },
                    React.createElement(Button, { disabled: !training.isComplete || working, onClick: () => transition(() => run('reviewOpen', { latest: true }, result => result && setReview(result))) }, "Open last clip"),
                    React.createElement(Button, { variant: "primary", disabled: working, onClick: () => transition(() => run('reviewOpen', {}, result => result && setReview(result))) },
                        React.createElement(Icon, { name: "folder", size: 17 }),
                        "Open a clip")) },
                review?.preparation && React.createElement(Notice, { tone: "info" },
                    review.preparation.retainedFrameCount,
                    " of ",
                    review.preparation.sourceFrameCount,
                    " frames have usable player crops. Excluded frames remain in the original clip. Check that each shot has complete coverage."),
                !review && React.createElement(EmptyState, { icon: "camera", title: "Give every shot some context", description: "Open a completed clip to inspect its regions, mark shot intervals and save reviewed labels." })),
            review && React.createElement(ClipReview, { key: review.token + ':' + draftEpoch, review: review, busy: working, save: labels => run('reviewSave', { token: review.token, labels }) })),
        mode === 'training' && tab === 'train' && React.createElement(Card, { title: "Train NBA 2K27 model", description: profile ? profile.name : 'Choose a shot profile in Record clips first.' },
            React.createElement("div", { className: "stack" },
                React.createElement("div", { className: "form-grid" },
                    React.createElement(Field, { label: "Training device" },
                        React.createElement(Select, { value: trainingDevice, disabled: working, onValueChange: setTrainingDevice },
                            React.createElement(SelectOption, { value: "cpu" }, "CPU"),
                            React.createElement(SelectOption, { value: "cuda" }, "NVIDIA GPU \u00B7 CUDA"))),
                    React.createElement(NumberField, { label: "Training passes (epochs)", min: 1, max: 200, value: epochs, disabled: working, onChange: setEpochs })),
                React.createElement("p", { className: "subtle" }, "Use reviewed meter-on training clips, meter-off validation clips, and a separate meter-off clip saved as Configuration reference. Each training and validation group needs shooting and negative intervals."),
                React.createElement("div", { className: "button-group" },
                    job.state === 'running' ? React.createElement(Button, { variant: "danger", onClick: () => run('trainingCancel') }, "Stop training") : React.createElement(Button, { variant: "primary", disabled: locked || working || !profile, onClick: () => run('trainingStart', { epochs, device: trainingDevice }) }, "Train and validate"),
                    job.result?.trainingSucceeded && React.createElement(Button, { disabled: locked || working, onClick: () => run('trainingImport') }, "Import candidate for observation"),
                    job.directory && React.createElement(Button, { onClick: () => run('trainingOpenFolder') }, "Open results folder")),
                job.message && React.createElement(Notice, { tone: job.state === 'failed' ? 'danger' : job.state === 'running' ? 'info' : 'success' }, job.message),
                job.result?.validationError && React.createElement(Notice, { tone: "warning" }, job.result.validationError),
                job.result?.metrics && React.createElement("div", { className: "vision-metrics" },
                    React.createElement(Metric, { label: "Timing error p99", value: num(job.result.metrics.timingP99ms), unit: "ms" }),
                    React.createElement(Metric, { label: "Target shot coverage", value: num(job.result.metrics.targetShotCoverage * 100), unit: "%" })),
                job.result && React.createElement("p", { className: "subtle" }, "This is an experimental candidate. Held-out evaluation, hardware timing and automatic-release acceptance are separate."))),
        mode === 'live' && React.createElement(React.Fragment, null,
            React.createElement(GameplayPreview, { status: s, window: captureWindow, onError: setError, actions: locked
                    ? React.createElement(Button, { active: true, disabled: !!s.stopping, onClick: () => run('stop') },
                        React.createElement(Icon, { name: "stop", size: 17 }),
                        "Stop capture")
                    : React.createElement(Button, { active: false, disabled: !context || working, busy: busy === 'start', onClick: () => run('start', { loadModel: false }) },
                        React.createElement(Icon, { name: "play", size: 17 }),
                        "Start capture") }),
            React.createElement(Card, { title: "A model for this shot", description: "Capture and clip review work without a model. Import a compatible package when it is ready.", actions: React.createElement("div", { className: "button-group" },
                    React.createElement(Button, { disabled: locked || working, onClick: () => run('modelRefresh') },
                        React.createElement(Icon, { name: "refresh", size: 16 }),
                        "Refresh"),
                    React.createElement(Button, { variant: "primary", disabled: locked || working, busy: busy === 'modelImport', onClick: () => run('modelImport') },
                        React.createElement(Icon, { name: "upload", size: 17 }),
                        "Import model package")) },
                state?.models?.length ? React.createElement("div", { className: "stack" },
                    React.createElement(Field, { label: "Installed model" },
                        React.createElement(Select, { value: state.selectedModelId ?? '', disabled: locked || working, onValueChange: selectionValue => run('modelSelect', { id: selectionValue }) },
                            React.createElement(SelectOption, { value: "" }, "No model \u00B7 capture only"),
                            state.models.map((model) => React.createElement(SelectOption, { key: model.id, value: model.id, disabled: !model.compatible },
                                model.name,
                                " \u00B7 ",
                                model.version,
                                !model.compatible ? ' · another setup' : '')))),
                    state.models.filter((model) => model.id === state.selectedModelId).map((model) => React.createElement(Notice, { key: model.id, tone: model.evidenceAccepted ? 'success' : 'info' }, model.status)))
                    : React.createElement(EmptyState, { icon: "folder", title: state?.modelScanComplete === false ? 'Checking your model library' : 'No gameplay model installed', description: "Community detectors are possible building blocks. A validated no-meter release model is not bundled with this beta." }),
                (state?.modelErrors ?? []).map((message) => React.createElement(Notice, { tone: "warning", key: message }, message))),
            React.createElement("div", { className: "vision-assistance-grid" },
                React.createElement(Card, { title: "Live analysis", description: "Observe the model before enabling release assistance." },
                    React.createElement("div", { className: "stack" },
                        React.createElement("div", { className: "button-group" },
                            React.createElement(Button, { active: !!session.running && !!session.modelReady, disabled: !state?.selectedModelId || !context || locked || working, onClick: () => run('start', { loadModel: true }) },
                                React.createElement(Icon, { name: "play", size: 17 }),
                                "Start analysis"),
                            React.createElement(Button, { active: !!session.running, disabled: !locked, onClick: () => run('stop') }, "Stop"),
                            React.createElement(Button, { active: !!s.controllerConnection?.connected, disabled: working, onClick: () => run('connectOutput') }, "Connect controller output")),
                        React.createElement(Toggle, { label: "Automatic release", description: "Requires accepted model, accuracy and hardware evidence. Starts disarmed.", checked: !!s.output?.armed, disabled: gpuPreparation || !session.canArm || working, onChange: armed => run('armedSet', { armed }) }),
                        gpuPreparation && React.createElement(Notice, { tone: "info" }, "Experimental GPU preparation is observation-only. Automatic release remains unavailable until matching hardware validation."),
                        React.createElement("p", { className: "subtle" }, s.output?.message ?? session.message ?? 'Choose the shot profile, source and model first.'))),
                React.createElement(Card, { title: "Timing on this PC", description: "Local pipeline measurements. Remote Play\u2019s upstream delay is separate." },
                    React.createElement("div", { className: "vision-metrics" },
                        React.createElement(Metric, { label: "Decision p95", value: num(s.performance?.frameToDecision?.p95Ms), unit: "ms" }),
                        React.createElement(Metric, { label: "Decision p99", value: num(s.performance?.frameToDecision?.p99Ms), unit: "ms" }),
                        React.createElement(Metric, { label: "Model decisions", value: s.performance?.totalDecisions ?? 0 }),
                        React.createElement(Metric, { label: "Missed deadlines", value: s.performance?.missedDeadlines ?? 0 })),
                    React.createElement("p", { className: "subtle" },
                        s.performance?.executionProvider ?? 'No analysis running',
                        s.performance?.preprocessingBackend === 'd3d11-cuda-rgb-v2-experimental' ? ' · Experimental GPU preparation' : s.performance?.modelManifestHash ? ' · CPU preparation' : '',
                        session.excludedTimingFrames ? ` · ${session.excludedTimingFrames.toLocaleString()} invalid timing samples excluded` : ''))),
            React.createElement("details", { className: "vision-details" },
                React.createElement("summary", null, "Analysis settings & measured calibration"),
                React.createElement("div", { className: "stack" },
                    React.createElement("div", { className: "form-grid" },
                        React.createElement(Field, { label: "Inference device" },
                            React.createElement(Select, { disabled: locked, value: settings.executionProvider ?? 'cuda', onValueChange: selectionValue => { change('executionProvider', selectionValue); if (selectionValue === 'cpu')
                                    change('preprocessingBackend', 'cpu'); } },
                                React.createElement(SelectOption, { value: "cuda" }, "NVIDIA GPU \u00B7 CUDA"),
                                React.createElement(SelectOption, { value: "cpu" }, "CPU"))),
                        React.createElement(Field, { label: "Image preparation", hint: "CPU preserves the existing path. Experimental GPU preparation requires NVIDIA CUDA and keeps analysis observation-only." },
                            React.createElement(Select, { "aria-label": "Image preparation", disabled: locked || working, value: settings.preprocessingBackend ?? 'cpu', onValueChange: selectionValue => change('preprocessingBackend', selectionValue) },
                                React.createElement(SelectOption, { value: "cpu" }, "CPU \u00B7 compatible default"),
                                React.createElement(SelectOption, { value: "d3D11Cuda", disabled: (settings.executionProvider ?? 'cuda') !== 'cuda' }, "GPU \u00B7 experimental"))),
                        React.createElement(Field, { label: "Shoot button" },
                            React.createElement(Select, { disabled: locked, value: settings.shootButton ?? 'x', onValueChange: selectionValue => change('shootButton', selectionValue) }, ['x', 'a', 'b', 'y', 'leftBumper', 'rightBumper', 'leftStick', 'rightStick'].map(value => React.createElement(SelectOption, { key: value, value: value }, value.length === 1 ? value.toUpperCase() : value.replace(/([A-Z])/g, ' $1'))))),
                        [['minimumConfidence', 'Minimum confidence (%)', 0, 100, .9, 100], ['maximumUncertaintyMs', 'Maximum uncertainty (ms)', 0, 1000, 5, 1], ['maximumFrameAgeMs', 'Maximum local frame age (ms)', 1, 1000, 80, 1], ['estimatedVideoDelayMs', 'Estimated stream delay (ms)', 0, 1000, 0, 1], ['estimatedInputDelayMs', 'Estimated input delay (ms)', 0, 1000, 0, 1], ['correctionMs', 'Timing correction (ms)', -1000, 1000, 0, 1], ['maximumLatenessMs', 'Maximum lateness (ms)', 0, 100, 5, 1]].map(([key, label, min, max, fallback, scale]) => React.createElement(NumberField, { key: key, label: label, value: (settings[key] ?? fallback) * scale, min: min, max: max, disabled: locked, onChange: value => change(key, value / scale) }))),
                    React.createElement("div", { className: "button-group" },
                        React.createElement(Button, { variant: "primary", disabled: !dirty || locked || working, onClick: () => run('settingsSave', { settings }, () => setDirty(false)) }, "Save analysis settings"),
                        React.createElement(Button, { disabled: locked || working, onClick: () => run('settingsImport') }, "Import settings"),
                        React.createElement(Button, { disabled: locked || working, onClick: () => run('settingsExport') }, "Export settings")),
                    React.createElement("div", { className: "vision-divider" }),
                    React.createElement("h3", null, "Use measured calibration"),
                    React.createElement("p", { className: "subtle" }, "Calibration uses reviewed, measured millisecond errors. Early/late feedback alone cannot supply an exact correction."),
                    React.createElement("div", { className: "button-group" },
                        React.createElement(Button, { disabled: locked || working || !state?.selectedModelId, onClick: () => run('calibrationExport') }, "Export measurement template"),
                        React.createElement(Button, { disabled: locked || working || !state?.selectedModelId, onClick: () => run('calibrationImport') }, "Review measured calibration")))),
            React.createElement("details", { className: "vision-details" },
                React.createElement("summary", null, "Performance runs & diagnostics"),
                React.createElement("div", { className: "stack" },
                    React.createElement("div", { className: "vision-table" },
                        React.createElement("table", null,
                            React.createElement("thead", null,
                                React.createElement("tr", null,
                                    React.createElement("th", null, "Stage"),
                                    React.createElement("th", null, "Samples"),
                                    React.createElement("th", null, "p50"),
                                    React.createElement("th", null, "p95"),
                                    React.createElement("th", null, "p99"))),
                            React.createElement("tbody", null, [['Capture readback + copy', 'captureReadback'], ['Receipt to processing start', 'frameAge'], ['Receipt to decision', 'frameToDecision'], ['All-frame processing', 'processing'], ['RGB preparation + synchronization', 'preprocessing'], ['Inference + transfers', 'inferenceWithTransfers'], ['Preview/recording image readback', 'optionalImageReadback']].map(([label, key]) => { const metric = s.performance?.[key] ?? {}; return React.createElement("tr", { key: key },
                                React.createElement("th", null, label),
                                React.createElement("td", null, metric.samples ?? 0),
                                React.createElement("td", null,
                                    num(metric.p50Ms),
                                    " ms"),
                                React.createElement("td", null,
                                    num(metric.p95Ms),
                                    " ms"),
                                React.createElement("td", null,
                                    num(metric.p99Ms),
                                    " ms")); })))),
                    s.performance?.runtimeLocks && React.createElement("div", { className: "stack" },
                        React.createElement("p", { className: "subtle" }, "Controller lock waits: the latest 256 acquisitions per path during this run. These include thread scheduling. Window lengths differ by path."),
                        React.createElement("div", { className: "vision-table" },
                            React.createElement("table", null,
                                React.createElement("thead", null,
                                    React.createElement("tr", null,
                                        React.createElement("th", null, "Controller path"),
                                        React.createElement("th", null, "Samples"),
                                        React.createElement("th", null, "Window"),
                                        React.createElement("th", null, "p95 wait"),
                                        React.createElement("th", null, "p99 wait"))),
                                React.createElement("tbody", null, [['Input polling', 'inputPoll'], ['Vision reads', 'visionRead'], ['Observation submission', 'visionSubmission'], ['Release deadline', 'releaseDeadline']].map(([label, key]) => { const metric = s.performance.runtimeLocks[key] || {}; return React.createElement("tr", { key: key },
                                    React.createElement("th", null, label),
                                    React.createElement("td", null, metric.samples ?? 0),
                                    React.createElement("td", null,
                                        num(metric.windowSpanMs),
                                        " ms"),
                                    React.createElement("td", null,
                                        num(metric.p95Ms),
                                        " ms"),
                                    React.createElement("td", null,
                                        num(metric.p99Ms),
                                        " ms")); }))))),
                    React.createElement(Field, { label: "Performance run name" },
                        React.createElement(Input, { value: runName, maxLength: 80, onChange: e => setRunName(e.target.value) })),
                    React.createElement("div", { className: "button-group" },
                        React.createElement(Button, { disabled: working || !session.frames, onClick: () => run('performanceSave', { label: runName }) }, "Save run"),
                        React.createElement(Button, { disabled: working, onClick: () => run('performanceLoad') }, "Load comparison run"),
                        React.createElement(Button, { disabled: working || !session.frames, onClick: () => run('diagnosticsExport') }, "Export diagnostics")),
                    state?.baseline && React.createElement("div", { className: "vision-baseline" },
                        React.createElement("strong", null, state.baseline.label),
                        React.createElement("span", null, s.comparison?.message ?? 'Waiting for comparable model decisions.'),
                        s.comparison?.comparable && React.createElement("span", null,
                            "p95 change ",
                            num(s.comparison.frameToDecisionP95ChangeMs),
                            " ms \u00B7 p99 change ",
                            num(s.comparison.frameToDecisionP99ChangeMs),
                            " ms"),
                        React.createElement(Button, { variant: "ghost", onClick: () => run('performanceClear') }, "Clear comparison")),
                    React.createElement("p", { className: "subtle" },
                        "Image downloads for preview/recording in the current measurement window: ",
                        num((s.performance?.windowOptionalImageReadbackBytes ?? 0) / 1048576),
                        " MiB. Freshness metadata readback: ",
                        s.performance?.windowFreshnessReadbackBytes ?? 0,
                        " bytes."),
                    React.createElement("p", { className: "subtle" }, "Timing starts when this PC receives the captured frame, before image copies. Xbox render and applied-input times are not measured.")))),
        editor && React.createElement(ProfileEditor, { key: editor.id, profile: editor, isSaved: (state?.profiles ?? []).some((p) => p.id === editor.id), fingerprint: editor.id === profile?.id ? state?.selectedFingerprint : '', run: run, busy: working, error: error, close: () => setEditor(null) }),
        frozen?.automatic && React.createElement(AutomaticCaptureReview, { frozen: frozen, busy: working, error: error, close: () => run('layoutCancel', undefined, () => setFrozen(null)), save: layout => run('layoutSave', { token: frozen.token, layout, player: frozen.player }, () => setFrozen(null)) }),
        frozen && !frozen.automatic && React.createElement(LayoutEditor, { frozen: frozen, profile: profile, busy: working, error: error, close: () => setFrozen(null), save: (layout, player) => run('layoutSave', { token: frozen.token, layout, player }, () => setFrozen(null)) }),
        React.createElement(Modal, { open: !!state?.calibration, title: "Review measured correction", description: "These are measured errors from reviewed attempts, not a gameplay accuracy certificate.", onClose: () => run('calibrationCancel'), footer: React.createElement(React.Fragment, null,
                React.createElement(Button, { onClick: () => run('calibrationCancel') }, "Keep current timing"),
                React.createElement(Button, { variant: "primary", disabled: locked || working, onClick: () => run('calibrationApply', { token: state.calibration.token }) }, "Apply measured correction")) }, state?.calibration && React.createElement("div", { className: "vision-metrics" },
            React.createElement(Metric, { label: "Reviewed attempts", value: state.calibration.estimate.reviewedAttempts }),
            React.createElement(Metric, { label: "Proposed correction", value: num(state.calibration.estimate.recommendedCorrectionMs), unit: "ms" }),
            React.createElement(Metric, { label: "Median error", value: num(state.calibration.estimate.medianSignedErrorMs), unit: "ms" }),
            React.createElement(Metric, { label: "Residual p95", value: num(state.calibration.estimate.residualP95Ms), unit: "ms" }))),
        React.createElement(DiscardDialog, { open: nextAction !== null, onKeep: () => setNextAction(null), onDiscard: () => { const action = nextAction; setNextAction(null); setDirty(false); setSettings(state?.settings ?? {}); setDraftEpoch(value => value + 1); action?.(); } }));
}
function AnchorOverlay({ tracking, width, height }) {
    return React.createElement("svg", { className: "vision-anchor-overlay", viewBox: `0 0 ${width} ${height}`, "aria-label": "Tracked NBA capture anchors" },
        React.createElement("polygon", { points: (tracking.court ?? []).map((p) => `${p.x * width},${p.y * height}`).join(' '), fill: "none", stroke: "var(--accent)", strokeWidth: 2, vectorEffect: "non-scaling-stroke" }),
        [['Player', tracking.player, 'var(--roi-meter)'], ['Meter', tracking.meter, 'var(--roi-feedback)'], ['Feedback', tracking.feedback, 'var(--roi-identity)']].map(([label, box, color]) => box && React.createElement("rect", { key: label, x: box.left * width, y: box.top * height, width: box.width * width, height: box.height * height, fill: "none", stroke: tracking.valid ? color : 'var(--danger)', strokeWidth: 2, vectorEffect: "non-scaling-stroke" })),
        (tracking.keypoints ?? []).filter((point) => point.confidence >= .35).map((point, index) => React.createElement("circle", { key: index, cx: point.x * width, cy: point.y * height, r: 3, fill: "var(--roi-player)", vectorEffect: "non-scaling-stroke" })));
}
function NumberField({ label, value, min, max, onChange, disabled = false }) {
    return React.createElement(Field, { label: label },
        React.createElement(Input, { type: "number", "aria-label": label, value: Number.isFinite(value) ? value : '', min: min, max: max, step: 1, disabled: disabled, onChange: e => onChange(e.target.value === '' ? NaN : +e.target.value) }));
}
function Metric({ label, value, unit }) { return React.createElement("div", { className: "vision-metric" },
    React.createElement("span", null, label),
    React.createElement("strong", null,
        value,
        unit && React.createElement("small", null,
            " ",
            unit))); }
function ProfileEditor({ profile, isSaved, fingerprint, run, busy, error, close }) {
    const [p, setP] = useState(profile), [operation, setOperation] = useState('edit'), [copyName, setCopyName] = useState(profile.name + ' copy');
    const [feet, setFeet] = useState(String(Math.floor(profile.heightInches / 12))), [inches, setInches] = useState(String(profile.heightInches % 12));
    const [pending, setPending] = useState(null);
    const changed = JSON.stringify(p) !== JSON.stringify(profile) || feet !== String(Math.floor(profile.heightInches / 12)) || inches !== String(profile.heightInches % 12)
        || (operation === 'copy' && copyName !== profile.name + ' copy');
    useUnsavedChanges(changed);
    const leave = (action) => { if (busy)
        return; if (changed)
        setPending(() => action);
    else
        action(); };
    const reset = () => { setP(profile); setFeet(String(Math.floor(profile.heightInches / 12))); setInches(String(profile.heightInches % 12)); setCopyName(profile.name + ' copy'); };
    const edit = (key, value) => setP((old) => ({ ...old, [key]: value }));
    return React.createElement(React.Fragment, null,
        React.createElement(Modal, { open: true, title: operation === 'delete' ? 'Delete this shot profile?' : operation === 'copy' ? 'Duplicate shot profile' : isSaved ? 'Edit shot profile' : 'Create a shot profile', onClose: () => leave(close), wide: operation === 'edit', description: operation === 'delete' ? 'The saved setup will be removed. Recorded clips remain on disk.' : 'Match the player and custom jump shot you use in NBA 2K27.', footer: React.createElement(React.Fragment, null,
                React.createElement(Button, { disabled: busy, onClick: () => leave(close) }, operation === 'delete' ? 'Keep setup' : 'Cancel'),
                React.createElement(Button, { variant: operation === 'delete' ? 'danger' : 'primary', disabled: busy, onClick: () => {
                        if (operation === 'delete')
                            run('profileDelete', { id: p.id }, close);
                        else if (operation === 'copy')
                            run('profileDuplicate', { id: p.id, name: copyName }, close);
                        else
                            run('profileSave', { profile: { ...p, heightInches: feet === '' || inches === '' ? null : +feet * 12 + +inches }, expectedFingerprint: fingerprint }, close);
                    } }, operation === 'delete' ? 'Delete setup' : operation === 'copy' ? 'Create copy' : 'Save shot profile')) },
            React.createElement("div", { className: "stack" },
                error && React.createElement(Notice, { tone: "danger" }, error),
                operation === 'delete' ? React.createElement("p", null,
                    "Delete ",
                    React.createElement("strong", null, profile.name),
                    " from AccessRelay Studio?") : operation === 'copy' ? React.createElement(Field, { label: "Copy name" },
                    React.createElement(Input, { maxLength: 80, value: copyName, onChange: e => setCopyName(e.target.value) })) : React.createElement(React.Fragment, null,
                    React.createElement(Field, { label: "Gamertag", hint: "Match the displayed text and capitalization." },
                        React.createElement(Input, { value: p.gamertag ?? '', maxLength: 32, onChange: e => edit('gamertag', e.target.value) })),
                    React.createElement(Field, { label: "Setup name" },
                        React.createElement(Input, { "aria-label": "Shot profile name", value: p.name, maxLength: 80, autoFocus: true, placeholder: "For example, Stretch Big", onChange: e => edit('name', e.target.value) })),
                    React.createElement("div", { className: "form-grid" },
                        React.createElement("div", { className: "vision-height-fields" },
                            React.createElement(Field, { label: "Height \u00B7 feet" },
                                React.createElement(Input, { type: "number", "aria-label": "Height feet", min: 3, max: 9, step: 1, value: feet, onChange: e => setFeet(e.target.value) })),
                            React.createElement(Field, { label: "Inches" },
                                React.createElement(Input, { type: "number", "aria-label": "Height inches", min: 0, max: 11, step: 1, value: inches, onChange: e => setInches(e.target.value) }))),
                        React.createElement(NumberField, { label: "Three-point rating", min: 0, max: 100, value: p.threePointRating, onChange: v => edit('threePointRating', v) }),
                        React.createElement(Field, { label: "Camera" },
                            React.createElement(Select, { value: p.cameraView, onValueChange: selectionValue => edit('cameraView', selectionValue) }, ['2K', '2K Low', '2K Legacy'].map(camera => React.createElement(SelectOption, { key: camera }, camera)))),
                        React.createElement(Field, { label: "Shot speed" },
                            React.createElement(Select, { value: p.shotSpeed, onValueChange: selectionValue => edit('shotSpeed', +selectionValue) }, [1, 2, 3, 4].map(speed => React.createElement(SelectOption, { key: speed, value: speed },
                                speed,
                                " / 4",
                                speed === 1 ? ' · slowest' : speed === 4 ? ' · fastest' : ''))))),
                    React.createElement("div", { className: "vision-divider" }),
                    React.createElement("h3", null, "Custom jump shot"),
                    React.createElement("div", { className: "form-grid" },
                        [['base', 'Base'], ['upperRelease1', 'Upper release 1'], ['upperRelease2', 'Upper release 2']].map(([key, label]) => React.createElement(Field, { label: label, key: key },
                            React.createElement(Input, { value: p[key], maxLength: 120, onChange: e => edit(key, e.target.value) }))),
                        React.createElement(Field, { label: "Release blend" },
                            React.createElement("div", { className: "vision-blend" },
                                React.createElement("span", null,
                                    p.release1Percent,
                                    "% release 1"),
                                React.createElement("span", null,
                                    100 - p.release1Percent,
                                    "% release 2")),
                            React.createElement(Slider, { type: "range", "aria-label": "Upper release 1 allocation", min: 0, max: 100, value: p.release1Percent, onChange: e => edit('release1Percent', +e.target.value) }))),
                    React.createElement(Toggle, { label: "Shot meter is enabled in the game", description: "Initial supervised training uses meter-on footage. Meter-off evaluation has a separate capture purpose.", checked: p.usesShotMeter, onChange: value => { edit('usesShotMeter', value); if (!value)
                            edit('meterReleaseType', ''); } }),
                    p.usesShotMeter && React.createElement(Field, { label: "Meter release type / cue" },
                        React.createElement(Input, { value: p.meterReleaseType, maxLength: 120, placeholder: "Match the release setting in your game", onChange: e => edit('meterReleaseType', e.target.value) })),
                    isSaved && React.createElement("div", { className: "vision-profile-tools" },
                        React.createElement(Button, { variant: "ghost", disabled: busy, onClick: () => leave(() => setOperation('copy')) },
                            React.createElement(Icon, { name: "copy", size: 16 }),
                            "Duplicate saved profile"),
                        React.createElement(Button, { variant: "danger", disabled: busy, onClick: () => leave(() => setOperation('delete')) },
                            React.createElement(Icon, { name: "trash", size: 16 }),
                            "Delete saved profile"))))),
        React.createElement(DiscardDialog, { open: pending !== null, onKeep: () => setPending(null), onDiscard: () => { const action = pending; setPending(null); reset(); action?.(); } }));
}
function AutomaticCaptureReview({ frozen, busy, error, save, close }) {
    const [layout, setLayout] = useState(frozen.layout), [reviewed, setReviewed] = useState(false);
    return React.createElement(Modal, { open: true, wide: true, title: "Review detected capture areas", onClose: close, footer: React.createElement(React.Fragment, null,
            React.createElement(Button, { disabled: busy, onClick: close }, "Cancel"),
            React.createElement(Button, { variant: "primary", disabled: busy || !reviewed || !layout.gameBuild?.trim(), onClick: () => save(layout) }, "Use detected areas")) },
        React.createElement("div", { className: "stack" },
            error && React.createElement(Notice, { tone: "danger" }, error),
            React.createElement("p", null,
                "Player: ",
                React.createElement("strong", null, frozen.tracking?.identity?.expectedTag),
                ". Check the joints and body outline, meter, estimated court area and shot feedback."),
            React.createElement("div", { className: "vision-mark-frame" },
                React.createElement("img", { src: frozen.url, alt: "Automatically detected NBA capture areas" }),
                React.createElement(AnchorOverlay, { tracking: frozen.tracking, width: frozen.sourceWidth, height: frozen.sourceHeight })),
            React.createElement("div", { className: "form-grid" },
                React.createElement(Field, { label: "Game build / patch" },
                    React.createElement(Input, { required: true, value: layout.gameBuild, maxLength: 120, onChange: event => setLayout({ ...layout, gameBuild: event.target.value }) })),
                React.createElement(Field, { label: "Shots in this clip" },
                    React.createElement(Select, { value: layout.shotCategory, onValueChange: value => setLayout({ ...layout, shotCategory: value }) }, categories.map(category => React.createElement(SelectOption, { key: category }, category))))),
            React.createElement("label", { className: "vision-check" },
                React.createElement(Checkbox, { checked: reviewed, onChange: event => setReviewed(event.target.checked) }),
                "The detected player and capture areas are correct.")));
}
function LayoutEditor({ frozen, profile, busy, error, save, close }) {
    const original = frozen.layout ?? {}, confirmed = !!original.configured && original.sourceWidth === frozen.sourceWidth && original.sourceHeight === frozen.sourceHeight;
    const prior = original.pluginConfiguration ?? {};
    const [boxes, setBoxes] = useState([original.gameplayRegion ?? full, prior.player ?? frozen.player ?? null, prior.meter ?? original.meterRegion ?? null, original.feedbackRegion ?? null]);
    const [court, setCourt] = useState(prior.court ?? []);
    const [marked, setMarked] = useState([confirmed, confirmed && !!prior.player, confirmed && !!prior.meter, confirmed && !!original.feedbackRegion, confirmed && prior.court?.length === 4]);
    const [active, setActive] = useState(0), [localError, setLocalError] = useState('');
    const [layout, setLayout] = useState({ ...original, evidenceMode: 'anchored', hudName: original.hudName ?? 'My gameplay HUD', gameBuild: original.gameBuild ?? '', purpose: !confirmed && !profile?.usesShotMeter ? 'meterOffValidation' : original.purpose ?? 'meterSupervisedTraining', shotCategory: original.shotCategory ?? categories[0] });
    const originalDraft = useRef(JSON.stringify({ boxes, court, marked, layout }));
    const changed = JSON.stringify({ boxes, court, marked, layout }) !== originalDraft.current;
    const [closeRequested, setCloseRequested] = useState(false);
    useUnsavedChanges(changed);
    const requestClose = () => { if (!busy) {
        if (changed)
            setCloseRequested(true);
        else
            close();
    } };
    const drag = useRef(null);
    const needed = layout.purpose === 'meterOffValidation' ? [0, 1, 4, 3] : [0, 1, 2, 4, 3];
    const mismatch = layout.purpose === 'meterSupervisedTraining' ? !profile?.usesShotMeter : !!profile?.usesShotMeter;
    const point = (event) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
    const update = (index, box, done) => { setBoxes(old => old.map((value, i) => i === index ? box : value)); setMarked(old => old.map((value, i) => i === index ? done : value)); };
    function move(event, finish) {
        if (!drag.current || drag.current.pointer !== event.pointerId)
            return;
        const end = point(event), start = drag.current;
        const box = { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) };
        if (box.width >= 1 / frozen.sourceWidth && box.height >= 1 / frozen.sourceHeight)
            update(start.index, box, finish);
        else if (finish) {
            update(start.index, start.before, start.marked);
            setLocalError('That selection was too small. The previous area was kept.');
        }
        if (finish) {
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }
    function cancel(event) { if (drag.current) {
        const old = drag.current;
        drag.current = null;
        update(old.index, old.before, old.marked);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
    } }
    return React.createElement(React.Fragment, null,
        React.createElement(Modal, { open: true, wide: true, title: "Choose what your clip keeps", description: "Choose an area, then draw its box on this paused frame.", onClose: requestClose, footer: React.createElement(React.Fragment, null,
                React.createElement("span", { className: "vision-layout-count" },
                    needed.filter(index => marked[index]).length,
                    " of ",
                    needed.length,
                    " areas marked"),
                React.createElement(Button, { disabled: busy, onClick: requestClose }, "Cancel"),
                React.createElement(Button, { variant: "primary", disabled: busy || mismatch || !layout.gameBuild.trim() || !needed.every(index => marked[index]), onClick: () => save({ ...layout, configured: true, sourceWidth: frozen.sourceWidth, sourceHeight: frozen.sourceHeight, gameplayRegion: boxes[0], meterRegion: layout.purpose === 'meterSupervisedTraining' ? boxes[2] : null, feedbackRegion: boxes[3], pluginConfiguration: { version: 1, camera: profile.cameraView, playerAnchor: 'torso-appearance-v1', meterAnchor: 'player-relative-region-v1', courtAnchor: 'floor-homography-v1', player: boxes[1], meter: layout.purpose === 'meterSupervisedTraining' ? boxes[2] : null, court } }, boxes[1]) }, "Save capture areas")) },
            React.createElement("div", { className: "stack" },
                (localError || error) && React.createElement(Notice, { tone: "danger" }, localError || error),
                React.createElement("div", { className: "form-grid" },
                    React.createElement(Field, { label: "HUD layout name" },
                        React.createElement(Input, { value: layout.hudName, maxLength: 80, onChange: e => setLayout({ ...layout, hudName: e.target.value }) })),
                    React.createElement(Field, { label: "Clip purpose" },
                        React.createElement(Select, { value: layout.purpose, onValueChange: selectionValue => { setLayout({ ...layout, purpose: selectionValue }); if (active === 2 && selectionValue === 'meterOffValidation')
                                setActive(3); } },
                            React.createElement(SelectOption, { value: "meterSupervisedTraining" }, "Training \u00B7 meter on"),
                            React.createElement(SelectOption, { value: "meterOffValidation" }, "Validation \u00B7 meter off")))),
                mismatch && React.createElement(Notice, { tone: "warning" },
                    "This shot profile has the meter ",
                    profile?.usesShotMeter ? 'on' : 'off',
                    ". Match this purpose to the actual game setting, or edit the shot profile first."),
                React.createElement("div", { className: "vision-region-steps" }, needed.map(index => React.createElement(Button, { variant: "unstyled", type: "button", key: index, "aria-label": `Mark ${areas[index][0]} area`, "aria-pressed": active === index, className: active === index ? 'active' : '', onClick: () => { setActive(index); setLocalError(''); } },
                    React.createElement("span", { style: { background: areas[index][1] } }, React.createElement(Icon, { name: marked[index] ? 'check' : 'circle', size: 16 })),
                    areas[index][0]))),
                React.createElement("p", { className: "vision-area-help" },
                    React.createElement("strong", null,
                        areas[active][0],
                        "."),
                    " ",
                    areas[active][2]),
                active === 4 && React.createElement(Button, { onClick: () => { setCourt([]); setMarked(old => old.map((value, index) => index === 4 ? false : value)); } }, "Clear court corners"),
                React.createElement("div", { className: "vision-mark-frame", onPointerDown: event => { if (event.button !== 0 || drag.current)
                        return; if (active === 4) {
                        const next = court.length === 4 ? [point(event)] : [...court, point(event)];
                        setCourt(next);
                        setMarked(old => old.map((value, index) => index === 4 ? next.length === 4 : value));
                        return;
                    } drag.current = { ...point(event), before: boxes[active], marked: marked[active], pointer: event.pointerId, index: active }; event.currentTarget.setPointerCapture(event.pointerId); setLocalError(''); }, onPointerMove: event => move(event, false), onPointerUp: event => move(event, true), onPointerCancel: cancel, onLostPointerCapture: event => { if (drag.current?.pointer === event.pointerId)
                        cancel(event); } },
                    React.createElement("img", { src: frozen.url, alt: "Paused gameplay for marking capture areas", draggable: false }),
                    React.createElement("svg", { className: "vision-anchor-overlay", viewBox: `0 0 ${frozen.sourceWidth} ${frozen.sourceHeight}`, "aria-label": "Court anchor outline" },
                        React.createElement("polygon", { points: court.map(p => `${p.x * frozen.sourceWidth},${p.y * frozen.sourceHeight}`).join(' '), fill: "none", stroke: "var(--accent)", strokeWidth: 3, vectorEffect: "non-scaling-stroke" }),
                        court.map((p, i) => React.createElement("circle", { key: i, cx: p.x * frozen.sourceWidth, cy: p.y * frozen.sourceHeight, r: 6, fill: "var(--accent)" }))),
                    boxes.map((box, index) => box && needed.includes(index) && React.createElement("div", { key: index, className: 'vision-region-box' + (index === active ? ' active' : ''), style: { left: box.left * 100 + '%', top: box.top * 100 + '%', width: box.width * 100 + '%', height: box.height * 100 + '%', borderColor: areas[index][1] } },
                        React.createElement("span", { style: { background: areas[index][1] } }, areas[index][0])))),
                React.createElement("div", { className: "form-grid" },
                    React.createElement(Field, { label: "Shots in this clip" },
                        React.createElement(Select, { value: layout.shotCategory, onValueChange: selectionValue => setLayout({ ...layout, shotCategory: selectionValue }) }, categories.map(category => React.createElement(SelectOption, { key: category }, category)))),
                    React.createElement(Field, { label: "Game build / patch" },
                        React.createElement(Input, { required: true, value: layout.gameBuild, maxLength: 120, onChange: e => setLayout({ ...layout, gameBuild: e.target.value }) }))),
                active !== 4 && React.createElement("details", { className: "vision-details" },
                    React.createElement("summary", null, "Keyboard / precise coordinates"),
                    React.createElement("div", { className: "stack" },
                        React.createElement("div", { className: "vision-coordinates" }, ['left', 'top', 'width', 'height'].map(key => React.createElement(Field, { key: key, label: key[0].toUpperCase() + key.slice(1) + ' (%)' },
                            React.createElement(Input, { type: "number", "aria-label": `${areas[active][0]} ${key} percent`, min: 0, max: 100, step: .1, value: num((boxes[active] ?? full)[key] * 100, 2), onChange: e => update(active, { ...(boxes[active] ?? full), [key]: +e.target.value / 100 }, false) })))),
                        React.createElement(Button, { onClick: () => { const box = boxes[active] ?? full; if (![box.left, box.top, box.width, box.height].every(Number.isFinite) || box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0 || box.left + box.width > 1.000000001 || box.top + box.height > 1.000000001)
                                setLocalError('Keep a nonempty area inside the picture.');
                            else {
                                update(active, box, true);
                                setLocalError('');
                            } } }, "Use these coordinates"))),
                active === 4 && React.createElement("details", { className: "vision-details" },
                    React.createElement("summary", null, "Keyboard / court coordinates"),
                    React.createElement("div", { className: "stack" },
                        [0, 1, 2, 3].map(index => React.createElement("div", { className: "form-grid", key: index }, ['x', 'y'].map(axis => React.createElement(Field, { key: axis, label: `Corner ${index + 1} ${axis.toUpperCase()} (%)` },
                            React.createElement(Input, { type: "number", min: 0, max: 100, step: .1, value: (court[index]?.[axis] ?? 0) * 100, onChange: event => { setCourt(old => { const next = Array.from({ length: 4 }, (_, i) => old[i] ?? { x: 0, y: 0 }); next[index] = { ...next[index], [axis]: +event.target.value / 100 }; return next; }); setMarked(old => old.map((value, i) => i === 4 ? false : value)); } }))))),
                        React.createElement(Button, { onClick: () => setMarked(old => old.map((value, i) => i === 4 ? court.length === 4 : value)) }, "Use court corners"))),
                React.createElement("p", { className: "subtle" },
                    frozen.sourceWidth,
                    " \u00D7 ",
                    frozen.sourceHeight,
                    " source. Areas scale with this picture. Mark the feedback panel where it appears after a shot; use a fresh preview if it is hidden."))),
        React.createElement(DiscardDialog, { open: closeRequested, onKeep: () => setCloseRequested(false), onDiscard: close }));
}
function ClipReview({ review, busy, save }) {
    const [frame, setFrame] = useState(0), [renderFrame, setRenderFrame] = useState(0), [region, setRegion] = useState(review.tracking === 'unannotated-scene' ? 'scene' : 'player'), [loaded, setLoaded] = useState('');
    const [split, setSplit] = useState(review.labels?.split ?? 'train'), [shots, setShots] = useState(review.labels?.shots ?? []);
    const [editing, setEditing] = useState(null), [name, setName] = useState('shot-001'), [start, setStart] = useState(0), [end, setEnd] = useState(review.frameCount - 1), [target, setTarget] = useState(null);
    const [isTarget, setIsTarget] = useState(true), [identity, setIdentity] = useState(false), [reviewed, setReviewed] = useState(false), [cropReviewed, setCropReviewed] = useState(false), [message, setMessage] = useState('');
    const form = { editing, name, start, end, target, isTarget, identity, reviewed, cropReviewed };
    const [cleanForm, setCleanForm] = useState(JSON.stringify(form)), [savedSplit, setSavedSplit] = useState(split);
    const [pending, setPending] = useState(null);
    const changed = JSON.stringify(form) !== cleanForm || split !== savedSplit;
    useUnsavedChanges(changed);
    const transition = (action) => { if (changed)
        setPending(() => action);
    else
        action(); };
    function applyForm(next) {
        setEditing(next.editing);
        setName(next.name);
        setStart(next.start);
        setEnd(next.end);
        setTarget(next.target);
        setIsTarget(next.isTarget);
        setIdentity(next.identity);
        setReviewed(next.reviewed);
        setCropReviewed(next.cropReviewed);
        setCleanForm(JSON.stringify(next));
    }
    const frames = review.frames ?? [], imageKey = `${review.token}:${region}:${renderFrame}`, canMark = loaded === imageKey && frame === renderFrame;
    const scrub = useRef({ latest: frame, requested: renderFrame, ready: false, failed: '', timer: null });
    scrub.current.latest = frame;
    scrub.current.requested = renderFrame;
    function queueFrame() {
        const current = scrub.current;
        if (!current.ready || current.timer !== null || current.latest === current.requested)
            return;
        current.timer = setTimeout(() => {
            current.timer = null;
            if (!current.ready || current.latest === current.requested)
                return;
            current.ready = false;
            setRenderFrame(current.latest);
        }, 33);
    }
    useEffect(() => { queueFrame(); }, [frame]);
    useEffect(() => { scrub.current.ready = loaded === imageKey || scrub.current.failed === imageKey; queueFrame(); }, [loaded, imageKey]);
    useEffect(() => {
        if (scrub.current.timer !== null)
            clearTimeout(scrub.current.timer);
        scrub.current.timer = null;
        scrub.current.ready = false;
        return () => { if (scrub.current.timer !== null)
            clearTimeout(scrub.current.timer); };
    }, [review.token, region]);
    const time = (index) => index === null ? 'Not marked' : `${num(frames[index]?.timeMs)} ms`;
    async function persist(next, success) {
        const result = await save({ schemaVersion: 1, sessionId: review.sessionId, split, labelTimeBasis: 'captured-target-game-phase', shots: next });
        if (result !== undefined) {
            setShots(next);
            setSavedSplit(split);
            setMessage(success);
            return true;
        }
        return false;
    }
    function newInterval() {
        let next = shots.length + 1;
        while (shots.some(shot => shot.shotId === `shot-${String(next).padStart(3, '0')}`))
            next++;
        applyForm({ editing: null, name: `shot-${String(next).padStart(3, '0')}`, start: renderFrame, end: review.frameCount - 1, target: null, isTarget: true, identity: false, reviewed: false, cropReviewed: false });
        setMessage('');
    }
    function editInterval(shot) {
        const find = (ticks) => Math.max(0, frames.findIndex(item => item.ticks >= ticks));
        applyForm({ editing: shot.shotId, name: shot.shotId, start: find(shot.startTicks), end: find(shot.endTicks), target: shot.targetReleaseTicks == null ? null : find(shot.targetReleaseTicks), isTarget: shot.isTargetShot, identity: shot.playerIdentityConfirmed, reviewed: shot.reviewed, cropReviewed: !!shot.playerRegionReviewed });
        setFrame(find(shot.startTicks));
        setMessage('');
    }
    return React.createElement(React.Fragment, null,
        React.createElement("div", { className: "vision-review-grid" },
            React.createElement(Card, { title: "Look before you label", description: `${review.frameCount.toLocaleString()} frames · ${review.enriched ? 'Synchronized evidence clip' : 'Player capture'}` },
                React.createElement("div", { className: "stack" },
                    React.createElement("div", { className: "vision-review-regions" }, (review.regions ?? []).map((item) => React.createElement(Button, { key: item.name, variant: item.name === region ? 'primary' : 'ghost', onClick: () => setRegion(item.name) }, item.label))),
                    React.createElement("div", { className: "vision-review-frame" },
                        React.createElement("img", { src: `https://media.accessrelay.test/vision/review/${review.token}/${region}/${renderFrame}`, alt: `${region} capture, frame ${renderFrame + 1}`, onLoad: event => {
                                const expected = `https://media.accessrelay.test/vision/review/${review.token}/${region}/${renderFrame}`;
                                if (!event.currentTarget.currentSrc || event.currentTarget.currentSrc === expected) {
                                    scrub.current.failed = '';
                                    setLoaded(imageKey);
                                }
                            }, onError: () => { setLoaded(''); scrub.current.failed = imageKey; scrub.current.ready = true; queueFrame(); setMessage('This image could not be read. Reopen the clip to check its files.'); } })),
                    React.createElement("div", { className: "vision-review-position" },
                        React.createElement("span", null,
                            "Frame ",
                            renderFrame + 1,
                            " of ",
                            review.frameCount),
                        React.createElement("strong", null,
                            num(frames[renderFrame]?.timeMs),
                            " ms")),
                    React.createElement(Slider, { type: "range", "aria-label": "Recorded clip frame", min: 0, max: review.frameCount - 1, step: 1, value: frame, onChange: e => setFrame(+e.target.value) }),
                    React.createElement("div", { className: "vision-frame-controls" },
                        React.createElement(Button, { "aria-label": "Previous frame", disabled: frame <= 0, onClick: () => setFrame(Math.max(0, frame - 1)) },
                            React.createElement(Icon, { name: "chevronLeft", size: 18 })),
                        React.createElement("span", { className: "subtle" }, "All regions share this timeline."),
                        React.createElement(Button, { "aria-label": "Next frame", disabled: frame >= review.frameCount - 1, onClick: () => setFrame(Math.min(review.frameCount - 1, frame + 1)) },
                            React.createElement(Icon, { name: "chevronRight", size: 18 }))),
                    review.enriched && React.createElement("p", { className: "subtle" }, "Review the tracked player crop, meter, court and feedback before preparing training data. Target phases still require reviewed evidence."))),
            React.createElement("div", { className: "stack" },
                React.createElement(Card, { title: editing ? 'Edit reviewed shot' : 'Mark a shot', description: "Use a controlled attempt and its feedback to justify the target phase." },
                    React.createElement("div", { className: "stack" },
                        React.createElement(Field, { label: "Shot name" },
                            React.createElement(Input, { maxLength: 80, value: name, onChange: e => { setName(e.target.value); setReviewed(false); } })),
                        React.createElement("div", { className: "vision-marker" },
                            React.createElement("span", null,
                                React.createElement("strong", null, "Start"),
                                time(start)),
                            React.createElement(Button, { "aria-label": "Mark start at current frame", disabled: !canMark, onClick: () => { setStart(renderFrame); setReviewed(false); } }, "Mark here")),
                        React.createElement("div", { className: "vision-marker" },
                            React.createElement("span", null,
                                React.createElement("strong", null, "End"),
                                time(end)),
                            React.createElement(Button, { "aria-label": "Mark end at current frame", disabled: !canMark, onClick: () => { setEnd(renderFrame); setReviewed(false); } }, "Mark here")),
                        React.createElement(Toggle, { label: "Intended-player shooting attempt", checked: isTarget, onChange: value => { setIsTarget(value); if (!value)
                                setTarget(null); setReviewed(false); } }),
                        isTarget && React.createElement(React.Fragment, null,
                            React.createElement("div", { className: "vision-marker" },
                                React.createElement("span", null,
                                    React.createElement("strong", null, "Target game phase"),
                                    time(target)),
                                React.createElement(Button, { "aria-label": "Mark target game phase at current frame", disabled: !canMark, onClick: () => { setTarget(renderFrame); setReviewed(false); } }, "Mark here")),
                            React.createElement("label", { className: "vision-check" },
                                React.createElement(Checkbox, { type: "checkbox", checked: identity, onChange: e => { setIdentity(e.target.checked); setReviewed(false); } }),
                                "I confirmed my player throughout this interval.")),
                        React.createElement("p", { className: "subtle" }, "Mark the visible target phase justified by the attempt. Button-up time, ball departure and later early/late feedback do not establish an exact target by themselves."),
                        React.createElement("label", { className: "vision-check" },
                            React.createElement(Checkbox, { type: "checkbox", checked: reviewed, onChange: e => setReviewed(e.target.checked) }),
                            "I reviewed this interval and its target evidence."),
                        ['visual-anchors-v1', 'identity-pose-v1'].includes(review.tracking) && React.createElement("label", { className: "vision-check" },
                            React.createElement(Checkbox, { type: "checkbox", checked: cropReviewed, onChange: event => { setCropReviewed(event.target.checked); setReviewed(false); } }),
                            "Throughout this interval, the tracked crop contains my complete player and excludes the meter and feedback overlays."),
                        React.createElement("div", { className: "button-group" },
                            React.createElement(Button, { variant: "primary", disabled: busy || !reviewed || (['visual-anchors-v1', 'identity-pose-v1'].includes(review.tracking) && !cropReviewed) || (isTarget && (!identity || target === null)), onClick: async () => {
                                    const shot = { shotId: name.trim(), startTicks: frames[start]?.ticks, endTicks: frames[end]?.ticks, targetReleaseTicks: isTarget && target !== null ? frames[target]?.ticks : null, isTargetShot: isTarget, playerIdentityConfirmed: identity, reviewed, playerRegionReviewed: cropReviewed };
                                    if (shots.some(item => item.shotId === shot.shotId && item.shotId !== editing)) {
                                        setMessage('Choose a unique shot name.');
                                        return;
                                    }
                                    if (await persist([...shots.filter(item => item.shotId !== editing), shot], 'Reviewed label saved with the clip.')) {
                                        setEditing(shot.shotId);
                                        setCleanForm(JSON.stringify({ ...form, editing: shot.shotId }));
                                    }
                                } }, "Save reviewed shot"),
                            React.createElement(Button, { disabled: busy, onClick: () => transition(newInterval) }, "New interval")),
                        message && React.createElement("p", { role: "status", className: "subtle" }, message))),
                React.createElement(Card, { title: "Keep this clip in one split", description: "Keep related shots together. Reserve held-out clips for final evaluation." },
                    React.createElement("div", { className: "stack" },
                        React.createElement(Field, { label: "Dataset split" },
                            React.createElement(Select, { value: split, onValueChange: selectionValue => setSplit(selectionValue) },
                                React.createElement(SelectOption, { value: "train" }, "Training"),
                                React.createElement(SelectOption, { value: "validation" }, "Validation"),
                                React.createElement(SelectOption, { value: "held-out" }, "Held-out evaluation"),
                                React.createElement(SelectOption, { value: "reference" }, "Configuration reference"))),
                        React.createElement(Button, { disabled: busy, onClick: () => persist(shots, 'Clip split saved.') }, "Save split"),
                        !!shots.length && React.createElement("div", { className: "vision-shot-list" }, shots.map(shot => React.createElement("div", { key: shot.shotId },
                            React.createElement(Button, { variant: "unstyled", type: "button", onClick: () => transition(() => editInterval(shot)) },
                                React.createElement("strong", null, shot.shotId),
                                React.createElement("span", null, shot.isTargetShot ? 'Target shot' : 'Negative interval')),
                            React.createElement(Button, { variant: "ghost", disabled: busy, "aria-label": `Delete label ${shot.shotId}`, onClick: () => { const remove = async () => { if (await persist(shots.filter(item => item.shotId !== shot.shotId), 'Label removed. Recorded frames are unchanged.') && editing === shot.shotId)
                                    newInterval(); }; if (editing === shot.shotId)
                                    transition(remove);
                                else
                                    remove(); } },
                                React.createElement(Icon, { name: "trash", size: 17 }))))))))),
        React.createElement(DiscardDialog, { open: pending !== null, onKeep: () => setPending(null), onDiscard: () => { const action = pending; setPending(null); applyForm(JSON.parse(cleanForm)); setSplit(savedSplit); action?.(); } }));
}
const styles = `
.vision-preview-head{flex-wrap:wrap}.vision-preview-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:100%}.vision-recording-state{display:flex;align-items:center;gap:9px;padding:11px 22px;background:var(--surface);border-top:1px solid var(--line);font-size:14px;line-height:1.5;color:var(--ink)}.vision-recording-state>svg{flex-shrink:0}
.vision-context-heading{display:flex;align-items:center;gap:12px;margin-bottom:20px}.vision-context-heading h2{margin:0 0 4px}.vision-context-heading p{margin:0}.vision-step{display:inline-flex;align-items:center;justify-content:center;background:var(--icon-bg);color:var(--accent);border:1px solid var(--line);border-radius:50%;width:30px;height:30px;flex-shrink:0;font-weight:700;font-size:14px}.vision-context-grid{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:16px;align-items:start}.vision-context-actions{display:flex;align-items:center;gap:4px;padding-top:27px}.vision-summary{display:flex;flex-wrap:wrap;gap:8px 18px;border-top:1px solid var(--line);padding-top:14px;margin-top:17px;align-items:center;color:var(--muted);font-size:14px}.vision-capture-grid{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(270px,.85fr);gap:22px;align-items:start}.vision-preview{border:1px solid var(--line);border-radius:18px;background:var(--surface);overflow:hidden;min-width:0}.vision-preview-head{display:flex;justify-content:space-between;gap:16px;padding:22px;align-items:center}.vision-preview-head h2{margin:5px 0 0;font-size:20px}.vision-preview-head .eyebrow{margin:0}.vision-anchor-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.vision-stage{position:relative;aspect-ratio:16/10;display:flex;align-items:center;justify-content:center;background:var(--surface-inset);overflow:hidden;border-top:1px solid var(--line-strong);border-bottom:1px solid var(--line-strong)}.vision-stage>img{display:block;width:100%;height:100%;object-fit:contain}.vision-stage-empty{max-width:370px;text-align:center;padding:32px;color:var(--ink)}.vision-stage-empty h3{font-size:22px;margin:18px 0 10px}.vision-stage-empty p{color:var(--muted);line-height:1.6;margin-bottom:20px}.vision-stage-empty>span{display:inline-flex;align-items:center;justify-content:center;background:var(--icon-bg);border:1px solid var(--line);border-radius:25px;width:84px;height:76px;color:var(--accent);box-shadow:0 8px 24px #153c4c09}.vision-stage-badge{position:absolute;top:14px;left:14px}.vision-preview-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 22px;color:var(--muted);font-size:14px}.vision-aside{display:flex;flex-direction:column;gap:20px}.vision-aside .card{padding:22px}.vision-areas{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin:18px 0}.vision-areas>div{display:flex;align-items:center;gap:7px;font-size:14px}.vision-areas i{width:8px;height:8px;border-radius:2px}.vision-areas svg{margin-left:auto;color:var(--muted)}.vision-status-line{display:flex;align-items:flex-start;gap:10px;color:var(--muted);font-size:14px;line-height:1.5;margin:0}.vision-status-line svg{flex-shrink:0;margin-top:2px}.vision-details{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 22px}.vision-details>summary{cursor:pointer;font-weight:600;color:var(--ink);padding:2px 0}.vision-details[open]>summary{margin-bottom:20px}.vision-details p{line-height:1.6;margin:0}.vision-details h3{margin:0;font-size:17px}.vision-details .stack{gap:16px}.vision-assistance-grid{display:grid;grid-template-columns:1.25fr 1fr;gap:22px}.vision-metrics{display:grid;grid-template-columns:1fr 1fr;gap:22px}.vision-metric{display:flex;flex-direction:column;gap:7px}.vision-metric>span{font-size:14px;color:var(--muted)}.vision-metric>strong{font-size:27px;font-variant-numeric:tabular-nums;font-weight:650;letter-spacing:-.6px}.vision-metric small{font-size:14px;color:var(--muted);font-weight:450;letter-spacing:0}.vision-table{overflow-x:auto}.vision-table table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}.vision-table th,.vision-table td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}.vision-table th:first-child{text-align:left;padding-left:0;font-weight:500}.vision-table thead th{color:var(--muted);font-weight:500}.vision-baseline{background:var(--surface);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;font-size:14px}.vision-divider{height:1px;background:var(--line);margin:4px 0}.vision-height-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.vision-blend{display:flex;justify-content:space-between;gap:12px;font-size:14px;margin-bottom:12px}.vision-profile-tools{border-top:1px solid var(--line);padding-top:16px;display:flex;justify-content:space-between;gap:12px}.vision-region-steps{display:flex;gap:8px;flex-wrap:wrap}.vision-region-steps>button{display:flex;align-items:center;gap:9px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px;cursor:pointer}.vision-region-steps>button.active{background:var(--selected);border-color:var(--selected-border);box-shadow:0 0 0 2px #a3d2b52b}.vision-region-steps>button>span{width:23px;height:23px;display:flex;align-items:center;justify-content:center;color:var(--on-accent);border-radius:6px;font-size:14px}.vision-area-help{margin:0;font-size:14px;color:var(--muted);line-height:1.6}.vision-area-help strong{color:var(--ink)}.vision-mark-frame{position:relative;width:100%;line-height:0;touch-action:none;user-select:none;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface-inset);cursor:crosshair}.vision-mark-frame>img{display:block;width:100%;height:auto;pointer-events:none}.vision-region-box{position:absolute;border:1px dashed;box-sizing:border-box;pointer-events:none}.vision-region-box.active{border-width:3px;border-style:solid;background:#ffffff08}.vision-region-box>span{position:absolute;top:0;left:0;padding:5px 8px;color:var(--on-accent);font-size:14px;line-height:1;white-space:nowrap;border-radius:0 0 5px 0;max-width:100%;overflow:hidden}.vision-coordinates{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.vision-layout-count{margin-right:auto;color:var(--muted);font-size:14px}.vision-review-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(310px,.9fr);gap:22px;align-items:start}.vision-review-regions{display:flex;gap:5px;flex-wrap:wrap}.vision-review-frame{aspect-ratio:16/11;background:var(--surface-inset);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;justify-content:center;align-items:center}.vision-review-frame img{max-width:100%;max-height:100%;object-fit:contain}.vision-review-position{display:flex;justify-content:space-between;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}.vision-review-position strong{color:var(--ink);font-weight:550}.vision-frame-controls{display:flex;align-items:center;justify-content:space-between;gap:12px}.vision-marker{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid var(--line)}.vision-marker>span{display:flex;flex-direction:column;gap:6px;color:var(--muted);font-size:14px}.vision-marker strong{font-size:14px;color:var(--ink);font-weight:550}.vision-check{display:flex;align-items:flex-start;gap:10px;font-size:14px;color:var(--ink);line-height:1.5;cursor:pointer}.vision-check input{width:17px!important;height:17px!important;margin:2px 0 0!important;flex-shrink:0}.vision-shot-list{border-top:1px solid var(--line)}.vision-shot-list>div{display:flex;align-items:center;border-bottom:1px solid var(--line);gap:8px}.vision-shot-list>div>button:first-child{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:13px 0;background:none;border:0;font:inherit;font-size:14px;cursor:pointer;color:var(--ink)}.vision-shot-list span{color:var(--muted);font-size:14px}.vision-page input[type=range]{accent-color:var(--accent);width:100%}.vision-page select,.vision-page input:not([type=checkbox]):not([type=range]){min-width:0;width:100%}@media(max-width:1220px){.vision-context-grid{grid-template-columns:minmax(180px,1fr) auto}.vision-capture-grid{grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr)}.vision-preview-head{padding:18px}.vision-review-grid{grid-template-columns:1fr 1fr}}@media(max-width:980px){.vision-capture-grid,.vision-review-grid,.vision-assistance-grid{grid-template-columns:1fr}.vision-aside{display:grid;grid-template-columns:1fr 1fr}.vision-context-grid{grid-template-columns:1fr}.vision-context-actions{grid-column:auto}.vision-coordinates{grid-template-columns:1fr 1fr}}@media(max-width:680px){.vision-aside{display:flex}.vision-preview-head{flex-direction:column;align-items:flex-start}.vision-metrics{gap:16px}.vision-region-steps>button{padding:8px 10px}.vision-profile-tools{flex-direction:column}}
`;
