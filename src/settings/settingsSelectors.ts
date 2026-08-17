import type { Settings } from './settingsTypes';

export const selectGeneral = (state: Settings) => state.general;
export const selectEditor = (state: Settings) => state.editor;
export const selectCode = (state: Settings) => state.code;
export const selectTerminal = (state: Settings) => state.terminal;
export const selectAi = (state: Settings) => state.ai;
export const selectPrivacy = (state: Settings) => state.privacy;
export const selectPerformance = (state: Settings) => state.performance;
export const selectKeyboard = (state: Settings) => state.keyboard;
export const selectAdvanced = (state: Settings) => state.advanced;

export const selectEditorFontFamily = (state: Settings) => state.editor.fontFamily;
export const selectUiDensity = (state: Settings) => state.general.uiDensity;
export const selectAutoSave = (state: Settings) => state.editor.autoSave;
export const selectAutoSaveDelay = (state: Settings) => state.editor.autoSaveDelay;
export const selectFormatOnSave = (state: Settings) => state.code.formatOnSave;
export const selectInlineSuggestions = (state: Settings) => state.ai.inlineSuggestions;