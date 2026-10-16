import {
  LexicalComposerContextType,
  createLexicalComposerContext,
  LexicalComposerContext,
} from "./LexicalComposerContext";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  CAN_USE_DOM,
  createEditor,
  EditorState,
  EditorThemeClasses,
  getActiveElement,
  HISTORY_MERGE_TAG,
  Klass,
  LexicalEditor,
  LexicalNode,
  LexicalNodeReplacement,
  HTMLConfig,
} from "lexical";
import { JSX, ParentProps, onMount } from "solid-js";

const HISTORY_MERGE_OPTIONS = { tag: HISTORY_MERGE_TAG };

export type InitialEditorStateType =
  | null
  | string
  | EditorState
  | ((editor: LexicalEditor) => void);

export type InitialConfigType = Readonly<{
  namespace: string;
  nodes?: ReadonlyArray<Klass<LexicalNode> | LexicalNodeReplacement>;
  onError: (error: Error, editor: LexicalEditor) => void;
  /**
   * Optional handler for recoverable, warn-level conditions (e.g. the
   * update-recursion guard tripping) that the editor has already recovered
   * from. Mirrors `onError` but at warn severity. Defaults (in core
   * `createEditor`) to a handler that throws in development and only
   * `console.warn`s in production.
   */
  onWarn?: (error: Error, editor: LexicalEditor) => void;
  editable?: boolean;
  theme?: EditorThemeClasses;
  editorState?: InitialEditorStateType;
  html?: HTMLConfig,
}>;

type Props = ParentProps<{
  initialConfig: InitialConfigType;
}>;

export function LexicalComposer(props: Props): JSX.Element {
  const config = props.initialConfig;
  const onError = config.onError;
  const onWarn = config.onWarn;

  const context: LexicalComposerContextType = createLexicalComposerContext(
    null,
    config.theme
  );

  const editor = createEditor({
    editable: config.editable,
    html: config.html,
    namespace: config.namespace,
    nodes: config.nodes,
    onError: (error) => onError(error, editor),
    ...(onWarn ? { onWarn: (error) => onWarn(error, editor) } : {}),
    theme: config.theme,
  });
  initializeEditor(editor, config.editorState);

  onMount(() => {
    const isEditable = props.initialConfig.editable;
    editor.setEditable(isEditable !== undefined ? isEditable : true);
  });

  return (
    <LexicalComposerContext.Provider value={[editor, context]}>
      {props.children}
    </LexicalComposerContext.Provider>
  );
}

function initializeEditor(
  editor: LexicalEditor,
  initialEditorState?: InitialEditorStateType
): void {
  if (initialEditorState === null) {
    return;
  } else if (initialEditorState === undefined) {
    editor.update(() => {
      const root = $getRoot();
      if (root.isEmpty()) {
        const paragraph = $createParagraphNode();
        root.append(paragraph);
        const rootElement = editor.getRootElement();
        // getActiveElement rather than document.activeElement, which reports
        // the shadow host when the editor is in a shadow root.
        const activeElement =
          CAN_USE_DOM && rootElement !== null
            ? getActiveElement(rootElement)
            : null;
        if (
          $getSelection() !== null ||
          (activeElement !== null && activeElement === rootElement)
        ) {
          paragraph.select();
        }
      }
    }, HISTORY_MERGE_OPTIONS);
  } else if (initialEditorState !== null) {
    switch (typeof initialEditorState) {
      case "string": {
        const parsedEditorState = editor.parseEditorState(initialEditorState);
        editor.setEditorState(parsedEditorState, HISTORY_MERGE_OPTIONS);
        break;
      }
      case "object": {
        editor.setEditorState(initialEditorState, HISTORY_MERGE_OPTIONS);
        break;
      }
      case "function": {
        editor.update(() => {
          const root = $getRoot();
          if (root.isEmpty()) {
            initialEditorState(editor);
          }
        }, HISTORY_MERGE_OPTIONS);
        break;
      }
    }
  }
}
