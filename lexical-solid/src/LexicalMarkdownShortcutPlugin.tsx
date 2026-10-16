import type { LexicalNode } from "lexical";

import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from "@lexical/extension";
import {
  type ElementTransformer,
  registerMarkdownShortcuts,
  type Transformer,
  TRANSFORMERS,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import { createEffect, mergeProps, onCleanup } from "solid-js";

const HR: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node: LexicalNode) => {
    return $isHorizontalRuleNode(node) ? "***" : null;
  },
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _1, _2, isImport) => {
    const line = $createHorizontalRuleNode();

    // TODO: Get rid of isImport flag
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(line);
    } else {
      parentNode.insertBefore(line);
    }

    line.selectNext();
  },
  triggerOnEnter: true,
  type: "element",
};

/**
 * A function declared side-effect free (so the build annotates the call)
 * rather than an array spread at module scope, which is a side effect to
 * bundlers and would pin every transformer into every bundle that imports
 * this module.
 *
 * @__NO_SIDE_EFFECTS__
 */
function defaultTransformers(): Transformer[] {
  return [HR, ...TRANSFORMERS];
}

/**
 * The default set of Markdown {@link Transformer}s used by
 * {@link LexicalMarkdownShortcutPlugin}: the core `@lexical/markdown`
 * `TRANSFORMERS` plus a transformer that turns `---`, `***`, or `___` into a
 * horizontal rule.
 */
export const DEFAULT_TRANSFORMERS: Transformer[] = defaultTransformers();

/**
 * Registers Markdown shortcuts so that typing Markdown syntax (for example
 * `# ` for a heading or `- ` for a list item) is automatically converted into
 * the corresponding nodes as you type. Pass `transformers` to customize which
 * shortcuts are active; it defaults to {@link DEFAULT_TRANSFORMERS}.
 */
export function LexicalMarkdownShortcutPlugin(
  props: Readonly<{ transformers?: Transformer[] }>
): null {
  props = mergeProps({ transformers: DEFAULT_TRANSFORMERS }, props);
  const [editor] = useLexicalComposerContext();
  createEffect(() => {
    const cleanup = registerMarkdownShortcuts(editor, props.transformers);
    onCleanup(cleanup);
  });
  return null;
}
