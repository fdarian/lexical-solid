import {
  $findMatchingParent,
  $getNearestNodeFromDOMNode,
  registerEventListener,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";

import { useLexicalComposerContext } from "./LexicalComposerContext";
import { createEffect, onCleanup, untrack } from "solid-js";

const capturedEvents = new Set<string>(["mouseenter", "mouseleave"]);

export function NodeEventPlugin(props: {
  nodeType: Klass<LexicalNode>;
  eventType: string;
  eventListener: (
    event: Event,
    editor: LexicalEditor,
    nodeKey: NodeKey
  ) => void;
}): null {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    const eventType = untrack(() => props.eventType);
    const isCaptured = capturedEvents.has(eventType);

    const onEvent = (event: Event) => {
      editor.update(() => {
        const nearestNode = $getNearestNodeFromDOMNode(event.target as Element);
        if (nearestNode !== null) {
          const targetNode = isCaptured
            ? nearestNode instanceof props.nodeType
              ? nearestNode
              : null
            : $findMatchingParent(
                nearestNode,
                (node) => node instanceof props.nodeType
              );
          if (targetNode !== null) {
            props.eventListener(event, editor, targetNode.getKey());
            return;
          }
        }
      });
    };

    onCleanup(
      editor.registerRootListener((rootElement) => {
        if (rootElement) {
          return registerEventListener(
            rootElement,
            eventType,
            onEvent,
            isCaptured
          );
        }
      })
    );
  });

  return null;
}
