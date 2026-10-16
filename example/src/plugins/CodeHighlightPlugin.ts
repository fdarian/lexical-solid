import { useLexicalComposerContext } from "lexical-solid/LexicalComposerContext";
import { onCleanup, onMount } from "solid-js";
import { registerCodeHighlighting } from "@lexical/code-prism";

export default function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();
  onMount(() => {
    onCleanup(registerCodeHighlighting(editor));
  });
  return null;
}
