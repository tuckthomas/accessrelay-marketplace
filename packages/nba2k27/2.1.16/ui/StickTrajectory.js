import { React, Card } from './host.js';
const ms = (value) => Number(value.toFixed(2)).toString().replace('-', '−');
export function StickTrajectoryGraph({ stroke, correctionMs }) {
    const { durationMs, fullUpHoldMs, anchorFraction, anchorTimeFraction, smooth, automaticDown } = stroke;
    const start = correctionMs - anchorTimeFraction * durationMs;
    const up = start + durationMs, neutral = up + fullUpHoldMs;
    // Use readable time ticks near the shot, even for a large signed correction.
    const roughTick = (neutral - start) / 3;
    const magnitude = 10 ** Math.floor(Math.log10(roughTick));
    const tick = ([1, 2, 5, 10].find(step => step * magnitude >= roughTick) ?? 10) * magnitude;
    const first = Math.floor(start / tick) * tick, last = Math.ceil(neutral / tick) * tick;
    const ticks = Array.from({ length: Math.round((last - first) / tick) + 1 }, (_, i) => first + i * tick);
    const x = (time) => 100 * (time - first) / (last - first);
    // Cubic control points one third apart in time give the engine's 3t² − 2t³ smoothstep.
    const ramp = smooth
        ? `C ${x(start + durationMs / 3)} 100 ${x(up - durationMs / 3)} 0 ${x(up)} 0`
        : `L ${x(up)} 0`;
    const down = automaticDown ? `M 0 100 H ${x(start)}` : `M ${x(start)} 100`;
    const path = `${down} ${ramp} H ${x(neutral)} V 50 H 100`;
    const anchor = `${ms(correctionMs)} ms`;
    const description = `${automaticDown ? 'The shot input sends the right stick down. The hold varies with the meter.' : 'The physical stick supplies the initial down hold.'} The ${smooth ? 'smooth' : 'linear'} upstroke takes ${ms(durationMs)} ms. The release point is ${anchor} relative to the delay-compensated meter target. The stick holds full up for ${ms(fullUpHoldMs)} ms and returns to center. Horizontal output stays centered during the assisted stroke.`;
    return React.createElement(Card, { title: "Auto-green stick trajectory" },
        React.createElement("figure", { className: "nba-stick-graph" },
            React.createElement("div", { className: "nba-stick-key" },
                React.createElement("span", null, "Right-stick position"),
                React.createElement("span", null,
                    React.createElement("i", { "aria-hidden": "true" }),
                    "Release point ",
                    anchor)),
            React.createElement("div", { className: "nba-stick-chart", role: "img", "aria-label": description },
                React.createElement("div", { className: "nba-stick-levels", "aria-hidden": "true" },
                    React.createElement("span", null, "Full up"),
                    React.createElement("span", null, "Center"),
                    React.createElement("span", null, "Full down")),
                React.createElement("div", { className: "nba-stick-grid", "aria-hidden": "true" },
                    automaticDown && React.createElement("div", { className: "nba-stick-lead" },
                        React.createElement("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none" },
                            React.createElement("path", { className: "nba-stick-curve", d: "M 0 50 H 14 V 100 H 57 M 75 100 H 100" }),
                            React.createElement("path", { className: "nba-stick-break", d: "M 57 103 l 8 -6 M 66 103 l 8 -6" })),
                        React.createElement("span", { className: "nba-stick-onset" }, "Input")),
                    React.createElement("div", { className: "nba-stick-timed" },
                        ticks.map((time, i) => React.createElement("div", { className: "nba-stick-tick", style: { left: `${x(time)}%` }, key: i },
                            React.createElement("span", null, ms(time)))),
                        React.createElement("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none" },
                            React.createElement("path", { className: "nba-stick-curve", d: path })),
                        React.createElement("i", { className: "nba-stick-anchor", style: { left: `${x(correctionMs)}%`, top: `${100 * (1 - anchorFraction)}%` } })))),
            React.createElement("div", { className: "nba-stick-axis" }, "Time from release target (ms)"),
            React.createElement("figcaption", { className: "subtle" },
                automaticDown ? 'The break marks the wait for the meter.' : 'The down hold comes from your physical stick.',
                " Upstroke ",
                ms(durationMs),
                " ms \u00B7 Full-up hold ",
                ms(fullUpHoldMs),
                " ms.")));
}
