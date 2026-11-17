import { React, useState, Select, SelectOption, Button, Card, Field, Icon, Notice, humanize } from './host.js';
export function Nba2K27SequenceTuning(props) {
    return props.id ? React.createElement("details", null,
        React.createElement("summary", null, "NBA 2K27 feedback tuning"),
        React.createElement(FeedbackTuning, { ...props }))
        : React.createElement(Card, { title: "Fine-tune from shot feedback", description: "Optional manual tuning for NBA 2K27." },
            React.createElement(FeedbackTuning, { ...props }));
}
function FeedbackTuning({ command, variant, id, disabled, onApplied }) {
    const [timing, setTiming] = useState('none'), [tempo, setTempo] = useState('none'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    return React.createElement("div", { className: "stack" },
        React.createElement("div", { className: "form-grid" },
            React.createElement(Field, { label: "Timing feedback" },
                React.createElement(Select, { value: timing, onValueChange: selectionValue => setTiming(selectionValue) }, ['none', 'early', 'slightlyEarly', 'excellent', 'slightlyLate', 'late'].map(value => React.createElement(SelectOption, { value: value, key: value }, value === 'none' ? 'No adjustment' : humanize(value))))),
            React.createElement(Field, { label: "Tempo feedback" },
                React.createElement(Select, { value: tempo, onValueChange: selectionValue => setTempo(selectionValue) }, ['none', 'fast', 'slightlyFast', 'excellent', 'slightlySlow', 'slow'].map(value => React.createElement(SelectOption, { value: value, key: value }, value === 'none' ? 'No adjustment' : humanize(value)))))),
        React.createElement("p", { className: "subtle" }, "Applies a small timing adjustment to this saved sequence. Feedback is a tuning hint, not a measured latency correction."),
        React.createElement(Button, { busy: busy, disabled: disabled || (timing === 'none' && tempo === 'none'), onClick: async () => { setBusy(true); setMessage(''); try {
                await command('packAction', { action: 'feedback', id, variant, timingFeedback: timing, tempoFeedback: tempo });
                await onApplied?.();
                setMessage('Feedback adjustment applied to the saved sequence.');
            }
            catch (e) {
                setMessage(e instanceof Error ? e.message : String(e));
            }
            finally {
                setBusy(false);
            } } },
            React.createElement(Icon, { name: "sliders", size: 16 }),
            "Apply feedback adjustment"),
        message && React.createElement(Notice, null, message));
}
