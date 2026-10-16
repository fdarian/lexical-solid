import { useLexicalComposerContext } from "./LexicalComposerContext";
import { LexicalEditor } from "lexical";

/**
 *
 * Use this plugin to access the editor instance outside of the
 * LexicalComposer. This can help with things like buttons or other
 * UI components that need to update or read EditorState but need to
 * be positioned outside the LexicalComposer in the React tree.
 */
export function EditorRefPlugin(props: {
  editorRef:
    | ((editor: LexicalEditor) => void)
    | { current: LexicalEditor | null | undefined };
}): null {
  const [editor] = useLexicalComposerContext();
  if (typeof props.editorRef === "function") {
    props.editorRef(editor);
  } else {
    props.editorRef.current = editor;
  }
  return null;
}
