import { useLexicalComposerContext } from "./LexicalComposerContext";
import {
  $createHorizontalRuleNode,
  INSERT_HORIZONTAL_RULE_COMMAND,
} from "./LexicalHorizontalRuleNode";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
} from "lexical";
import { onCleanup } from "solid-js";

/**
 * @deprecated A pure Lexical implementation is available in `@lexical/extension`
 * as HorizontalRuleExtension
 */
export function HorizontalRulePlugin(): null {
  const [editor] = useLexicalComposerContext();

  onCleanup(
    editor.registerCommand(
      INSERT_HORIZONTAL_RULE_COMMAND,
      (type) => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
          return false;
        }

        const focusNode = selection.focus.getNode();

        if (focusNode !== null) {
          const horizontalRuleNode = $createHorizontalRuleNode();
          $insertNodeToNearestRoot(horizontalRuleNode);
        }

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    )
  );

  return null;
}
