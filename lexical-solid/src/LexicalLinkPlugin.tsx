import { namedSignals } from "@lexical/extension";
import { type LinkAttributes, LinkNode, registerLink } from "@lexical/link";
import { createEffect, onCleanup, onMount } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";

type Props = {
  validateUrl?: (url: string) => boolean;
  attributes?: LinkAttributes;
};

export function LinkPlugin(props: Props): null {
  const [editor] = useLexicalComposerContext();
  const stores = namedSignals({
    attributes: props.attributes,
    validateUrl: props.validateUrl,
  });

  onMount(() => {
    if (!editor.hasNodes([LinkNode])) {
      throw new Error("LinkPlugin: LinkNode not registered on editor");
    }
    onCleanup(registerLink(editor, stores));
  });
  createEffect(() => {
    stores.attributes.value = props.attributes;
    stores.validateUrl.value = props.validateUrl;
  });

  return null;
}
