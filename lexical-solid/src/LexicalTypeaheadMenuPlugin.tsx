import { useLexicalComposerContext } from "./LexicalComposerContext";
import {
  MenuRenderFn,
  MenuResolution,
  MenuTextMatch,
  TriggerFn,
  useMenuAnchorRef,
  LexicalMenu,
  MenuOption,
  SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND,
} from "./shared/LexicalMenu";
import { getScrollParent as getScrollParent_ } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  CommandListenerPriority,
  getDOMSelection,
  getDOMSelectionPoints,
  LexicalEditor,
  RangeSelection,
  TextNode,
} from "lexical";
import {
  createEffect,
  on,
  createSignal,
  Show,
  JSX,
  startTransition,
  onCleanup,
  onMount,
} from "solid-js";

export type QueryMatch = {
  leadOffset: number;
  matchingString: string;
  replaceableString: string;
};

export type Resolution = {
  match: QueryMatch;
  getRect: () => DOMRect;
};

function getTextUpToAnchor(selection: RangeSelection): string | null {
  const anchor = selection.anchor;
  if (anchor.type !== "text") {
    return null;
  }
  const anchorNode = anchor.getNode();
  if (!anchorNode.isSimpleText()) {
    return null;
  }
  const anchorOffset = anchor.offset;
  return anchorNode.getTextContent().slice(0, anchorOffset);
}

function tryToPositionRange(
  leadOffset: number,
  range: Range,
  editorWindow: Window,
  rootElement: HTMLElement | null
): boolean {
  const domSelection = getDOMSelection(editorWindow);
  if (domSelection === null || !domSelection.isCollapsed) {
    return false;
  }
  const points = getDOMSelectionPoints(domSelection, rootElement);
  const anchorNode = points.anchorNode;
  const startOffset = leadOffset;
  const endOffset = points.anchorOffset;

  if (anchorNode == null || endOffset == null) {
    return false;
  }

  try {
    range.setStart(anchorNode, startOffset);
    range.setEnd(anchorNode, endOffset);
  } catch (_error) {
    return false;
  }

  return true;
}

function getQueryTextForSearch(editor: LexicalEditor): string | null {
  let text = null;
  editor.read("latest", () => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }
    text = getTextUpToAnchor(selection);
  });
  return text;
}

function isSelectionOnEntityBoundary(
  editor: LexicalEditor,
  offset: number
): boolean {
  if (offset !== 0) {
    return false;
  }
  return editor.read("latest", () => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchor = selection.anchor;
      const anchorNode = anchor.getNode();
      const prevSibling = anchorNode.getPreviousSibling();
      return $isTextNode(prevSibling) && prevSibling.isTextEntity();
    }
    return false;
  });
}

export { useDynamicPositioning } from "./shared/LexicalMenu";
export { SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND };

/**
 * The default set of punctuation characters (as a character-class fragment)
 * that terminate a typeahead query. Used as the default `punctuation` option of
 * {@link useBasicTypeaheadTriggerMatch}.
 */
export const PUNCTUATION =
  "\\.,\\+\\*\\?\\$\\@\\|#{}\\(\\)\\^\\-\\[\\]\\\\/!%'\"~=<>_:;";

/** @deprecated Moved to `@lexical/utils`. Import `getScrollParent` from there. */
export const getScrollParent = getScrollParent_;

/**
 * Builds a {@link TriggerFn} for the common case of a single-character
 * `trigger` (such as `@` or `#`) followed by a query. The returned function
 * matches when the trigger is preceded by whitespace, an open parenthesis,
 * or the start of the line
 * and is followed by between `minLength` and `maxLength` non-`punctuation`
 * characters (optionally allowing whitespace).
 */
export function useBasicTypeaheadTriggerMatch(
  trigger: string,
  {
    minLength = 1,
    maxLength = 75,
    punctuation = PUNCTUATION,
    allowWhitespace = false,
  }: {
    minLength?: number;
    maxLength?: number;
    punctuation?: string;
    allowWhitespace?: boolean;
  }
): TriggerFn {
  return (text: string) => {
    const validCharsSuffix = allowWhitespace ? "" : "\\s";
    const validChars = "[^" + trigger + punctuation + validCharsSuffix + "]";
    const TypeaheadTriggerRegex = new RegExp(
      "(^|\\s|\\()(" +
        "[" +
        trigger +
        "]" +
        "((?:" +
        validChars +
        "){0," +
        maxLength +
        "})" +
        ")$"
    );
    const match = TypeaheadTriggerRegex.exec(text);
    if (match !== null) {
      const maybeLeadingWhitespace = match[1];
      const matchingString = match[3];
      if (matchingString.length >= minLength) {
        return {
          leadOffset: match.index + maybeLeadingWhitespace.length,
          matchingString,
          replaceableString: match[2],
        };
      }
    }
    return null;
  };
}

