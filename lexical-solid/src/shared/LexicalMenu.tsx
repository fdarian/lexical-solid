import { useLexicalComposerContext } from "../LexicalComposerContext";
import { getScrollParent } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  CAN_USE_DOM,
  COMMAND_PRIORITY_LOW,
  CommandListenerPriority,
  createCommand,
  getDOMShadowRoots,
  getParentElement,
  getRootOwnerDocument,
  isDOMShadowRoot,
  isHTMLElement,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  LexicalCommand,
  LexicalEditor,
  mergeRegister,
  registerEventListener,
  TextNode,
} from "lexical";
import {
  Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  on,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { Portal } from "solid-js/web";

/**
 * Describes where a typeahead trigger matched the text before the cursor: the
 * `leadOffset` where the match starts, the captured `matchingString` (the query
 * after the trigger), and the `replaceableString` (the full matched text,
 * including the trigger, that should be replaced when an option is selected).
 */
export type MenuTextMatch = {
  leadOffset: number;
  matchingString: string;
  replaceableString: string;
};

/**
 * The position and match information for an open menu: a `getRect` function that
 * returns the anchor rectangle the menu is positioned against, and the optional
 * {@link MenuTextMatch} that opened it.
 */
export type MenuResolution = {
  match?: MenuTextMatch;
  getRect: () => DOMRect;
};

export type MutableRefObject<T> = { current: T };

/**
 * The base class for an item shown in a typeahead or node menu. Each option has
 * a unique `key` and a `ref` to its rendered element (used for scrolling and
 * keyboard navigation). Subclass it to attach your own data such as a label or
 * callback.
 */
export class MenuOption {
  key: string;
  ref?: MutableRefObject<HTMLElement | null>;
  icon?: JSX.Element;
  title?: JSX.Element | string;

  constructor(key: string) {
    this.key = key;
    this.ref = { current: null };
    this.setRefElement = this.setRefElement.bind(this);
  }

  setRefElement(element: HTMLElement | null) {
    this.ref = { current: element };
  }
}

/**
 * A render function for a menu's contents. It receives the anchor element ref,
 * the current item props (selected index, options, and helpers to select or
 * highlight an option), and the matching query string, and returns the menu
 * element to render. Provide one to fully customize a menu's appearance.
 */
export type MenuRenderFn<TOption extends MenuOption> = (
  anchorElementRef: MutableRefObject<HTMLElement | null | undefined>,
  itemProps: {
    selectedIndex: Accessor<number | null>;
    selectOptionAndCleanUp: (option: TOption) => void;
    setHighlightedIndex: (index: number) => void;
    options: Array<TOption>;
  },
  matchingString: string
) => JSX.Element;

const scrollIntoViewIfNeeded = (target: HTMLElement) => {
  const typeaheadContainerNode = target.closest(
    "#typeahead-menu"
  ) as HTMLElement | null;
  if (!typeaheadContainerNode) {
    return;
  }

  const typeaheadRect = typeaheadContainerNode.getBoundingClientRect();

  if (typeaheadRect.top + typeaheadRect.height > window.innerHeight) {
    typeaheadContainerNode.scrollIntoView({
      block: "center",
    });
  }

  if (typeaheadRect.top < 0) {
    typeaheadContainerNode.scrollIntoView({
      block: "center",
    });
  }

  target.scrollIntoView({ block: "nearest" });
};

/**
 * Walk backwards along user input and forward through entity title to try
 * and replace more of the user's text with entity.
 */
function getFullMatchOffset(
  documentText: string,
  entryText: string,
  offset: number
): number {
  let triggerOffset = offset;
  for (let i = triggerOffset; i <= entryText.length; i++) {
    if (documentText.slice(-i) === entryText.substring(0, i)) {
      triggerOffset = i;
    }
  }
  return triggerOffset;
}

/**
 * Split Lexical TextNode and return a new TextNode only containing matched text.
 * Common use cases include: removing the node, replacing with a new node.
 */
function $splitNodeContainingQuery(match: MenuTextMatch): TextNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return null;
  }
  const anchor = selection.anchor;
  if (anchor.type !== "text") {
    return null;
  }
  const anchorNode = anchor.getNode();
  if (!anchorNode.isSimpleText()) {
    return null;
  }
  const selectionOffset = anchor.offset;
  const textContent = anchorNode.getTextContent().slice(0, selectionOffset);
  const characterOffset = match.replaceableString.length;
  const queryOffset = getFullMatchOffset(
    textContent,
    match.matchingString,
    characterOffset
  );
  const startOffset = selectionOffset - queryOffset;
  if (startOffset < 0) {
    return null;
  }
  let newNode;
  if (startOffset === 0) {
    [newNode] = anchorNode.splitText(selectionOffset);
  } else {
    [, newNode] = anchorNode.splitText(startOffset, selectionOffset);
  }

  return newNode;
}

