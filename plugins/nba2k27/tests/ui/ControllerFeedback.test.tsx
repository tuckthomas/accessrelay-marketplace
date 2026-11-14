import { selectValue } from '@studio/select-test-helper';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControllerPage } from './TestHost';
import { previewState } from '@studio/api';
afterEach(cleanup);
const setup=()=>structuredClone(previewState.controller);
describe('NBA controller feedback integration',()=>{
  it('reloads feedback-adjusted recording timing before a later edit is saved', async () => {
    const state = setup(), id = '57e31ee3-bb31-45b7-adb5-99fb9059ade6';
    state.activeProfile.gamePack = { id: 'nba2k27' };
    let recording = { id, name: 'Test sequence', channels: 'rightStick', durationMs: 120, frames: [
      { timeMs: 0, state: { buttons: 0, leftTrigger: 0, rightTrigger: 0, leftX: 0, leftY: 0, rightX: 0, rightY: -32767 } },
      { timeMs: 80, state: { buttons: 0, leftTrigger: 0, rightTrigger: 0, leftX: 0, leftY: 0, rightX: 0, rightY: 32767 } }
    ] };
    state.activeProfile.recordings = [{ id, name: recording.name, durationMs: 120, frameCount: 2 }];
    const command = vi.fn(async (action: string) => {
      if (action === 'recordGet') return structuredClone(recording);
      if (action === 'packAction') recording = { ...recording, durationMs: 136, frames: [recording.frames[0], { ...recording.frames[1], timeMs: 96 }] };
      return null;
    });
    render(<ControllerPage state={state} status={state.status} command={command} />);
    fireEvent.click(screen.getByRole('tab', { name: /Sequences/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByLabelText('Sequence name');
    fireEvent.click(screen.getByText('NBA 2K27 feedback tuning'));
    selectValue(screen.getByLabelText('Timing feedback'), 'slightlyEarly');
    fireEvent.click(screen.getByRole('button', { name: 'Apply feedback adjustment' }));
    await waitFor(() => expect(command.mock.calls.filter(([action]) => action === 'recordGet')).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Sequence name'), { target: { value: 'Renamed sequence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save sequence' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('recordUpdate', expect.objectContaining({ recording: expect.objectContaining({ durationMs: 136, name: 'Renamed sequence', frames: expect.arrayContaining([expect.objectContaining({ timeMs: 96 })]) }) })));
  });
});
