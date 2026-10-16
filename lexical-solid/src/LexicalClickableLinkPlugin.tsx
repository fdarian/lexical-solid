import { namedSignals } from "@lexical/extension";
import { registerClickableLink } from "@lexical/link";
import { createEffect, mergeProps, onCleanup, onMount } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";

export function LexicalClickableLinkPlugin(props: {
  newTab?: boolean;
  disabled?: boolean;
}): null {
  const [editor] = useLexicalComposerContext();
  const merged = mergeProps({ newTab: true, disabled: false }, props);
  const stores = namedSignals({
    disabled: merged.disabled,
    newTab: merged.newTab,
  });

  onMount(() => {
    onCleanup(registerClickableLink(editor, stores));
  });
  createEffect(() => {
    stores.disabled.value = merged.disabled;
    stores.newTab.value = merged.newTab;
  });

  return null;
}
