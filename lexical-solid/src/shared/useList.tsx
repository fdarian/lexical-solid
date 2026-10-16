import type { LexicalEditor } from "lexical";

import { registerList, type RegisterListOptions } from "@lexical/list";
import { createEffect, onCleanup } from "solid-js";

export function useList(
  editor: LexicalEditor,
  options?: () => RegisterListOptions
): void {
  createEffect(() => {
    onCleanup(registerList(editor, options?.()));
  });
}
