import { registerClearEditor } from "@lexical/extension";
import { createEffect, JSX, onCleanup } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";

type Props = Readonly<{
  onClear?: () => void;
}>;

export function ClearEditorPlugin(props: Props): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  createEffect(() => {
    onCleanup(registerClearEditor(editor, props.onClear));
  });
  return null;
}
