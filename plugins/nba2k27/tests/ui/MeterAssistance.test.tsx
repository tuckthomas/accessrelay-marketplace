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
    await selectValue(screen.getByRole('combobox', { name: 'Shot tempo' }), 'slightlyFast');
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('signalFeedback', {
      receiptId: 7, runId: 'native-run', feedback: { timing: 'excellent', tempo: 'slightlyFast' }
    }));
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
});
