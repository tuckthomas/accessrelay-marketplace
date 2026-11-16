import type { GameUiHost } from '@accessrelay/plugin-ui';
export type { PageProps, VisionWorkspaceProps } from '@accessrelay/plugin-ui';

// Values come from Studio's single React instance and shared component library.
// No copy of React or of Studio's controls is bundled with the plugin.
export let React: GameUiHost['React'];
export let useState: GameUiHost['React']['useState'];
export let useEffect: GameUiHost['React']['useEffect'];
export let useRef: GameUiHost['React']['useRef'];
export let GameplayPreview: GameUiHost['GameplayPreview'];
export let ControllerTrainer: GameUiHost['ControllerTrainer'];
export let ProfilePicker: GameUiHost['ui']['ProfilePicker'];
export let Select: GameUiHost['ui']['Select'];
export let SelectOption: GameUiHost['ui']['SelectOption'];
export let Input: GameUiHost['ui']['Input'];
export let Slider: GameUiHost['ui']['Slider'];
export let Checkbox: GameUiHost['ui']['Checkbox'];
export let Badge: GameUiHost['ui']['Badge'];
export let Button: GameUiHost['ui']['Button'];
export let Card: GameUiHost['ui']['Card'];
export let DiscardDialog: GameUiHost['ui']['DiscardDialog'];
export let EmptyState: GameUiHost['ui']['EmptyState'];
export let Field: GameUiHost['ui']['Field'];
export let Icon: GameUiHost['ui']['Icon'];
export let Modal: GameUiHost['ui']['Modal'];
export let Notice: GameUiHost['ui']['Notice'];
export let Tabs: GameUiHost['ui']['Tabs'];
export let Toggle: GameUiHost['ui']['Toggle'];
export let hasUnsavedChanges: GameUiHost['ui']['hasUnsavedChanges'];
export let useUnsavedChanges: GameUiHost['ui']['useUnsavedChanges'];
export let humanize: GameUiHost['ui']['humanize'];
export function bindHost(host: GameUiHost) {
  if (host.apiVersion !== 1) throw new Error('This plugin requires Studio UI API 1.');
  React = host.React; ({ useState, useEffect, useRef } = host.React);
  GameplayPreview = host.GameplayPreview;
  ControllerTrainer = host.ControllerTrainer;
  ({ ProfilePicker, Select, SelectOption, Input, Slider, Checkbox, Badge, Button, Card,
    DiscardDialog, EmptyState, Field, Icon, Modal, Notice, Tabs, Toggle, hasUnsavedChanges,
    useUnsavedChanges, humanize } = host.ui);
}
