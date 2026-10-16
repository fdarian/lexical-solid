import { HashtagNode, registerLexicalHashtag } from "@lexical/hashtag";
import { JSX, onCleanup, onMount } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";

export function HashtagPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  onMount(() => {
    if (!editor.hasNodes([HashtagNode])) {
      throw new Error("HashtagPlugin: HashtagNode not registered on editor");
    }
    onCleanup(registerLexicalHashtag(editor));
  });

  return null;
}