function isTriggerVisibleInNearestScrollContainer(
  targetElement: HTMLElement,
  containerElement: HTMLElement
): boolean {
  const tRect = targetElement.getBoundingClientRect();
  const cRect = containerElement.getBoundingClientRect();

  const VISIBILITY_MARGIN_PX = 6;
  return (
    tRect.top >= cRect.top - VISIBILITY_MARGIN_PX &&
    tRect.top <= cRect.bottom + VISIBILITY_MARGIN_PX
  );
}

/**
 * Keeps an open menu aligned with its trigger by calling `onReposition` on
 * scroll, window resize, and target element resize while `resolution` is set.
 * Optionally calls `onVisibilityChange` when the trigger enters or leaves its
 * nearest scroll container's viewport.
 */
export function useDynamicPositioning(
  resolution: Accessor<MenuResolution | null>,
  targetElement: HTMLElement | null,
  onReposition: () => void,
  onVisibilityChange?: (isInView: boolean) => void
) {
  const [editor] = useLexicalComposerContext();
  createEffect(() => {
    if (targetElement != null && resolution() != null) {
      const rootElement = editor.getRootElement();
      const rootScrollParent =
        rootElement != null
          ? getScrollParent(rootElement, false)
          : document.body;
      let ticking = false;
      let previousIsInView = isTriggerVisibleInNearestScrollContainer(
        targetElement,
        rootScrollParent
      );
      const handleScroll = function () {
        if (!ticking) {
          window.requestAnimationFrame(function () {
            onReposition();
            ticking = false;
          });
          ticking = true;
        }
        const isInView = isTriggerVisibleInNearestScrollContainer(
          targetElement,
          rootScrollParent
        );
        if (isInView !== previousIsInView) {
          previousIsInView = isInView;
          if (onVisibilityChange != null) {
            onVisibilityChange(isInView);
          }
        }
      };
      const resizeObserver = new ResizeObserver(onReposition);
      // Scroll events are non-composed and do not cross shadow boundaries,
      // so the document-level listener below never sees scrolls inside an
      // enclosing shadow tree. Key off the editor root rather than the
      // target: the target may be portaled into the light DOM while the
      // editor (and its scroll container) live inside a shadow tree, and
      // getDOMShadowRoots(target) would then return an empty list.
      const enclosingShadowRoots = getDOMShadowRoots(
        rootElement ?? targetElement
      );
      resizeObserver.observe(targetElement);
      onCleanup(
        mergeRegister(
          registerEventListener(window, "resize", onReposition),
          registerEventListener(document, "scroll", handleScroll, {
            capture: true,
            passive: true,
          }),
          ...enclosingShadowRoots.map((root) =>
            registerEventListener(root, "scroll", handleScroll, {
              capture: true,
              passive: true,
            })
          ),
          () => resizeObserver.unobserve(targetElement)
        )
      );
    }
  });
}

/**
 * Command dispatched while a menu is open to scroll the option at the given
 * `index` into view. The built-in menu registers a default handler; register
 * one at a higher priority to override the scrolling behavior.
 */
export const SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND: LexicalCommand<{
  index: number;
  option: MenuOption;
}> = createCommand("SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND");

