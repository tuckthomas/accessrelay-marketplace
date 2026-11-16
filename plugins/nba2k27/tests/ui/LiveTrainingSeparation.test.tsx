import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GameAddonPage, VisionPage } from './TestHost';

afterEach(cleanup);
const state = { plugins: [{ id: 'nba2k27', name: 'NBA 2K27' }], selectedPluginId: 'nba2k27', profiles: [], settings: {}, sources: [], status: {} };

it('keeps NBA configuration out of Live Gameplay and hosts it on the dedicated NBA 2K27 Game Add-On page', () => {
  const command = vi.fn().mockResolvedValue(null), onBack = vi.fn();
  const view = render(<VisionPage state={state} status={{}} command={command} mode="live" />);
  expect(screen.getByRole('heading', { name: 'Live Gameplay' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Game plugin' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Shot profile' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Record training clip' })).toBeNull();

  view.unmount();
  render(<GameAddonPage state={state} status={{}} command={command} addon={{ gameId: 'nba2k27', pluginId: 'nba2k27', title: 'NBA 2K27' }} onBack={onBack} />);
  expect(screen.getByRole('heading', { name: 'NBA 2K27' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Shot profile' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Calibrate your shot' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Record training clip' })).toBeNull();
  expect(screen.queryByText('Ready when you are')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Add-Ons' }));
  expect(onBack).toHaveBeenCalledOnce();
  expect(command).not.toHaveBeenCalled();
});

it('keeps Model Training separated from live assistance', () => {
  const command = vi.fn().mockResolvedValue(null);
  render(<VisionPage state={state} status={{}} command={command} mode="training" />);
  expect(screen.getByRole('heading', { name: 'Model Training' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Record training clip' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Clips & review' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start practice trial' })).toBeNull();
  expect(screen.queryByRole('tablist', { name: 'NBA 2K27 tools' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Live analysis' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Detach' })).toBeNull();
  expect(command).not.toHaveBeenCalled();
});

it('hosts the NBA 2K27 Lua shot trainer inside the dedicated Game Add-On page', async () => {
  const visionCommand = vi.fn().mockResolvedValue(null), controllerCommand = vi.fn().mockResolvedValue(null);
  const controllerState = {
    activeProfile: { id: 'p1', name: 'Default', gamePack: null, luaScripts: [], bindings: [] },
    trainerPacks: [{
      key: 'nba2k27@2.1.0', manifestSha256: 'a'.repeat(64),
      manifest: { id: 'nba2k27', version: '2.1.0', gameId: 'nba2k27', controllerTrainer: { shots: [{ id: 'standing-still', label: 'Standing Still', instructions: 'Stand still.' }], timingFeedback: [{ id: 'none', label: 'None', adjustmentMs: 0 }], tempoFeedback: [{ id: 'none', label: 'None', adjustmentMs: 0 }] } }
    }]
  };
  render(<GameAddonPage state={state} status={{}} command={visionCommand}
    controller={{ state: controllerState, status: { connected: true }, command: controllerCommand }}
    addon={{ gameId: 'nba2k27', pluginId: 'nba2k27', title: 'NBA 2K27' }} onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Lua shot trainer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create NBA 2K27 trainer profile' }));
  expect(controllerCommand).toHaveBeenCalledWith('packCreateSetup', { key: 'nba2k27@2.1.0', values: {} });
});
