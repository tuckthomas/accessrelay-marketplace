import { describe, expect, it } from 'vitest';
import { adjustMeterCalibration } from '../../dist/ui/MeterCalibration.js';

const config = { inputMode: 'rhythm', strokeDurationMs: 56, results: [], calibratedWidth: 1280, calibratedHeight: 720 };
const tune = (timing: string, tempo: string, correctionMs = 0, setup: any = config) =>
  adjustMeterCalibration(setup, { correctionMs }, { timing, tempo }, 'setup');

describe('feedback-driven meter calibration', () => {
  it.each([['early', 8], ['slightlyEarly', 4], ['excellent', 0], ['slightlyLate', -4], ['late', -8]])(
    'moves %s timing toward Excellent while preserving Excellent tempo', (feedback, correction) => {
      const next = tune(feedback as string, 'excellent');
      expect(next.timing.correctionMs).toBe(correction);
      expect(next.configuration.strokeDurationMs).toBe(56);
    });
  it.each([['fast', 60], ['slightlyFast', 58], ['excellent', 56], ['slightlySlow', 54], ['slow', 52], ['none', 56]])(
    'uses reported %s tempo without moving Excellent timing', (feedback, duration) => {
      const next = tune('excellent', feedback as string);
      expect(next.timing.correctionMs).toBe(0);
      expect(next.configuration.strokeDurationMs).toBe(duration);
    });
  it('bounds repeated late/no-tempo saves and explains the limit', () => {
    let correction = -80;
    for (let i = 0; i < 30; i++) {
      const next = tune('late', 'none', correction);
      expect(correction - next.timing.correctionMs).toBeLessThanOrEqual(8);
      expect(next.configuration.strokeDurationMs).toBe(56);
      correction = next.timing.correctionMs;
    }
    expect(correction).toBe(-120);
    expect(tune('late', 'none', correction).message).toContain('adjustment limit');
    expect(tune('early', 'none', -200).timing.correctionMs).toBe(-192);
    expect(tune('late', 'none', -200).timing.correctionMs).toBe(-200);
  });
  it('narrows a timing bracket using saved evidence after reopening the page', () => {
    const setup = { ...config, results: [{ tuningContextKey: 'setup', timing: 'late', correctionMs: 0,
      strokeDurationMs: 56, width: 1280, height: 720 }] };
    expect(tune('early', 'excellent', -8, setup).timing.correctionMs).toBe(-4);
    expect(tune('early', 'excellent', -2, setup).timing.correctionMs).toBe(-1);
    expect(tune('early', 'excellent', -80, setup).timing.correctionMs).toBe(-72);
    expect(tune('early', 'excellent', -.25, setup).timing.correctionMs).toBe(-.25);
    expect(tune('early', 'excellent', -8, { ...setup, calibratedWidth: 2560 }).timing.correctionMs).toBe(0);
    expect(tune('early', 'excellent', -8, { ...setup, strokeDurationMs: 60 }).timing.correctionMs).toBe(0);
    expect(tune('early', 'excellent', -8, { ...setup, results: [{ ...setup.results[0], tuningContextKey: 'other' }] }).timing.correctionMs).toBe(0);
  });
  it('narrows tempo brackets only at the same timing correction and ignores tempo for button shots', () => {
    const setup = { ...config, results: [{ tuningContextKey: 'setup', tempo: 'slow', correctionMs: 0,
      strokeDurationMs: 60, width: 1280, height: 720 }] };
    expect(tune('excellent', 'fast', 0, setup).configuration.strokeDurationMs).toBe(58);
    expect(tune('excellent', 'fast', 8, setup).configuration.strokeDurationMs).toBe(60);
    expect(tune('late', 'fast', 0, { ...config, inputMode: 'button' }).configuration.strokeDurationMs).toBe(56);
  });
});