function MenuItem(props: {
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  option: MenuOption;
}) {
  return (
    <li
      tabIndex={-1}
      class={props.isSelected ? "item selected" : "item"}
      ref={props.option.setRefElement}
      role="option"
      aria-selected={props.isSelected}
      id={"typeahead-item-" + props.index}
      onMouseEnter={props.onMouseEnter}
      onClick={props.onClick}
    >
      {props.option.icon}
      <span class="text">{props.option.title}</span>
    </li>
  );
}

export function LexicalMenu<TOption extends MenuOption>(props: {
  close: () => void;
  editor: LexicalEditor;
  anchorElementRef: MutableRefObject<HTMLElement | null | undefined>;
  resolution: MenuResolution;
  options: Array<TOption>;
  shouldSplitNodeWithQuery?: boolean;
  menuRenderFn?: MenuRenderFn<TOption>;
  onSelectOption: (
    option: TOption,
    textNodeContainingQuery: TextNode | null,
    closeMenu: () => void,
    matchingString: string
  ) => void;
  commandPriority?: CommandListenerPriority;
  preselectFirstItem?: boolean;
}): JSX.Element | null {
  const [rawSelectedIndex, setHighlightedIndex] = createSignal<null | number>(
    null
  );
  // Clamp highlighted index if options list shrinks
  const selectedIndex = createMemo(() => {
    const index = rawSelectedIndex();
    return index !== null ? Math.min(props.options.length - 1, index) : null;
  });

  const commandPriority = () => props.commandPriority ?? COMMAND_PRIORITY_LOW;
  const preselectFirstItem = () => props.preselectFirstItem ?? true;
  const matchingString = () =>
    props.resolution.match ? props.resolution.match.matchingString : "";

  createEffect(
    on([preselectFirstItem, matchingString], () => {
      if (preselectFirstItem()) {
        setHighlightedIndex(0);
      }
    })
  );

  const selectOptionAndCleanUp = (selectedEntry: TOption) => {
    props.editor.update(() => {
      const textNodeContainingQuery =
        props.resolution.match != null && props.shouldSplitNodeWithQuery
          ? $splitNodeContainingQuery(props.resolution.match)
          : null;

      props.onSelectOption(
        selectedEntry,
        textNodeContainingQuery,
        props.close,
        matchingString()
      );
    });
  };

  const updateSelectedIndex = (index: number) => {
    const rootElem = props.editor.getRootElement();
    if (rootElem !== null) {
      rootElem.setAttribute("aria-activedescendant", "typeahead-item-" + index);
      setHighlightedIndex(index);
    }
  };

  createEffect(() => {
    const editor = props.editor;
    onCleanup(() => {
      const rootElem = editor.getRootElement();
      if (rootElem !== null) {
        rootElem.removeAttribute("aria-activedescendant");
      }
    });
  });

  createEffect(() => {
    if (props.options === null) {
      setHighlightedIndex(null);
    } else if (selectedIndex() === null && preselectFirstItem()) {
      updateSelectedIndex(0);
    }
  });

  // Whether this menu currently puts nothing on screen, and so must not
  // consume the keys that would otherwise reach the editor. Only true for the
  // default renderer: a `menuRenderFn` is called whatever the option list
  // looks like, and is free to draw a "no results" panel that the user still
  // has to be able to arrow through and dismiss.
  const rendersNothing = () =>
    props.menuRenderFn == null &&
    (props.options === null || !props.options.length);

  createEffect(() => {
    onCleanup(
      props.editor.registerCommand(
        SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND,
        ({ option }) => {
          if (option.ref && option.ref.current != null) {
            scrollIntoViewIfNeeded(option.ref.current);
            return true;
          }

          return false;
        },
        commandPriority()
      )
    );
  });

  createEffect(() => {
    const editor = props.editor;
    const priority = commandPriority();
    onCleanup(
      mergeRegister(
        editor.registerCommand<KeyboardEvent>(
          KEY_ARROW_DOWN_COMMAND,
          (event) => {
            if (rendersNothing()) {
              // There is nothing to move through, and the default renderer
              // draws no menu for an empty list, so the key has to keep
              // propagating to whatever would otherwise move the caret.
              return false;
            }
            const currentIndex = selectedIndex();
            const newSelectedIndex =
              currentIndex === null
                ? 0
                : currentIndex !== props.options.length - 1
                ? currentIndex + 1
                : 0;

            updateSelectedIndex(newSelectedIndex);

            const option = props.options[newSelectedIndex];
            if (!option) {
              updateSelectedIndex(-1);
              event.preventDefault();
              event.stopImmediatePropagation();
              return true;
            }

            if (option.ref && option.ref.current) {
              editor.dispatchCommand(SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND, {
                index: newSelectedIndex,
                option,
              });
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            return true;
          },
          priority
        ),
        editor.registerCommand<KeyboardEvent>(
          KEY_ARROW_UP_COMMAND,
          (event) => {
            if (rendersNothing()) {
              // See KEY_ARROW_DOWN_COMMAND above.
              return false;
            }
            const currentIndex = selectedIndex();
            const newSelectedIndex =
              currentIndex === null
                ? props.options.length - 1
                : currentIndex !== 0
                ? currentIndex - 1
                : props.options.length - 1;

            updateSelectedIndex(newSelectedIndex);

            const option = props.options[newSelectedIndex];
            if (!option) {
              updateSelectedIndex(-1);
              event.preventDefault();
              event.stopImmediatePropagation();
              return true;
            }

            if (option.ref && option.ref.current) {
              scrollIntoViewIfNeeded(option.ref.current);
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            return true;
          },
          priority
        ),
        editor.registerCommand<KeyboardEvent>(
          KEY_ESCAPE_COMMAND,
          (event) => {
            if (rendersNothing()) {
              // See KEY_ARROW_DOWN_COMMAND above: with nothing on screen there
              // is no menu to dismiss, so Escape has to keep propagating to
              // whatever would otherwise handle it.
              return false;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            props.close();
            return true;
          },
          priority
        ),
        editor.registerCommand<KeyboardEvent>(
          KEY_TAB_COMMAND,
          (event) => {
            const index = selectedIndex();
            if (
              props.options === null ||
              index === null ||
              props.options[index] == null
            ) {
              return false;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            selectOptionAndCleanUp(props.options[index]);
            return true;
          },
          priority
        ),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event: KeyboardEvent | null) => {
            const index = selectedIndex();
            if (
              props.options === null ||
              index === null ||
              props.options[index] == null ||
              // Shift+Enter must reach rich-text line-break handling
              (event && event.shiftKey)
            ) {
              return false;
            }
            if (event !== null) {
              event.preventDefault();
              event.stopImmediatePropagation();
            }
            selectOptionAndCleanUp(props.options[index]);
            return true;
          },
          priority
        )
      )
    );
  });

  const defaultMenuRenderFn = () => (
    <Show when={props.anchorElementRef.current}>
      {(anchorElement) => (
        <Show when={props.options.length}>
          <Portal mount={anchorElement()}>
            <div class="typeahead-popover mentions-menu">
              <ul>
                <For each={props.options}>
                  {(option, i) => (
                    <MenuItem
                      index={i()}
                      isSelected={selectedIndex() === i()}
                      onClick={() => {
                        setHighlightedIndex(i());
                        selectOptionAndCleanUp(option);
                      }}
                      onMouseEnter={() => {
                        setHighlightedIndex(i());
                      }}
                      option={option}
                    />
                  )}
                </For>
              </ul>
            </div>
          </Portal>
        </Show>
      )}
    </Show>
  );

  const listItemProps = {
    get options() {
      return props.options;
    },
    selectOptionAndCleanUp,
    selectedIndex,
    setHighlightedIndex,
  };

  return untrack(() => {
    const menuRenderFn = props.menuRenderFn;
    if (menuRenderFn != null) {
      return menuRenderFn(
        props.anchorElementRef,
        listItemProps,
        matchingString()
      );
    }
    return defaultMenuRenderFn();
  });
}

function setContainerDivAttributes(
  containerDiv: HTMLElement,
  className?: string
) {
  if (className != null) {
    containerDiv.className = className;
  }
  containerDiv.setAttribute("aria-label", "Typeahead menu");
  containerDiv.setAttribute("role", "listbox");
  containerDiv.style.display = "block";
  containerDiv.style.position = "absolute";
}

/**
 * Whether an element establishes the containing block that an absolutely
 * positioned descendant resolves its offsets against. Being positioned is the
 * usual reason, but a transform, filter, containment or a `will-change` naming
 * one of those does it too, on an otherwise statically positioned element.
 */
function establishesContainingBlock(style: CSSStyleDeclaration): boolean {
  if (style.position !== "static") {
    return true;
  }
  const willChange = style.willChange;
  return (
    style.transform !== "none" ||
    style.perspective !== "none" ||
    style.filter !== "none" ||
    style.backdropFilter !== "none" ||
    style.contain.includes("paint") ||
    style.contain.includes("layout") ||
    style.contain.includes("strict") ||
    style.contain.includes("content") ||
    willChange.includes("transform") ||
    willChange.includes("perspective") ||
    willChange.includes("filter") ||
    willChange.includes("contain")
  );
}

/**
 * The anchor is absolutely positioned, so its `top`/`left` are resolved
 * against its containing block. That is the initial containing block (i.e.
 * document coordinates, which is why the page scroll offsets are added) only
 * while the anchor's ancestors are all statically positioned, as is the case
 * for the default `document.body` parent. A `parent` passed to
 * {@link useMenuAnchorRef} is usually positioned so that it can contain the
 * menu, and document coordinates then place the menu at the parent's own
 * offset instead of at the caret.
 *
 * Resolved by walking up from the element the anchor is appended to rather
 * than from the anchor's own `offsetParent`: the anchor is removed from the
 * DOM every time the menu closes and is positioned again before it is
 * re-attached, so at this point it is usually detached, and a detached element
 * has no `offsetParent` to read.
 *
 * Returns the viewport coordinates of the origin that the anchor's `top`/
 * `left` are measured from, or `null` when that origin is the initial
 * containing block and document coordinates apply.
 */
function getContainingBlockOrigin(
  parent: HTMLElement | ShadowRoot
): null | { left: number; top: number } {
  // An anchor inside a shadow tree is laid out against the flat tree, so the
  // walk continues at the host.
  const start = isDOMShadowRoot(parent) ? parent.host : parent;
  for (
    let element: HTMLElement | null = isHTMLElement(start) ? start : null;
    element !== null;
    element = getParentElement(element)
  ) {
    const view = element.ownerDocument.defaultView;
    if (view === null) {
      break;
    }
    if (establishesContainingBlock(view.getComputedStyle(element))) {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left + element.clientLeft - element.scrollLeft,
        top: rect.top + element.clientTop - element.scrollTop,
      };
    }
  }
  // Nothing at or above the insertion point is positioned, so the containing
  // block is still the initial one and document coordinates apply.
  return null;
}

function resolveMenuParent(
  editor: LexicalEditor
): HTMLElement | ShadowRoot | undefined {
  if (!CAN_USE_DOM) {
    return undefined;
  }
  const rootElement = editor.getRootElement();
  if (rootElement !== null) {
    const root = rootElement.getRootNode();
    if (isDOMShadowRoot(root)) {
      return root as ShadowRoot;
    }
    return rootElement.ownerDocument.body;
  }
  return document.body;
}

export function useMenuAnchorRef(
  resolution: Accessor<MenuResolution | null>,
  setResolution: (r: MenuResolution | null) => void,
  className?: string,
  parent?: HTMLElement,
  shouldIncludePageYOffset__EXPERIMENTAL: boolean = true
): MutableRefObject<HTMLElement | null> {
  const [editor] = useLexicalComposerContext();
  const anchorElement = CAN_USE_DOM
    ? getRootOwnerDocument(editor.getRootElement()).createElement("div")
    : null;
  const anchorElementRef: MutableRefObject<HTMLElement | null> = {
    current: anchorElement,
  };
  const positionMenu = () => {
    const containerDiv = anchorElementRef.current;
    // Resolved on each call: the editor root may not exist yet when this hook runs.
    const resolvedParent = parent ?? resolveMenuParent(editor);
    if (containerDiv === null || resolvedParent === undefined) {
      return;
    }
    containerDiv.style.top = containerDiv.style.bottom;
    const rootElement = editor.getRootElement();
    const currentResolution = resolution();

    const menuEle = containerDiv.firstChild as HTMLElement;
    if (rootElement !== null && currentResolution !== null) {
      const rect = currentResolution.getRect();
      const left = rect.left;
      const top = rect.top;
      const width = rect.width;
      const height = rect.height;
      const anchorHeight = containerDiv.offsetHeight; // use to position under anchor
      // `left`/`top` from getRect() are viewport coordinates; translate them
      // into the coordinate space the anchor is actually positioned in.
      const origin = getContainingBlockOrigin(resolvedParent);
      const toAnchorLeft = (viewportLeft: number) =>
        origin !== null
          ? viewportLeft - origin.left
          : viewportLeft + window.pageXOffset;
      const toAnchorTop = (viewportTop: number) =>
        origin !== null
          ? viewportTop - origin.top
          : viewportTop +
            (shouldIncludePageYOffset__EXPERIMENTAL ? window.pageYOffset : 0);
      containerDiv.style.top = `${toAnchorTop(top + anchorHeight + 3)}px`;
      containerDiv.style.left = `${toAnchorLeft(left)}px`;
      containerDiv.style.height = `${height}px`;
      containerDiv.style.width = `${width}px`;
      if (menuEle !== null) {
        menuEle.style.top = `${top}`;
        const menuRect = menuEle.getBoundingClientRect();
        const menuHeight = menuRect.height;
        const menuWidth = menuRect.width;

        const rootElementRect = rootElement.getBoundingClientRect();

        if (left + menuWidth > rootElementRect.right) {
          containerDiv.style.left = `${toAnchorLeft(
            rootElementRect.right - menuWidth
          )}px`;
        }
        if (
          (top + menuHeight > window.innerHeight ||
            top + menuHeight > rootElementRect.bottom) &&
          top - rootElementRect.top > menuHeight + height
        ) {
          containerDiv.style.top = `${toAnchorTop(top - menuHeight - height)}px`;
        }
      }

      if (!containerDiv.isConnected) {
        setContainerDivAttributes(containerDiv, className);
        resolvedParent.append(containerDiv);
      }
      containerDiv.setAttribute("id", "typeahead-menu");
      rootElement.setAttribute("aria-controls", "typeahead-menu");
    }
  };

  createEffect(() => {
    const rootElement = editor.getRootElement();
    if (resolution() !== null) {
      positionMenu();
    }
    onCleanup(() => {
      if (rootElement !== null) {
        rootElement.removeAttribute("aria-controls");
      }

      const containerDiv = anchorElementRef.current;
      if (containerDiv !== null && containerDiv.isConnected) {
        containerDiv.remove();
        containerDiv.removeAttribute("id");
      }
    });
  });

  const onVisibilityChange = (isInView: boolean) => {
    if (resolution() !== null) {
      if (!isInView) {
        setResolution(null);
      }
    }
  };

  useDynamicPositioning(
    resolution,
    anchorElementRef.current,
    positionMenu,
    onVisibilityChange
  );

  // Append the context for the menu immediately
  if (anchorElement !== null) {
    setContainerDivAttributes(anchorElement, className);
    const initialParent = parent ?? resolveMenuParent(editor);
    if (initialParent !== undefined) {
      initialParent.append(anchorElement);
    }
  }

  return anchorElementRef;
}

/**
 * Detects whether the text before the cursor should open a typeahead menu.
 * Given the current `text` and `editor`, it returns a {@link MenuTextMatch}
 * describing the match, or `null` if there is none. See
 * `useBasicTypeaheadTriggerMatch` for a common implementation.
 */
export type TriggerFn = (
  text: string,
  editor: LexicalEditor
) => MenuTextMatch | null;
