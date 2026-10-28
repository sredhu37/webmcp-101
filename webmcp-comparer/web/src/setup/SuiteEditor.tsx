import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { monaco, THEME } from './monaco.ts';
import type { SuiteError } from './suite.ts';

export interface SuiteEditorHandle {
  /** Moves the cursor to a Suite error and focuses the editor. */
  reveal(line: number, column: number): void;
}

export interface SuiteEditorProps {
  value: string;
  /**
   * Changes when the Suite is replaced from outside (upload, Open). Only then is `value` pushed
   * into the editor: echoing every keystroke back would overwrite text typed in between.
   */
  revision: number;
  onChange: (value: string) => void;
  errors: readonly SuiteError[];
  readOnly: boolean;
  label: string;
  ref?: Ref<SuiteEditorHandle>;
}

type Editor = Parameters<OnMount>[0];

const MARKER_OWNER = 'suite';

export default function SuiteEditor({
  value,
  revision,
  onChange,
  errors,
  readOnly,
  label,
  ref,
}: SuiteEditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const [mounted, setMounted] = useState(false);
  const appliedRevision = useRef(revision);

  useImperativeHandle(ref, () => ({
    reveal(line, column) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.revealLineInCenterIfOutsideViewport(line);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
    },
  }));

  useEffect(() => {
    const editor = editorRef.current;
    if (!mounted || !editor || appliedRevision.current === revision) return;
    appliedRevision.current = revision;
    const model = editor.getModel();
    if (!model || model.getValue() === value) return;
    // An edit rather than setValue, so Undo brings the previous Suite back.
    editor.executeEdits('replace-suite', [{ range: model.getFullModelRange(), text: value }]);
    editor.pushUndoStop();
    editor.setPosition({ lineNumber: 1, column: 1 });
    editor.revealLine(1);
  }, [mounted, revision, value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!mounted || !model) return;
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      errors.map((error) => ({
        severity: monaco.MarkerSeverity.Error,
        message: error.message.replaceAll('`', ''),
        startLineNumber: error.line,
        startColumn: error.column,
        endLineNumber: error.endLine,
        // A zero-width range would hide the squiggle; mark at least one character.
        endColumn:
          error.endLine === error.line && error.endColumn <= error.column
            ? error.column + 1
            : error.endColumn,
      })),
    );
  }, [errors, mounted]);

  return (
    <Editor
      language="yaml"
      theme={THEME}
      defaultValue={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={(editor) => {
        editorRef.current = editor;
        setMounted(true);
      }}
      loading={null}
      options={{
        ariaLabel: label,
        readOnly,
        readOnlyMessage: { value: 'Setup is locked while the Run is going.' },
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: 13,
        lineHeight: 21,
        tabSize: 2,
        insertSpaces: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        overviewRulerLanes: 1,
        hideCursorInOverviewRuler: true,
        padding: { top: 12, bottom: 12 },
        lineNumbersMinChars: 3,
        folding: false,
        wordWrap: 'on',
        wrappingIndent: 'indent',
        automaticLayout: true,
        fixedOverflowWidgets: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
        guides: { indentation: true },
        contextmenu: true,
        smoothScrolling: false,
        cursorSmoothCaretAnimation: 'off',
      }}
    />
  );
}
