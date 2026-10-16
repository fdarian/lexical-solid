import type { LexicalEditor, NodeKey } from "lexical";

import { useLexicalComposerContext } from "./LexicalComposerContext";
import {
  $createNodeSelection,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
} from "lexical";
import { createSignal, onCleanup, onMount } from "solid-js";

/**
 * A helper function to determine if a specific node is selected in a Lexical editor.
 *
 * @param {LexicalEditor} editor - The LexicalEditor instance.
 * @param {NodeKey} key - The key of the node to check.
 * @returns {boolean} Whether the node is selected.
 */

function isNodeSelected(editor: LexicalEditor, key: NodeKey): boolean {
  return editor.read("latest", () => {
    const node = $getNodeByKey(key);
    if (node === null) {
      return false; // Node doesn't exist, so it's not selected.
    }
    return node.isSelected(); // Check if the node is selected.
  });
}

/**
 * A custom hook to manage the selection state of a specific node in a Lexical editor.
 *
 * This hook provides utilities to:
 * - Check if a node is selected.
 * - Update its selection state.
 * - Clear the selection.
 *
 * @param {NodeKey} key - The key of the node to track selection for.
 * @returns {[boolean, (selected: boolean) => void, () => void]} A tuple containing:
 * - `isSelected` (boolean): Whether the node is currently selected.
 * - `setSelected` (function): A function to set the selection state of the node.
 *   `setSelected(false)` is a no-op when the node is not part of the current
 *   selection, so that deselecting something already unselected cannot discard
 *   the user's caret.
 * - `clearSelected` (function): A function to clear the selection of the node.
 *
 */

export function useLexicalNodeSelection(
  key: NodeKey
): [() => boolean, (selected: boolean) => void, () => void] {
  const [editor] = useLexicalComposerContext();
  // State to track whether the node is currently selected.
  const [isSelected, setIsSelected] = createSignal(isNodeSelected(editor, key));

  onMount(() => {
    let isMounted = true;
    const unregister = editor.registerUpdateListener(() => {
      if (isMounted) {
        setIsSelected(isNodeSelected(editor, key));
      }
    });

    onCleanup(() => {
      // Prevent updates after component unmount.
      isMounted = false;
      unregister();
    });
  });

  const setSelected = (selected: boolean) => {
    editor.update(() => {
      let selection = $getSelection();
      if (!$isNodeSelection(selection)) {
        const node = selected ? null : $getNodeByKey(key);
        if (node !== null && !node.isSelected()) {
          // Nothing to remove: this node is not part of the current
          // selection, and replacing it with an empty NodeSelection would
          // discard the user's caret for no benefit.
          return;
        }
        // Deselecting a node the selection *does* cover still has to take
        // effect, or a `clearSelection(); setSelected(!isSelected)` toggle
        // becomes a dead click under a RangeSelection: isSelected() is true
        // for those, so the toggle arrives here with `false`.
        selection = $createNodeSelection();
        $setSelection(selection);
      }
      if ($isNodeSelection(selection)) {
        if (selected) {
          selection.add(key);
        } else {
          selection.delete(key);
        }
      }
    });
  };

  const clearSelected = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isNodeSelection(selection)) {
        selection.clear();
      }
    });
  };

  return [isSelected, setSelected, clearSelected];
}
