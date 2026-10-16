import { onCleanup } from "solid-js";
import { type LexicalEditor, mergeRegister } from "lexical";
import { isServer } from "solid-js/web";
import { registerRichText } from "@lexical/rich-text";
import { registerDragonSupport } from "@lexical/dragon";

export function useRichTextSetup(editor: LexicalEditor) {
  if (!isServer) {
    onCleanup(
      mergeRegister(registerRichText(editor), registerDragonSupport(editor)) // We only do this for init
    );
  }
}
