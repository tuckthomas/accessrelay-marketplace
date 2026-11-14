import { selectValue } from '@studio/select-test-helper';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VisionPage } from './TestHost';
afterEach(cleanup);
const state={plugins:[{id:'nba2k27',name:'NBA 2K27'}],selectedPluginId:'',profiles:[],settings:{},sources:[],status:{}};
it('shows NBA configuration only after the host selects the NBA plugin', async () => {
  const command = vi.fn().mockResolvedValue(null);
  const view = render(<VisionPage state={state} status={{}} command={command} />);
  selectValue(screen.getByRole('combobox', { name: 'Game plugin' }), 'nba2k27');
  await waitFor(() => expect(command).toHaveBeenCalledWith('pluginSelect', { id: 'nba2k27' }));
  expect(screen.queryByRole('combobox', { name: 'Shot profile' })).toBeNull();
  view.rerender(<VisionPage state={{ ...state, selectedPluginId: 'nba2k27' }} status={{}} command={command} />);
  expect(screen.getByRole('combobox', { name: 'Shot profile' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Record training clip' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Live analysis' })).toBeTruthy();
  expect(screen.queryByText('Ready when you are')).toBeNull();
});

it('keeps training and assistance on separate plugin surfaces', () => {
  const command = vi.fn().mockResolvedValue(null);
  const view = render(<VisionPage state={{ ...state, selectedPluginId: 'nba2k27' }} status={{}} command={command} mode="training" />);
  expect(screen.getByRole('heading', { name: 'Model Training' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Record training clip' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Live analysis' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Detach' })).toBeNull();
  view.rerender(<VisionPage state={{ ...state, selectedPluginId: 'nba2k27' }} status={{}} command={command} mode="live" />);
  expect(screen.getByRole('heading', { name: 'Live Gameplay' })).toBeTruthy();
  expect(screen.queryByRole('tab', { name: 'Record clips' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Live analysis' })).toBeTruthy();
  expect(command).not.toHaveBeenCalled();
});
