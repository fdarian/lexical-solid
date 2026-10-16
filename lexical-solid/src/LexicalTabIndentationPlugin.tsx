import {
  type CanIndentPredicate,
  registerTabIndentation,
} from "@lexical/extension";
import { createEffect, onCleanup } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";

export { registerTabIndentation };

/**
 * This plugin adds the ability to indent content using the tab key. Generally, we don't
 * recommend using this plugin as it could negatively affect accessibility for keyboard
 * users, causing focus to become trapped within the editor.
 */
export function TabIndentationPlugin(props: {
  maxIdent?: number;
  /**
   * By default, indents are set on all elements for which the {@link ElementNode.canIndent} returns true.
   * This option allows you to set indents for specific nodes without overriding the method for others.
   */
  $canIndent?: CanIndentPredicate;
}): null {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    onCleanup(
      registerTabIndentation(editor, props.maxIdent, props.$canIndent)
    );
  });

  return null;
}
