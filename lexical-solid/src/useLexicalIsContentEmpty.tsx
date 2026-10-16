import type { LexicalEditor } from "lexical";

import { $isRootTextContentEmptyCurry } from "@lexical/text";
import { Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { MaybeAccessor, resolve } from "./utils";

/**
 * Tracks whether the editor's text content is empty, updating as the editor
 * changes. Pass `trim` to ignore leading and trailing whitespace when deciding
 * emptiness.
 *
 * @returns An accessor that is `true` while the editor's text content is empty.
 */
export function useLexicalIsTextContentEmpty(
  editor: LexicalEditor,
  trim?: MaybeAccessor<boolean>
): Accessor<boolean> {
  const [isEmpty, setIsEmpty] = createSignal(
    editor.read(
      "latest",
      $isRootTextContentEmptyCurry(editor.isComposing(), resolve(trim))
    )
  );

  createEffect(() => {
    const currentTrim = resolve(trim);
    // The state was seeded once, so re-derive it whenever `trim` changes --
    // otherwise it keeps reporting the previous answer until the next update.
    setIsEmpty(
      editor.read(
        "latest",
        $isRootTextContentEmptyCurry(editor.isComposing(), currentTrim)
      )
    );
    const cleanup = editor.registerUpdateListener(({ editorState }) => {
      const isComposing = editor.isComposing();
      const currentIsEmpty = editorState.read(
        $isRootTextContentEmptyCurry(isComposing, currentTrim)
      );
      setIsEmpty(currentIsEmpty);
    });
    onCleanup(cleanup);
  });
  return isEmpty;
}
