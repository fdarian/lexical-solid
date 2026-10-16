import { JSX } from "solid-js";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import { useHistory } from "./shared/useHistory";
import type { HistoryState, HistoryStateEntry } from "@lexical/history";

/**
 * Adds undo/redo support to the editor by tracking changes in a
 * {@link HistoryState}. Pass `delay` to control how long (in milliseconds)
 * consecutive changes are merged into a single history entry, or
 * `externalHistoryState` to share a history stack across editors.
 */
function HistoryPlugin(props: {
  delay?: number;
  externalHistoryState?: HistoryState;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  useHistory(
    editor,
    () => props.externalHistoryState,
    () => props.delay
  );
  return null;
}

export { createEmptyHistoryState } from "@lexical/history";
export { HistoryPlugin };
export type { HistoryStateEntry, HistoryState };
