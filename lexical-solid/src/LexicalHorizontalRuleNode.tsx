import {
  $isHorizontalRuleNode,
  HorizontalRuleNode as BaseHorizontalRuleNode,
  INSERT_HORIZONTAL_RULE_COMMAND,
  type SerializedHorizontalRuleNode,
} from "@lexical/extension";
import {
  $applyNodeReplacement,
  addClassNamesToElement,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  type DOMConversionOutput,
  getComposedEventTarget,
  mergeRegister,
  type NodeKey,
  removeClassNamesFromElement,
} from "lexical";
import { createEffect, JSX, onCleanup } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import { useLexicalNodeSelection } from "./useLexicalNodeSelection";

export {
  $isHorizontalRuleNode,
  INSERT_HORIZONTAL_RULE_COMMAND,
  type SerializedHorizontalRuleNode,
};

function HorizontalRuleComponent(props: { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(
    props.nodeKey
  );

  createEffect(() => {
    onCleanup(
      mergeRegister(
        editor.registerCommand(
          CLICK_COMMAND,
          (event: MouseEvent) => {
            const hrElem = editor.getElementByKey(props.nodeKey);

            if (getComposedEventTarget(event) === hrElem) {
              if (!event.shiftKey) {
                clearSelection();
              }
              setSelected(!isSelected());
              return true;
            }

            return false;
          },
          COMMAND_PRIORITY_LOW
        )
      )
    );
  });

  createEffect(() => {
    const hrElem = editor.getElementByKey(props.nodeKey);
    const isSelectedClassName = editor._config.theme.hrSelected ?? "selected";
    if (hrElem !== null) {
      if (isSelected()) {
        addClassNamesToElement(hrElem, isSelectedClassName);
      } else {
        removeClassNamesFromElement(hrElem, isSelectedClassName);
      }
    }
  });

  return null;
}

/**
 * @deprecated A pure Lexical implementation is available in `@lexical/extension` as HorizontalRuleExtension
 */
export class HorizontalRuleNode extends BaseHorizontalRuleNode {
  $config() {
    // Named rather than left to the runtime default, for the reason the base
    // node names its own: it is what carries this config on the record the
    // composed serialization types walk. The shape still matches the base
    // node's, whose 'horizontalrule' type this deprecated subclass reuses.
    return this.config("horizontalrule", {
      extends: BaseHorizontalRuleNode,
      importDOM: {
        hr: () => ({
          conversion: $convertHorizontalRuleElement,
          priority: 0,
        }),
      },
    });
  }

  decorate(): () => JSX.Element {
    const nodeKey = this.__key;
    return () => <HorizontalRuleComponent nodeKey={nodeKey} />;
  }
}

function $convertHorizontalRuleElement(): DOMConversionOutput {
  return { node: $createHorizontalRuleNode() };
}

/**
 * @deprecated A pure Lexical implementation is available in `@lexical/extension` as HorizontalRuleExtension
 */
export function $createHorizontalRuleNode(): HorizontalRuleNode {
  return $applyNodeReplacement(new HorizontalRuleNode());
}
