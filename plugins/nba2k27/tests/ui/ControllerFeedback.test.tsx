import { selectValue } from '@studio/select-test-helper';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameUiHost } from '@studio/game-plugins/registry';
import { createPlugin } from '../../dist/ui/index.js';

afterEach(cleanup);
const Tuning = createPlugin(gameUiHost).ControllerTuning!;

describe('NBA controller feedback integration', () => {
  // The current host uses Lua scripts rather than a Sequences tab. Test the
  // installed plugin's compatibility contract with real shared host controls.
  it('waits for the consumer to reload adjusted timing before reporting success', async () => {
    const id = '57e31ee3-bb31-45b7-adb5-99fb9059ade6', command = vi.fn().mockResolvedValue(null);
    let finishReload!: () => void;
    const onApplied = vi.fn(() => new Promise<void>(resolve => { finishReload = resolve; }));
    render(<Tuning id={id} command={command} onApplied={onApplied} />);
    fireEvent.click(screen.getByText('NBA 2K27 feedback tuning'));
    selectValue(screen.getByLabelText('Timing feedback'), 'slightlyEarly');
    fireEvent.click(screen.getByRole('button', { name: 'Apply feedback adjustment' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(command).toHaveBeenCalledWith('packAction', { action: 'feedback', id, variant: undefined,
      timingFeedback: 'slightlyEarly', tempoFeedback: 'none' });
    expect(screen.queryByText('Feedback adjustment applied to the saved sequence.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Apply feedback adjustment' }) as HTMLButtonElement).disabled).toBe(true);
    finishReload();
    await screen.findByText('Feedback adjustment applied to the saved sequence.');
    expect((screen.getByRole('button', { name: 'Apply feedback adjustment' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports failed feedback without refreshing the consumer or reporting success', async () => {
    const command = vi.fn().mockRejectedValue(new Error('That sequence no longer exists.')), onApplied = vi.fn();
    render(<Tuning id="missing-recording" command={command} onApplied={onApplied} />);
    fireEvent.click(screen.getByText('NBA 2K27 feedback tuning'));
    selectValue(screen.getByLabelText('Tempo feedback'), 'slightlySlow');
    fireEvent.click(screen.getByRole('button', { name: 'Apply feedback adjustment' }));
    await screen.findByText('That sequence no longer exists.');
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.queryByText('Feedback adjustment applied to the saved sequence.')).toBeNull();
  });
});
