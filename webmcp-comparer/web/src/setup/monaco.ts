/**
 * Monaco, bundled locally: the core editor API, the editor features a YAML editor needs, the
 * YAML grammar and the editor web worker through Vite. Nothing is fetched from a CDN.
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/clipboard/register';
import 'monaco-editor/features/codicon/register';
import 'monaco-editor/features/comment/register';
import 'monaco-editor/features/contextmenu/register';
import 'monaco-editor/features/cursorUndo/register';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/gotoError/register';
import 'monaco-editor/features/hover/register';
import 'monaco-editor/features/indentation/register';
import 'monaco-editor/features/linesOperations/register';
import 'monaco-editor/features/multicursor/register';
import 'monaco-editor/features/readOnlyMessage/register';
import 'monaco-editor/features/wordOperations/register';
import 'monaco-editor/languages/definitions/yaml/register';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export const THEME = 'comparer-paper';

/** The paper palette from the app's CSS tokens, for the parts Monaco draws itself. */
monaco.editor.defineTheme(THEME, {
  base: 'vs',
  inherit: true,
  // Ink keys and warm brown values; the Lane colours stay reserved for the Lanes.
  rules: [
    { token: '', foreground: '3d3a35' },
    { token: 'type.yaml', foreground: '1c1b19' },
    { token: 'string.yaml', foreground: '5b4632' },
    { token: 'number.yaml', foreground: '5b4632' },
    { token: 'keyword.yaml', foreground: '5b4632', fontStyle: 'italic' },
    { token: 'comment.yaml', foreground: '6b675f', fontStyle: 'italic' },
    { token: 'operators.yaml', foreground: '8a8579' },
    { token: 'delimiter', foreground: '8a8579' },
  ],
  colors: {
    'editor.background': '#fffefb',
    'editor.foreground': '#3d3a35',
    'editorLineNumber.foreground': '#8f8a7f',
    'editorLineNumber.activeForeground': '#1c1b19',
    'editorCursor.foreground': '#2350a8',
    'editor.selectionBackground': '#d3def3',
    'editor.inactiveSelectionBackground': '#e6ebf4',
    'editor.selectionHighlightBackground': '#e6ebf4',
    'editor.lineHighlightBackground': '#f6f5f1',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#ece9e1',
    'editorIndentGuide.activeBackground1': '#cfcbbf',
    'editorWhitespace.foreground': '#cfcbbf',
    'editorBracketMatch.background': '#e1e8f6',
    'editorBracketMatch.border': '#00000000',
    'editorError.foreground': '#b42318',
    'editorOverviewRuler.border': '#00000000',
    'editorOverviewRuler.errorForeground': '#b42318',
    'editorGutter.background': '#fffefb',
    'editorWidget.background': '#fffefb',
    'editorWidget.border': '#cfcbbf',
    'editorHoverWidget.background': '#fffefb',
    'editorHoverWidget.border': '#cfcbbf',
    'input.background': '#fffefb',
    'input.border': '#cfcbbf',
    focusBorder: '#2350a8',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#cfcbbf99',
    'scrollbarSlider.hoverBackground': '#b9b4a6cc',
    'scrollbarSlider.activeBackground': '#a7a297',
  },
});

loader.config({ monaco });

// Monaco measures glyphs once; measure again when the self-hosted mono face has loaded.
void document.fonts.load('400 13px "IBM Plex Mono"').then(() => monaco.editor.remeasureFonts());

export { monaco };
