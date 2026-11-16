import type { ComponentProps } from 'react';
import { VisionPage as HostVisionPage } from '@studio/pages/VisionPage';
import { GameAddonPage as HostGameAddonPage } from '@studio/pages/GameAddonPage';
import { ControllerPage as HostControllerPage } from '@studio/pages/ControllerPage';
import { GamePluginProvider, gameUiHost } from '@studio/game-plugins/registry';
// Test the same emitted module that is installed, with the real host shared controls.
import { createPlugin } from '../../dist/ui/index.js';
const initial = { nba2k27: createPlugin(gameUiHost) };
export function VisionPage(props: ComponentProps<typeof HostVisionPage>) {
  return <GamePluginProvider initial={initial}><HostVisionPage {...props} /></GamePluginProvider>;
}
export function GameAddonPage(props: ComponentProps<typeof HostGameAddonPage>) {
  return <GamePluginProvider initial={initial}><HostGameAddonPage {...props} /></GamePluginProvider>;
}
export function ControllerPage(props: ComponentProps<typeof HostControllerPage>) {
  return <GamePluginProvider initial={initial}><HostControllerPage {...props} /></GamePluginProvider>;
}
