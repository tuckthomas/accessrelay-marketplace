// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { selectValue } from '@studio/select-test-helper';
import { gameUiHost } from '@studio/game-plugins/registry';
import { createPlugin } from '../../dist/ui/index.js';

const Workspace = createPlugin(gameUiHost).VisionWorkspace!;
afterEach(cleanup);
function fixture(overrides: any = {}) {
  const profile = { id: 'shot-profile', name: 'Stretch Big', cameraView: '2K', meterReleaseType: 'Push', usesShotMeter: true };
  return { selectedProfile: profile, profiles: [profile], selectedSourceId: 'remote-play', assistance: { key: 'current-setup', successfulTrials: 0, currentResults: [] },
    settings: { shootButton: 'x', pluginAssistance: { enabled: true, calibrationTrial: true, gameBuild: '2.0.0.12' }, trainingCapture: {} },
    status: { session: { running: true, canArm: true }, controllerConnection: { connected: true, inputConnected: true }, output: { armed: false } }, ...overrides };
}

describe('meter calibration workflow', () => {
  it('shows actual stream readings without configuring or arming output, and marks missing measurements unavailable', () => {
    const command = vi.fn(), state = fixture();
    const view = render(<Workspace mode="live" state={state} status={{ ...state.status, streamTelemetry: { state: 'stable', message: 'Stream stable.',
      latest: { pingMs: 12, jitterMs: 1.5, decodeMs: 2, fps: 60 } } }} command={command} />);
    expect(screen.getByText('12.0 ms')).toBeTruthy();
    expect(screen.getByText('1.5 ms')).toBeTruthy();
    expect(screen.getByText('60.0 FPS')).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
    view.rerender(<Workspace mode="live" state={state} status={{ ...state.status, streamTelemetry: { state: 'unavailable', message: 'No fresh statistics.' } }} command={command} />);
    expect(screen.getByText('No fresh statistics.')).toBeTruthy();
    expect(screen.queryByText('0.0 ms')).toBeNull();
    expect(screen.queryByText('12.0 ms')).toBeNull();
  });
  it('does not save a previous completed receipt when the latest attempt was cancelled', () => {
    const command = vi.fn(), state = fixture();
    render(<Workspace mode="live" state={state} status={{ ...state.status,
      lastAction: { id: 2, runId: 'run', configurationKey: 'current-setup', eligibleForFeedback: true },
      lastAttempt: { id: 3, runId: 'run', outcome: 'cancelled', cancellationReason: 'Tracking lost' },
      output: { armed: true, holdingCancelledPaddleShot: true } }} command={command} />);
    expect(screen.getByText(/Release the paddle to return the stick to neutral/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save result' })).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });
  it('keeps unvalidated output feedback out of automatic practice saving', () => {
    const command = vi.fn(), state = fixture();
    render(<Workspace mode="live" state={state} status={{ ...state.status,
      lastAction: { id: 2, runId: 'run', configurationKey: 'current-setup', eligibleForFeedback: false },
      ocrFeedback: { receiptId: 2, runId: 'run', timing: 'excellent', tempo: 'excellent', shotType: 'rhythm', feedbackEligible: false } }} command={command} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-save OCR practice results & re-arm' }));
    expect((screen.getByRole('button', { name: 'Save result' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Local output timing was not validated/)).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
  });
  it('records RHYTHM Excellent without inventing a separate tempo grade or changing the successful motion', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    render(<Workspace mode="live" state={state} status={{ ...state.status,
      lastAction: { id: 19, runId: 'native-run', configurationKey: 'current-setup' } }} command={command} />);
    await selectValue(screen.getByRole('combobox', { name: 'Feedback heading' }), 'rhythm');
    await selectValue(screen.getByRole('combobox', { name: 'Shot timing' }), 'excellent');
    expect(screen.getByRole('combobox', { name: 'Shot tempo' }).textContent).toContain('No tempo shown');
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await screen.findByText(/Rhythm Excellent recorded/);
    expect(command).toHaveBeenCalledWith('signalFeedback', { receiptId: 19, runId: 'native-run',
      feedback: { timing: 'excellent', tempo: 'none', shotType: 'rhythm' } });
    expect(command.mock.calls.map(([action]) => action)).toEqual(['signalFeedback']);
  });
  it('records plain TIMING Excellent as unconfirmed rhythm evidence and prevents a fabricated tempo', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    render(<Workspace mode="live" state={state} status={{ ...state.status,
      lastAction: { id: 20, runId: 'native-run', configurationKey: 'current-setup' } }} command={command} />);
    await selectValue(screen.getByRole('combobox', { name: 'Feedback heading' }), 'timing');
    await selectValue(screen.getByRole('combobox', { name: 'Shot timing' }), 'excellent');
    expect((screen.getByRole('combobox', { name: 'Shot tempo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await screen.findByText(/NBA reported TIMING, so this result does not confirm rhythm calibration/);
    expect(command).toHaveBeenCalledWith('signalFeedback', { receiptId: 20, runId: 'native-run',
      feedback: { timing: 'excellent', tempo: 'none', shotType: 'timing' } });
  });
  it('renders before settings arrive and adopts the first settings snapshot without configuring output', () => {
    const command = vi.fn(), state = fixture({ settings: undefined });
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    expect(screen.getByRole('heading', { name: 'Calibrate your shot' })).toBeTruthy();
    view.rerender(<Workspace mode="live" state={{ ...state, settings: { pluginAssistance: { enabled: true, strokeDurationMs: 64 }, correctionMs: -24 } }}
      status={state.status} command={command} />);
    fireEvent.click(screen.getByText('Advanced settings'));
    expect((screen.getByRole('spinbutton', { name: 'Timing correction · ms' }) as HTMLInputElement).value).toBe('-24');
    expect((screen.getByRole('spinbutton', { name: 'Stroke duration · ms' }) as HTMLInputElement).value).toBe('64');
    expect(command).not.toHaveBeenCalled();
  });
  it('distinguishes committed completion and cancelled tracking from a live forecast', () => {
    const command = vi.fn(), state = fixture();
    const view = render(<Workspace mode="live" state={state} status={{ ...state.status, output: { armed: true },
      signal: { continueCommittedAction: true, timeToTargetMs: null, message: 'Meter is no longer visible after the timing anchor; finishing the committed stroke.' } }} command={command} />);
    expect(screen.getByText('Finishing anchored stroke')).toBeTruthy();
    expect(screen.queryByText('Live forecast')).toBeNull();
    view.rerender(<Workspace mode="live" state={state} status={{ ...state.status,
      signal: { invalidateAttempt: true, message: 'Meter changed identity or progression. Return to neutral.' } }} command={command} />);
    expect(screen.getByText('Attempt cancelled')).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
  });
  it('records diagnostics separately from assistance and shows saving and skipped images', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Diagnostic recording'));
    fireEvent.click(screen.getByRole('button', { name: 'Record diagnostics' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('diagnosticStart', undefined));
    expect(command.mock.calls.map(([action]) => action)).toEqual(['diagnosticStart']);
    const diagnostic = { isRecording: true, isFinalized: false, observedFrames: 40, storedFrames: 35, droppedFrames: 2, message: 'Recording diagnostics.' };
    view.rerender(<Workspace mode="live" state={state} status={{ ...state.status, diagnosticRecording: diagnostic }} command={command} />);
    expect(screen.getByRole('button', { name: 'Stop diagnostic recording' }).getAttribute('data-state')).toBe('on');
    expect((screen.getByRole('button', { name: 'Start practice trial' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Stop diagnostic recording' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('diagnosticStop', undefined));
    view.rerender(<Workspace mode="live" state={state} status={{ ...state.status, diagnosticRecording: { ...diagnostic, isRecording: false } }} command={command} />);
    expect((screen.getByRole('button', { name: 'Record diagnostics' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<Workspace mode="live" state={state} status={{ ...state.status, diagnosticRecording: { ...diagnostic, isRecording: false, isFinalized: true } }} command={command} />);
    expect(screen.getByText('40 frames analyzed · 35 images saved · 2 images skipped')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic folder' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('openDiagnosticFolder', undefined));
    expect(command.mock.calls.some(([action]) => action === 'armedSet')).toBe(false);
  });
  it('shows an existing connection and requires an explicit practice action; advanced tuning starts collapsed', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect controller' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /calibration/i })).toBeNull();
    expect(document.querySelector('.meter-advanced')?.hasAttribute('open')).toBe(false);
    expect(screen.getByRole('button', { name: 'Start practice trial' }).getAttribute('data-state')).toBe('off');
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start practice trial' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: true }));
    const completed = { ...state.status, output: { armed: true }, lastAction: { id: 7, runId: 'native-run', configurationKey: 'current-setup' } };
    view.rerender(<Workspace mode="live" state={state} status={completed} command={command} />);
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: false }));
    expect(screen.getByRole('button', { name: 'Pause trial' }).getAttribute('data-state')).toBe('on');
    expect(screen.getByRole('combobox', { name: 'Shot timing' }).textContent).toContain('Choose timing');
    expect(screen.getByRole('combobox', { name: 'Shot tempo' }).textContent).toContain('Choose tempo');
    expect((screen.getByRole('button', { name: 'Save result' }) as HTMLButtonElement).disabled).toBe(true);
    await selectValue(screen.getByRole('combobox', { name: 'Shot timing' }), 'excellent');
    expect((screen.getByRole('button', { name: 'Save result' }) as HTMLButtonElement).disabled).toBe(true);
    await selectValue(screen.getByRole('combobox', { name: 'Feedback heading' }), 'rhythm');
    await selectValue(screen.getByRole('combobox', { name: 'Shot tempo' }), 'slightlyFast');
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('signalFeedback', {
      receiptId: 7, runId: 'native-run', feedback: { timing: 'excellent', tempo: 'slightlyFast', shotType: 'rhythm' }
    }));
  });

  it('saves the original receipt then applies an earlier next trial without guessing a missing tempo', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    const completed = { ...state.status, output: { armed: false }, lastAction: { id: 8, runId: 'native-run', configurationKey: 'current-setup' } };
    render(<Workspace mode="live" state={state} status={completed} command={command} />);
    await selectValue(screen.getByRole('combobox', { name: 'Shot timing' }), 'late');
    await selectValue(screen.getByRole('combobox', { name: 'Feedback heading' }), 'rhythm');
    await selectValue(screen.getByRole('combobox', { name: 'Shot tempo' }), 'none');
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('signalFeedback', {
      receiptId: 8, runId: 'native-run', feedback: { timing: 'late', tempo: 'none', shotType: 'rhythm' }
    }));
    await screen.findByText(/Timing correction: 0 → -8 ms \(earlier\)/);
    expect(command.mock.calls.map(([action]) => action)).toEqual(['signalFeedback', 'signalConfigure']);
    expect(command).toHaveBeenCalledWith('signalConfigure', expect.objectContaining({ correctionMs: -8, restart: true,
      configuration: expect.objectContaining({ strokeDurationMs: 56, calibrationTrial: true }) }));
    expect(screen.queryByRole('combobox', { name: 'Shot timing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start practice trial' })).toBeTruthy();
  });

  it('uses accumulated small adjustments for consecutive late/no-tempo results', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    state.settings = { ...state.settings, correctionMs: -80, estimatedVideoDelayMs: 60, estimatedInputDelayMs: 15 };
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    for (let id = 1; id <= 3; id++) {
      fireEvent.click(screen.getByRole('button', { name: 'Start practice trial' }));
      await waitFor(() => expect(command.mock.calls.filter(([action, args]) => action === 'armedSet' && args.armed)).toHaveLength(id));
      const completed = { ...state.status, output: { armed: true },
        lastAction: { id, runId: 'native-run', configurationKey: 'current-setup' } };
      view.rerender(<Workspace mode="live" state={state} status={completed} command={command} />);
      await waitFor(() => expect(command.mock.calls.filter(([action, args]) => action === 'armedSet' && !args.armed)).toHaveLength(id));
      view.rerender(<Workspace mode="live" state={state} status={{ ...completed, output: { armed: false } }} command={command} />);
      expect(screen.getByRole('combobox', { name: 'Shot timing' })).toBeTruthy();
      if (id === 3) break;
      await selectValue(screen.getByRole('combobox', { name: 'Shot timing' }), 'late');
      await selectValue(screen.getByRole('combobox', { name: 'Feedback heading' }), 'rhythm');
      await selectValue(screen.getByRole('combobox', { name: 'Shot tempo' }), 'none');
      fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
      await screen.findByText(new RegExp(`Timing correction: ${-80 - (id - 1) * 8} → ${-80 - id * 8} ms`));
      state.assistance.currentResults.push({ receiptId: id, runId: 'native-run', timing: 'late', tempo: 'none' });
      state.settings = { ...state.settings, correctionMs: -80 - id * 8,
        pluginAssistance: { ...state.settings.pluginAssistance, strokeDurationMs: 56 } };
      view.rerender(<Workspace mode="live" state={state} status={{ ...completed, output: { armed: false } }} command={command} />);
    }
    expect(command.mock.calls.filter(([action]) => action === 'signalFeedback')).toHaveLength(2);
    expect(command.mock.calls.filter(([action]) => action === 'signalConfigure').map(([, args]) => args.correctionMs)).toEqual([-88, -96]);
    expect(command.mock.calls.some(([action]) => ['start', 'stop'].includes(action))).toBe(false);
    expect(state.settings.correctionMs).toBe(-96);
    expect(state.assistance.currentResults).toHaveLength(2);
  });

  it('keeps Excellent timing and tempo unchanged so matching successes can accumulate', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    render(<Workspace mode="live" state={state} status={{ ...state.status,
      lastAction: { id: 9, runId: 'native-run', configurationKey: 'current-setup' } }} command={command} />);
    await selectValue(screen.getByRole('combobox', { name: 'Shot timing' }), 'excellent');
    await selectValue(screen.getByRole('combobox', { name: 'Feedback heading' }), 'rhythm');
    await selectValue(screen.getByRole('combobox', { name: 'Shot tempo' }), 'excellent');
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await screen.findByText(/Excellent settings kept for the next trial/);
    expect(command.mock.calls.map(([action]) => action)).toEqual(['signalFeedback']);
  });

  it('does not adjust settings when saving the receipt fails', async () => {
    const command = vi.fn().mockRejectedValue(new Error('A newer shot completed.')), state = fixture();
    render(<Workspace mode="live" state={state} status={{ ...state.status,
      lastAction: { id: 10, runId: 'native-run', configurationKey: 'current-setup' } }} command={command} />);
    await selectValue(screen.getByRole('combobox', { name: 'Shot timing' }), 'late');
    await selectValue(screen.getByRole('combobox', { name: 'Feedback heading' }), 'rhythm');
    await selectValue(screen.getByRole('combobox', { name: 'Shot tempo' }), 'none');
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await screen.findByText('A newer shot completed.');
    expect(command.mock.calls.map(([action]) => action)).toEqual(['signalFeedback']);
    expect(screen.getByRole('combobox', { name: 'Shot timing' }).textContent).toContain('Late');
  });

  it('retains a saved receipt and blocks the next trial until a failed adjustment is retried', async () => {
    const command = vi.fn().mockImplementation(async (action: string) => {
      if (action === 'signalConfigure' && command.mock.calls.filter(([a]) => a === 'signalConfigure').length === 1)
        throw new Error('Preview restart failed.');
    }), state = fixture();
    render(<Workspace mode="live" state={state} status={{ ...state.status,
      lastAction: { id: 11, runId: 'native-run', configurationKey: 'current-setup' } }} command={command} />);
    await selectValue(screen.getByRole('combobox', { name: 'Shot timing' }), 'late');
    await selectValue(screen.getByRole('combobox', { name: 'Feedback heading' }), 'rhythm');
    await selectValue(screen.getByRole('combobox', { name: 'Shot tempo' }), 'none');
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await screen.findByText(/Result saved, but the next-trial adjustment could not be applied/);
    expect((screen.getByRole('button', { name: 'Start practice trial' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save result' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry adjustment' }));
    await waitFor(() => expect(command.mock.calls.filter(([a]) => a === 'signalConfigure')).toHaveLength(2));
    expect(command.mock.calls.filter(([a]) => a === 'signalFeedback')).toHaveLength(1);
    expect(command.mock.calls.filter(([a]) => a === 'signalConfigure').map(([, args]) => args.correctionMs)).toEqual([-8, -8]);
    await screen.findByText(/Timing settings applied for the next trial/);
  });

  it('surfaces connection failure and does not arm or start capture while opening the page', async () => {
    const command = vi.fn().mockRejectedValue(new Error('The virtual controller could not connect.'));
    const state = fixture({ status: { session: { running: true, canArm: true }, controllerConnection: { connected: false, inputConnected: true }, output: { armed: false } } });
    render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    expect(command).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Start practice trial' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Connect controller' }));
    await screen.findByText('The virtual controller could not connect.');
    expect(command.mock.calls.map(([action]) => action)).toEqual(['connectOutput']);
  });

  it('makes the recorded observation-only failure explicit without treating an old receipt as a new action', () => {
    const command = vi.fn(), state = fixture();
    const status = { ...state.status, lastAction: { id: 1, runId: 'recorded-run', configurationKey: 'current-setup' },
      output: { armed: false, message: 'Observation only. Automatic release is off.' },
      signal: { acquired: true, progress: .367, timeToTargetMs: 381, uncertaintyMs: 6.89, samples: 8 } };
    render(<Workspace mode="live" state={state} status={status} command={command} />);
    expect(screen.queryByText('Automatic reversal')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save result' })).toBeTruthy();
    expect(screen.getByText('Observation only — assistance off')).toBeTruthy();
    expect(screen.queryByText('Live forecast')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start practice trial' })).toBeNull();
    fireEvent.click(screen.getByText('Diagnostic recording'));
    expect(screen.getByRole('button', { name: 'Record diagnostics' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record assisted trial' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record assisted shots' })).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });

  it('starts diagnostic recording independently without arming controller output, then pauses a started trial after its new completed receipt', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByText('Diagnostic recording'));
    fireEvent.click(screen.getByRole('button', { name: 'Record diagnostics' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('diagnosticStart', undefined));
    expect(command.mock.calls.map(([action]) => action)).toEqual(['diagnosticStart']);
    fireEvent.click(screen.getByRole('button', { name: 'Start practice trial' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: true }));
    const completed = { ...state.status, output: { armed: true },
      diagnosticRecording: { isRecording: true, isFinalized: false },
      lastAction: { id: 2, runId: 'native-run', configurationKey: 'current-setup' } };
    view.rerender(<Workspace mode="live" state={state} status={completed} command={command} />);
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: false }));
    expect(command.mock.calls.map(([action]) => action)).toEqual(['diagnosticStart', 'armedSet', 'armedSet']);
    view.rerender(<Workspace mode="live" state={state} status={{ ...completed, output: { armed: false } }} command={command} />);
    expect(screen.getByRole('button', { name: 'Save result' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop diagnostic recording' })).toBeTruthy();
  });

  it('keeps accepted assistance on across completed shots even while diagnostic recording is active', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture({
      assistance: { key: 'current-setup', accepted: true, successfulTrials: 3, currentResults: [] }
    });
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start assistance' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: true }));
    fireEvent.click(screen.getByText('Diagnostic recording'));
    fireEvent.click(screen.getByRole('button', { name: 'Record diagnostics' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('diagnosticStart', undefined));
    view.rerender(<Workspace mode="live" state={state} status={{ ...state.status, output: { armed: true },
      diagnosticRecording: { isRecording: true, isFinalized: false },
      lastAction: { id: 5, runId: 'native-run', configurationKey: 'current-setup' } }} command={command} />);
    expect(screen.getByRole('button', { name: 'Pause assistance' })).toBeTruthy();
    expect(command.mock.calls.map(([action]) => action)).toEqual(['armedSet', 'diagnosticStart']);
  });

  it('pauses an owned practice trial when leaving the page', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start practice trial' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: true }));
    view.unmount();
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: false }));
  });

  it('disarms a startup that finishes after navigation, including accepted assistance', async () => {
    let finishArm!: () => void;
    const command = vi.fn((action: string, args: any) => action === 'armedSet' && args.armed
      ? new Promise<void>(resolve => { finishArm = resolve; }) : Promise.resolve());
    const state = fixture({ assistance: { key: 'current-setup', accepted: true, successfulTrials: 3, currentResults: [] } });
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start assistance' }));
    view.unmount();
    command.mockClear();
    finishArm();
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: false }));
  });

  it('stops preview if the automatic practice pause fails and displays the failure', async () => {
    const command = vi.fn((action: string, args: any) => action === 'armedSet' && !args.armed
      ? Promise.reject(new Error('Pause request failed.')) : Promise.resolve());
    const state = fixture();
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start practice trial' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: true }));
    const status = { ...state.status, output: { armed: true }, lastAction: { id: 6, runId: 'native-run', configurationKey: 'current-setup' } };
    view.rerender(<Workspace mode="live" state={state} status={status} command={command} />);
    await waitFor(() => expect(command.mock.calls.some(([action]) => action === 'stop')).toBe(true));
    expect(screen.getByText(/Pause request failed\./)).toBeTruthy();
    view.rerender(<Workspace mode="live" state={state} status={{ ...status, signal: { samples: 9 } }} command={command} />);
    expect(command.mock.calls.filter(([action, args]) => action === 'armedSet' && !args.armed)).toHaveLength(1);
  });

  it('cancels practice trial startup when Stop preview is pressed before arming finishes', async () => {
    let finishArm!: () => void;
    const command = vi.fn((action: string, args: any) => action === 'armedSet' && args.armed
      ? new Promise<void>(resolve => { finishArm = resolve; }) : Promise.resolve());
    const state = fixture();
    render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start practice trial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop preview' }));
    await waitFor(() => expect(command.mock.calls.some(([action]) => action === 'stop')).toBe(true));
    finishArm();
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: false }));
  });

  it('uses the stop fallback when a manual practice pause fails', async () => {
    const command = vi.fn((action: string, args: any) => action === 'armedSet' && !args.armed
      ? Promise.reject(new Error('Manual pause failed.')) : Promise.resolve());
    const state = fixture();
    const view = render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start practice trial' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: true }));
    view.rerender(<Workspace mode="live" state={state} status={{ ...state.status, output: { armed: true } }} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause trial' }));
    await waitFor(() => expect(command.mock.calls.some(([action]) => action === 'stop')).toBe(true));
    expect(screen.getByText(/Manual pause failed\./)).toBeTruthy();
  });

  it('defaults rhythm shots to a paddle trigger, guides centered right-stick play when armed, and lets users switch triggers', async () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    const view = render(<Workspace mode="live" state={state} status={{ ...state.status, output: { armed: true },
      session: { running: false, canArm: true } }} command={command} />);
    expect(screen.getByText(/Hold P4 · Large right paddle down through the automatic reversal.*Keep the right stick centered/)).toBeTruthy();
    await selectValue(screen.getByRole('combobox', { name: 'Shot trigger' }), 'largeLeft');
    fireEvent.click(screen.getByRole('button', { name: 'Start preview' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('signalConfigure', expect.objectContaining({
      configuration: expect.objectContaining({ trigger: 'largeLeft' })
    })));
    view.rerender(<Workspace mode="live" state={fixture({ settings: { shootButton: 'x', pluginAssistance: { enabled: true, calibrationTrial: true, gameBuild: '2.0.0.12', trigger: 'largeLeft' }, trainingCapture: {} } })}
      status={{ ...state.status, output: { armed: true } }} command={command} />);
    expect(screen.getByText(/Hold P3 · Large left paddle down through the automatic reversal/)).toBeTruthy();
  });

  it('duplicates a calibrated shot profile from Profile presets while preview is running and re-arms', async () => {
    const p2 = { id: 'shot-copy', name: 'Stretch Big copy', cameraView: '2K', meterReleaseType: 'Push', usesShotMeter: true };
    const command = vi.fn((action: string) => action === 'profileDuplicate' ? Promise.resolve(p2) : Promise.resolve(null));
    const state = fixture({
      assistance: { key: 'current-setup', accepted: true, successfulTrials: 3, currentResults: [] },
      settings: { correctionMs: -15, shootButton: 'x', pluginAssistance: { enabled: true, confirmed: true, calibrationTrial: false, gameBuild: '2.0.0.12' }, trainingCapture: {} }
    });
    const view = render(<Workspace mode="live" state={state} status={{ ...state.status, output: { armed: true } }} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    const nameInput = screen.getByLabelText('New profile name') as HTMLInputElement;
    expect(nameInput.value).toBe('Stretch Big copy');
    fireEvent.click(screen.getByRole('button', { name: 'Save copy' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('profileDuplicate', { id: 'shot-profile', name: 'Stretch Big copy', restart: true }));
    expect(command.mock.calls.slice(0, 2).map(([a]) => a)).toEqual(['armedSet', 'profileDuplicate']);
    view.rerender(<Workspace mode="live" state={{ ...state, selectedProfile: p2, profiles: [state.selectedProfile, p2] }}
      status={{ ...state.status, output: { armed: false } }} command={command} />);
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: true }));
  });

  it('switches shot profiles live without stopping capture and updates displayed timing correction', async () => {
    const p1 = { id: 'offline', name: 'Offline', cameraView: '2K', meterReleaseType: 'Push', usesShotMeter: true };
    const p2 = { id: 'online', name: 'Online', cameraView: '2K', meterReleaseType: 'Push', usesShotMeter: true };
    const command = vi.fn().mockResolvedValue(null);
    const state = fixture({
      selectedProfile: p1, profiles: [p1, p2],
      assistance: { key: 'current-setup', accepted: true, successfulTrials: 3, currentResults: [] },
      settings: { correctionMs: -15, shootButton: 'x', pluginAssistance: { enabled: true, confirmed: true, calibrationTrial: false, gameBuild: '2.0.0.12' }, trainingCapture: {} }
    });
    const view = render(<Workspace mode="live" state={state} status={{ ...state.status, output: { armed: true } }} command={command} />);
    await selectValue(screen.getByRole('combobox', { name: 'Shot profile' }), 'online');
    await waitFor(() => expect(command).toHaveBeenCalledWith('profileSelect', { id: 'online', restart: true }));
    expect(command.mock.calls.slice(0, 2).map(([a]) => a)).toEqual(['armedSet', 'profileSelect']);
    view.rerender(<Workspace mode="live" state={{ ...state, selectedProfile: p2,
      settings: { correctionMs: 22, shootButton: 'x', pluginAssistance: { enabled: true, confirmed: true, calibrationTrial: false, gameBuild: '2.0.0.12' }, trainingCapture: {} } }}
      status={{ ...state.status, output: { armed: false } }} command={command} />);
    await waitFor(() => expect(command).toHaveBeenCalledWith('armedSet', { armed: true }));
    fireEvent.click(screen.getByText('Advanced settings'));
    expect((screen.getByRole('spinbutton', { name: 'Timing correction · ms' }) as HTMLInputElement).value).toBe('22');
  });

  it('starts capture and assistance in one click without requiring Start preview first', async () => {
    const command = vi.fn().mockResolvedValue(null);
    const state = fixture({
      assistance: { key: 'current-setup', accepted: true, successfulTrials: 3, currentResults: [] },
      status: { session: { running: false, canArm: false }, controllerConnection: { connected: true, inputConnected: true }, output: { armed: false } }
    });
    render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    const startButton = screen.getByRole('button', { name: 'Start assistance' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(false);
    fireEvent.click(startButton);
    await waitFor(() => expect(command).toHaveBeenCalledWith('start', { loadModel: true, armed: true }));
    expect(command.mock.calls.map(([a]) => a)).toEqual(['start']);
  });

  it('shows plain-English explanations on hover for advanced timing and detection settings', () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture();
    render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByText('Advanced settings'));
    const infoButton = screen.getByRole('button', { name: 'About Timing correction · ms' });
    fireEvent.mouseEnter(infoButton);
    expect(screen.getByRole('tooltip').textContent).toContain('Negative values');
    fireEvent.mouseLeave(infoButton);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('displays live tempo correction and groups OCR shot feedback log by distance', () => {
    const command = vi.fn().mockResolvedValue(null), state = fixture({
      settings: { correctionMs: -10, tempoCorrectionMs: 4, shootButton: 'x', pluginAssistance: { enabled: true }, trainingCapture: {} },
      status: {
        ...fixture().status,
        ocrFeedback: { message: 'OCR fast late: timing -10 → -12.5 ms; tempo 0 → +4 ms.', distance: '24 ft', coverage: 'Open', rawText: 'RHYTHM | 24 FT | OPEN | FAST | LATE' },
        ocrHistory: [
          { distance: '24 ft', timing: 'excellent', tempo: 'excellent' },
          { distance: '24 ft', timing: 'late', tempo: 'fast' }
        ],
        ocrHistoryPath: 'C:/data/ShotFeedbackHistory.jsonl'
      }
    });
    render(<Workspace mode="live" state={state} status={state.status} command={command} />);
    expect(screen.getByText(/\[24 ft · Open\]/).textContent).toContain('24 ft · Open');
    fireEvent.click(screen.getByText('Shot feedback log (2)'));
    expect(screen.getByText(/24 ft: 2 shots · 1 excellent · 0 early · 1 late · 1 fast · 0 slow/)).toBeTruthy();
    fireEvent.click(screen.getByText('Advanced settings'));
    expect((screen.getByRole('spinbutton', { name: 'Tempo correction · ms' }) as HTMLInputElement).value).toBe('4');
  });
});
