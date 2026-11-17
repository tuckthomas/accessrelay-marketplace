// Values come from Studio's single React instance and shared component library.
// No copy of React or of Studio's controls is bundled with the plugin.
export let React;
export let useState;
export let useEffect;
export let useRef;
export let GameplayPreview;
export let ControllerTrainer;
export let ProfilePicker;
export let Select;
export let SelectOption;
export let Input;
export let Slider;
export let Checkbox;
export let Badge;
export let Button;
export let Card;
export let DiscardDialog;
export let EmptyState;
export let Field;
export let Icon;
export let Modal;
export let Notice;
export let Tabs;
export let Toggle;
export let hasUnsavedChanges;
export let useUnsavedChanges;
export let humanize;
export function bindHost(host) {
    if (host.apiVersion !== 1)
        throw new Error('This plugin requires Studio UI API 1.');
    React = host.React;
    ({ useState, useEffect, useRef } = host.React);
    GameplayPreview = host.GameplayPreview;
    ControllerTrainer = host.ControllerTrainer;
    ({ ProfilePicker, Select, SelectOption, Input, Slider, Checkbox, Badge, Button, Card,
        DiscardDialog, EmptyState, Field, Icon, Modal, Notice, Tabs, Toggle, hasUnsavedChanges,
        useUnsavedChanges, humanize } = host.ui);
}
