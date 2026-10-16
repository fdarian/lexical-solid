import { ListItemNode, registerListStrictIndentTransform } from "@lexical/list";
import { ListNode } from "@lexical/list";
import { createEffect, mergeProps, onCleanup } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";

import { useList } from "./shared/useList";

export interface ListPluginProps {
  /**
   * When `true`, enforces strict indentation rules for list items, ensuring consistent structure.
   * When `false` (default), indentation is more flexible.
   */
  hasStrictIndent?: boolean;
  /**
   * When `true`, splitting a numbered list will preserve the numbering continuity.
   * When `false` (default), the new split list resets to 1.
   */
  shouldPreserveNumbering?: boolean;
}

export function ListPlugin(props: ListPluginProps): null {
  const mergedProps = mergeProps(
    { hasStrictIndent: false, shouldPreserveNumbering: false },
    props
  );
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    if (!editor.hasNodes([ListNode, ListItemNode])) {
      throw new Error(
        "ListPlugin: ListNode and/or ListItemNode not registered on editor"
      );
    }
  });

  createEffect(() => {
    if (!mergedProps.hasStrictIndent) {
      return;
    }
    onCleanup(registerListStrictIndentTransform(editor));
  });

  // Upstream calls registerList in the plugin and again (default options) in useList.
  // Passing the options through useList registers it exactly once.
  useList(editor, () => ({
    restoreNumbering: mergedProps.shouldPreserveNumbering,
  }));

  return null;
}