export type TypeaheadMenuPluginProps<TOption extends MenuOption> = {
  onQueryChange: (matchingString: string | null) => void;
  onSelectOption: (
    option: TOption,
    textNodeContainingQuery: TextNode | null,
    closeMenu: () => void,
    matchingString: string
  ) => void;
  options: Array<TOption>;
  triggerFn: TriggerFn;
  menuRenderFn?: MenuRenderFn<TOption>;
  onOpen?: (resolution: MenuResolution) => void;
  onClose?: () => void | PromiseLike<void>;
  anchorClassName?: string;
  commandPriority?: CommandListenerPriority;
  parent?: HTMLElement;
  preselectFirstItem?: boolean;
  ignoreEntityBoundary?: boolean;
};

/**
 * Renders a floating menu (such as an `@`-mention or slash-command picker) while
 * the text before the cursor matches `triggerFn`. As the user types, the
 * current query is reported via `onQueryChange`; supply the `options` to show
 * and an `onSelectOption` handler to apply the chosen option. Use
 * {@link useBasicTypeaheadTriggerMatch} to build a simple `triggerFn`.
 */
export function LexicalTypeaheadMenuPlugin<TOption extends MenuOption>(
  props: TypeaheadMenuPluginProps<TOption>
): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [resolution, setResolution] = createSignal<MenuResolution | null>(null);
  let openGeneration = 0;
  // Whether the menu is open as far as onOpen/onClose are concerned. Unlike
  // `resolution`, this sees an open whose transition has not rendered yet and
  // a close whose onClose promise is still pending.
  let isOpen = false;

  const closeTypeahead = () => {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    const closingGeneration = openGeneration;
    const finish = () => {
      if (openGeneration === closingGeneration) {
        setResolution(null);
      }
    };
    let result: void | PromiseLike<void> | undefined;
    try {
      result = props.onClose && props.onClose();
    } finally {
      if (result) {
        result.then(finish, finish);
      } else {
        finish();
      }
    }
  };

  const openTypeahead = (res: MenuResolution) => {
    // Track pending opens before their transition has rendered.
    openGeneration++;
    setResolution(res);
    if (!isOpen) {
      isOpen = true;
      if (props.onOpen != null) {
        props.onOpen(res);
      }
    }
  };

  // LexicalMenu hides the menu when its anchor scrolls out of view. Route
  // that through closeTypeahead so onClose still pairs with onOpen.
  const setMenuResolution = (res: MenuResolution | null) => {
    if (res === null) {
      closeTypeahead();
    } else {
      setResolution(res);
    }
  };
  const anchorElementRef = useMenuAnchorRef(
    resolution,
    setMenuResolution,
    props.anchorClassName,
    props.parent
  );

  createEffect(
    on(resolution, () => {
      const updateListener = () => {
        editor.read("latest", () => {
          // Check if editor is in read-only mode
          if (!editor.isEditable()) {
            closeTypeahead();
            return;
          }

          const closeUnlessComposing = () => {
            if (!editor.isComposing()) {
              closeTypeahead();
            }
          };

          const editorWindow = editor._window || window;
          const range = editorWindow.document.createRange();
          const selection = $getSelection();
          const text = getQueryTextForSearch(editor);

          if (
            !$isRangeSelection(selection) ||
            !selection.isCollapsed() ||
            text === null ||
            range === null
          ) {
            closeUnlessComposing();
            return;
          }

          const match = props.triggerFn(text, editor);
          props.onQueryChange(match ? match.matchingString : null);

          if (
            match !== null &&
            (props.ignoreEntityBoundary ||
              !isSelectionOnEntityBoundary(editor, match.leadOffset))
          ) {
            const isRangePositioned = tryToPositionRange(
              match.leadOffset,
              range,
              editorWindow,
              editor.getRootElement()
            );
            if (isRangePositioned) {
              startTransition(() =>
                openTypeahead({
                  getRect: () => range.getBoundingClientRect(),
                  match,
                })
              );
              return;
            }
          }
          closeUnlessComposing();
        });
      };

      const removeUpdateListener =
        editor.registerUpdateListener(updateListener);

      onCleanup(() => {
        removeUpdateListener();
      });
    })
  );

  onMount(() => {
    onCleanup(
      editor.registerEditableListener((isEditable) => {
        if (!isEditable) {
          closeTypeahead();
        }
      })
    );
  });

  return (
    <Show when={anchorElementRef.current !== null ? resolution() : null}>
      {(currentResolution) => (
        <LexicalMenu<TOption>
          close={closeTypeahead}
          resolution={currentResolution()}
          editor={editor}
          anchorElementRef={anchorElementRef}
          options={props.options}
          menuRenderFn={props.menuRenderFn}
          onSelectOption={props.onSelectOption}
          shouldSplitNodeWithQuery={true}
          commandPriority={props.commandPriority ?? COMMAND_PRIORITY_LOW}
          preselectFirstItem={props.preselectFirstItem ?? true}
        />
      )}
    </Show>
  );
}

export { MenuOption };
export type { MenuRenderFn, MenuResolution, MenuTextMatch, TriggerFn };
