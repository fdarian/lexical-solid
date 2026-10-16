import { registerCheckList } from "@lexical/list";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import { createEffect, onCleanup } from "solid-js";

export function CheckListPlugin(props: {
  disableTakeFocusOnClick?: boolean;
}): null {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    onCleanup(
      registerCheckList(editor, {
        disableTakeFocusOnClick: props.disableTakeFocusOnClick,
      })
    );
  });

  return null;
}
