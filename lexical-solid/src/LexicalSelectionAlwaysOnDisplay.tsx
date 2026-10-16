import { createEffect, onCleanup } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import { selectionAlwaysOnDisplay } from "@lexical/utils";

type Props = Readonly<{
  onReposition?: (node: readonly HTMLElement[]) => void;
}>;

export function SelectionAlwaysOnDisplay(props: Props): null {
  const [editor] = useLexicalComposerContext();
  createEffect(() => {
    onCleanup(selectionAlwaysOnDisplay(editor, props.onReposition));
  });

  return null;
}
