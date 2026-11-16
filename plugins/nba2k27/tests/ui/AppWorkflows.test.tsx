vi.mock('@studio/game-plugins/registry', async importOriginal => {
  const actual = await importOriginal<typeof import('@studio/game-plugins/registry')>();
  const { createPlugin } = await import('../../dist/ui/index.js');
  const initial = { nba2k27: createPlugin(actual.gameUiHost) };
  return { ...actual, GamePluginProvider: ({ children }: any) => <actual.GamePluginProvider initial={initial}>{children}</actual.GamePluginProvider> };
});
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ listeners: new Set<(message: any) => void>(), command: vi.fn() }));
vi.mock('@studio/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@studio/api')>();
  return { ...actual, isDesignPreview: true, desktop: { command: harness.command, subscribe: (listener: any) => {
    harness.listeners.add(listener); return () => harness.listeners.delete(listener);
  } } };
});
import { App } from '@studio/App';
import { previewState } from '@studio/api';
let state: any;
beforeEach(() => {
  state = structuredClone(previewState);
  state.vision.plugins = [{ id: 'nba2k27', name: 'NBA 2K27' }];
  harness.listeners.clear(); harness.command.mockReset();
  harness.command.mockImplementation(async (method: string) => method === 'app.bootstrap' ? structuredClone(state) : null);
});
afterEach(cleanup);
describe('NBA workspace integration', () => {
  it('opens the dedicated NBA 2K27 page and Model Training from Add-Ons with the cover card', async () => {
    state.marketplace = {
      loaded: true,
      entries: [{
        id: 'nba2k27', name: 'NBA 2K27', description: 'Unified NBA 2K27 add-on', author: 'AccessRelay',
        version: '2.1.0', kind: 'training-plugin', gameId: 'nba2k27', license: '0BSD', tags: ['nba2k27'], installed: true,
        coverUrl: 'https://media.accessrelay.test/marketplace/cover/nba-cover', trainingPluginId: 'nba2k27'
      }]
    };
    harness.command.mockImplementation(async (method: string, args: any) => {
      if (method === 'app.bootstrap') return structuredClone(state);
      if (method === 'vision.pluginSelect') {
        state.vision.selectedPluginId = args.id;
        act(() => { harness.listeners.forEach(listener => listener({ type: 'snapshot', state: structuredClone(state) })); });
      }
      return null;
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Your workspace', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add-Ons', exact: true }));
    expect(screen.getByRole('img', { name: 'NBA 2K27 cover art' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open NBA 2K27', exact: true }));
    await screen.findByRole('heading', { name: 'NBA 2K27', exact: true });
    expect(harness.command).toHaveBeenCalledWith('vision.pluginSelect', { id: 'nba2k27' });
    await waitFor(() => expect(harness.command).toHaveBeenCalledWith('app.page', { page: 'gameAddon', visible: true }));
    expect(screen.getByRole('heading', { name: 'Profile presets' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to Add-Ons' })).toBeTruthy();

    fireEvent.click(within(screen.getByRole('complementary', { name: 'Main navigation' })).getByRole('button', { name: 'Model Training', exact: true }));
    await screen.findByRole('heading', { name: /^(AI )?Model Training$/, exact: true });
    expect(screen.getByRole('button', { name: 'Record training clip' })).toBeTruthy();
    expect(harness.command.mock.calls.some(([method]) => ['vision.start', 'vision.recordStart', 'controller.outputStart'].includes(method))).toBe(false);
  });

  it('keeps Live Gameplay free of game plugins and guards drafts on the dedicated Game Add-On page', async () => {
    state.marketplace = {
      loaded: true,
      entries: [{
        id: 'nba2k27', name: 'NBA 2K27', description: 'Unified NBA 2K27 add-on', author: 'AccessRelay',
        version: '2.1.0', kind: 'training-plugin', gameId: 'nba2k27', license: '0BSD', tags: ['nba2k27'], installed: true,
        coverUrl: 'https://media.accessrelay.test/marketplace/cover/nba-cover', trainingPluginId: 'nba2k27'
      }]
    };
    state.vision.selectedPluginId = 'nba2k27';
    state.vision.settings.pluginAssistance = { enabled: false };

    render(<App />);
    await screen.findByRole('heading', { name: 'Your workspace', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Live Gameplay', exact: true }));
    expect(screen.queryByRole('combobox', { name: 'Game plugin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record training clip' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Profile presets' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add-Ons', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Open NBA 2K27', exact: true }));
    await screen.findByRole('heading', { name: 'NBA 2K27', exact: true });
    expect(screen.getByRole('button', { name: 'Detach', exact: true })).toBeTruthy();

    fireEvent.click(screen.getByText('Analysis settings & measured calibration'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Estimated stream delay (ms)' }), { target: { value: '137' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to Add-Ons' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('spinbutton', { name: 'Estimated stream delay (ms)' }) as HTMLInputElement).value).toBe('137');

    fireEvent.click(within(screen.getByRole('complementary', { name: 'Main navigation' })).getByRole('button', { name: 'Model Training', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('button', { name: 'Record training clip' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Live analysis' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Offline training jobs' })).toBeTruthy();
    await waitFor(() => expect(harness.command).toHaveBeenCalledWith('app.page', { page: 'training', visible: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
    expect(screen.queryByRole('button', { name: 'Register dataset folder' })).toBeNull();
    expect(harness.command.mock.calls.some(([method]) => ['vision.start', 'vision.stop', 'vision.recordStart'].includes(method))).toBe(false);
  });
});
