import {
  AutoLinkNode,
  type ChangeHandler,
  type LinkMatcher,
  registerAutoLink,
} from "@lexical/link";
import type { ElementNode, LexicalEditor } from "lexical";
import { createEffect, JSX, onCleanup, onMount } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";

export {
  type ChangeHandler,
  createLinkMatcherWithRegExp,
  type LinkMatcher,
} from "@lexical/link";

function useAutoLink(
  editor: LexicalEditor,
  matchers: () => LinkMatcher[],
  onChange: () => ChangeHandler | undefined,
  excludeParents: () => ((parent: ElementNode) => boolean)[] | undefined
): void {
  onMount(() => {
    if (!editor.hasNodes([AutoLinkNode])) {
      throw new Error(
        "LexicalAutoLinkPlugin: AutoLinkNode not registered on editor"
      );
    }
  });
  createEffect(() => {
    const changeHandler = onChange();
    const excluded = excludeParents();
    onCleanup(
      registerAutoLink(editor, {
        changeHandlers: changeHandler ? [changeHandler] : [],
        excludeParents: excluded ? excluded : [],
        matchers: matchers(),
      })
    );
  });
}

export function AutoLinkPlugin(props: {
  matchers: Array<LinkMatcher>;
  onChange?: ChangeHandler;
  excludeParents?: Array<(parent: ElementNode) => boolean>;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useAutoLink(
    editor,
    () => props.matchers,
    () => props.onChange,
    () => props.excludeParents
  );

  return null;
}
