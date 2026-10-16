import {
  HistoryState,
  createEmptyHistoryState,
  registerHistory,
} from "@lexical/history";
import { LexicalEditor } from "lexical";
import { createEffect, createMemo, Accessor, onCleanup } from "solid-js";

export function useHistory(
  editor: LexicalEditor,
  externalHistoryState: Accessor<HistoryState | undefined>,
  delay: Accessor<number | undefined> | undefined
) {
  const historyState = createMemo(
    () => externalHistoryState() || createEmptyHistoryState()
  );

  createEffect(() => {
    onCleanup(
      registerHistory(editor, historyState(), (delay && delay()) ?? 1000)
    );
  });
}
