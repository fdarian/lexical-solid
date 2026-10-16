import type { EntityMatch } from "@lexical/text";
import { type Klass, mergeRegister, type TextNode } from "lexical";

import { useLexicalComposerContext } from "./LexicalComposerContext";
import { registerLexicalTextEntity } from "@lexical/text";
import { onCleanup } from "solid-js";

/**
 * Registers a text entity on the current editor: text matched by `getMatch` is
 * automatically wrapped in instances of `targetNode` (created via `createNode`)
 * and unwrapped when it no longer matches. This is the Solid wrapper around
 * `registerLexicalTextEntity` and is the basis for features such as hashtags
 * and mentions.
 */
export function useLexicalTextEntity<T extends TextNode>(
  getMatch: (text: string) => null | EntityMatch,
  targetNode: Klass<T>,
  createNode: (textNode: TextNode) => T
): void {
  const [editor] = useLexicalComposerContext();

  onCleanup(
    mergeRegister(
      ...registerLexicalTextEntity(editor, getMatch, targetNode, createNode)
    )
  );
}
