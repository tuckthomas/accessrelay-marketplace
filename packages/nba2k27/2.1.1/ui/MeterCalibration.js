export const successfulMeterResult = (result, inputMode = 'rhythm') => result.timing === 'excellent'
    && (inputMode === 'button' || (result.shotType !== 'timing' && (result.tempo === 'excellent'
        || (result.shotType === 'rhythm' && result.tempo === 'none'))));
// Automatic tuning takes conservative steps. Values outside this range remain
// available through manual settings, but feedback cannot push them farther out.
const bounded = (current, proposed, min, max) => Math.max(Math.min(current, min), Math.min(Math.max(current, max), proposed));
function nextValue(current, delta, samples, value, outcome, opposites) {
    if (!delta)
        return current;
    const opposite = samples.filter(r => opposites.includes(r[outcome]) && Number.isFinite(r[value])
        && (r[value] - current) * delta > 0).sort((a, b) => Math.abs(a[value] - current) - Math.abs(b[value] - current))[0];
    // Once results straddle Excellent, bisect instead of stepping past the bracket.
    if (!opposite)
        return current + delta;
    const midpoint = Math.round((current + opposite[value]) * 2) / 4;
    if (midpoint <= Math.min(current, opposite[value]) || midpoint >= Math.max(current, opposite[value]))
        return current;
    return delta > 0 ? Math.min(current + delta, midpoint) : Math.max(current + delta, midpoint);
}
export function adjustMeterCalibration(config, timing, feedback, contextKey) {
    const correction = timing.correctionMs ?? 0, stroke = config.strokeDurationMs;
    const history = contextKey ? (config.results ?? []).filter((r) => r.tuningContextKey === contextKey
        && r.width === config.calibratedWidth && r.height === config.calibratedHeight) : [];
    const timingDelta = { early: 8, slightlyEarly: 4, slightlyLate: -4, late: -8 }[feedback.timing] ?? 0;
    const tempoDelta = config.inputMode === 'rhythm'
        ? { fast: 4, slightlyFast: 2, slightlySlow: -2, slow: -4 }[feedback.tempo] ?? 0 : 0;
    const nextCorrection = bounded(correction, nextValue(correction, timingDelta, history.filter((r) => r.strokeDurationMs === stroke), 'correctionMs', 'timing', timingDelta > 0 ? ['late', 'slightlyLate'] : ['early', 'slightlyEarly']), -120, 120);
    const nextStroke = bounded(stroke, nextValue(stroke, tempoDelta, history.filter((r) => r.correctionMs === correction), 'strokeDurationMs', 'tempo', tempoDelta > 0 ? ['slow', 'slightlySlow'] : ['fast', 'slightlyFast']), 8, 500);
    const changes = [];
    if (nextCorrection !== correction)
        changes.push(`Timing correction: ${correction} → ${nextCorrection} ms (${nextCorrection < correction ? 'earlier' : 'later'}).`);
    if (nextStroke !== stroke)
        changes.push(`Stroke duration: ${stroke} → ${nextStroke} ms.`);
    const limited = (timingDelta !== 0 && nextCorrection === correction) || (tempoDelta !== 0 && nextStroke === stroke);
    if (limited)
        changes.push('Automatic tuning reached its adjustment limit. Review Advanced settings and record diagnostics before further adjustment.');
    if (config.inputMode === 'rhythm' && feedback.tempo === 'none')
        changes.push(successfulMeterResult(feedback)
            ? 'Rhythm Excellent recorded. Keep this successful motion for the next confirmation trial.'
            : feedback.shotType === 'timing' ? 'NBA reported TIMING, so this result does not confirm rhythm calibration. No tempo grade was inferred.'
                : 'No separate tempo grade was shown; the recorded stroke is kept.');
    if (!timingDelta && !tempoDelta && !changes.length)
        changes.push('Excellent settings kept for the next trial.');
    return { configuration: { ...config, strokeDurationMs: nextStroke, calibrationTrial: true },
        timing: { ...timing, correctionMs: nextCorrection }, changed: nextCorrection !== correction || nextStroke !== stroke,
        message: changes.join(' ') };
}
