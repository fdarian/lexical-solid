import { useLexicalComposerContext } from "./LexicalComposerContext";
import { useLexicalEditable } from "./useLexicalEditable";
import { eventFiles } from "@lexical/rich-text";
import { calculateZoomLevel } from "@lexical/utils";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $onUpdate,
  BLUR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  getActiveElement,
  getActiveElementDeep,
  getComposedEventTarget,
  getParentElement,
  getRootOwnerDocument,
  IS_FIREFOX,
  isHTMLElement,
  LexicalEditor,
  mergeRegister,
  registerEventListener,
  registerEventListeners,
} from "lexical";
import { Accessor, createEffect, createSignal, JSX, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

import { Point } from "./shared/point";
import { Rectangle } from "./shared/rect";

const SPACE = 4;
const TARGET_LINE_HALF_HEIGHT = 2;
const DRAG_DATA_FORMAT = "application/x-lexical-drag-block";
const TEXT_BOX_HORIZONTAL_PADDING = 28;

const Downward = 1;
const Upward = -1;
const Indeterminate = 0;

let prevIndex = Infinity;

function getCurrentIndex(keysLength: number): number {
  if (keysLength === 0) {
    return Infinity;
  }
  if (prevIndex >= 0 && prevIndex < keysLength) {
    return prevIndex;
  }

  return Math.floor(keysLength / 2);
}

function getTopLevelNodeKeys(editor: LexicalEditor): string[] {
  return editor.read("latest", () => $getRoot().getChildrenKeys());
}

function restoreEditorFocus(
  editor: LexicalEditor,
  rootElement: HTMLElement
): void {
  rootElement.focus({ preventScroll: true });
  editor.update(() => {
    const selection = $getSelection();
    if (selection !== null && !selection.dirty) {
      selection.dirty = true;
    }
  });
}

function getCollapsedMargins(elem: HTMLElement): {
  marginTop: number;
  marginBottom: number;
} {
  const view = elem.ownerDocument.defaultView;
  const getMargin = (
    element: Element | null,
    margin: "marginTop" | "marginBottom"
  ): number =>
    element && view ? parseFloat(view.getComputedStyle(element)[margin]) : 0;

  const style = view ? view.getComputedStyle(elem) : null;
  const marginTop = style ? style.marginTop : "0";
  const marginBottom = style ? style.marginBottom : "0";
  const prevElemSiblingMarginBottom = getMargin(
    elem.previousElementSibling,
    "marginBottom"
  );
  const nextElemSiblingMarginTop = getMargin(
    elem.nextElementSibling,
    "marginTop"
  );
  const collapsedTopMargin = Math.max(
    parseFloat(marginTop),
    prevElemSiblingMarginBottom
  );
  const collapsedBottomMargin = Math.max(
    parseFloat(marginBottom),
    nextElemSiblingMarginTop
  );

  return { marginBottom: collapsedBottomMargin, marginTop: collapsedTopMargin };
}

function getBlockElement(
  anchorElem: HTMLElement,
  editor: LexicalEditor,
  event: MouseEvent,
  useEdgeAsDefault = false
): HTMLElement | null {
  const anchorElementRect = anchorElem.getBoundingClientRect();
  const topLevelNodeKeys = getTopLevelNodeKeys(editor);

  let blockElem: HTMLElement | null = null;

  editor.read("latest", () => {
    if (useEdgeAsDefault) {
      const [firstNode, lastNode] = [
        editor.getElementByKey(topLevelNodeKeys[0]),
        editor.getElementByKey(topLevelNodeKeys[topLevelNodeKeys.length - 1]),
      ];

      const [firstNodeRect, lastNodeRect] = [
        firstNode != null ? firstNode.getBoundingClientRect() : undefined,
        lastNode != null ? lastNode.getBoundingClientRect() : undefined,
      ];

      if (firstNodeRect && lastNodeRect) {
        const firstNodeZoom = calculateZoomLevel(firstNode);
        const lastNodeZoom = calculateZoomLevel(lastNode);
        if (event.y / firstNodeZoom < firstNodeRect.top) {
          blockElem = firstNode;
        } else if (event.y / lastNodeZoom > lastNodeRect.bottom) {
          blockElem = lastNode;
        }

        if (blockElem) {
          return;
        }
      }
    }

    let index = getCurrentIndex(topLevelNodeKeys.length);
    let direction = Indeterminate;

    while (index >= 0 && index < topLevelNodeKeys.length) {
      const key = topLevelNodeKeys[index];
      const elem = editor.getElementByKey(key);
      if (elem === null) {
        break;
      }
      const zoom = calculateZoomLevel(elem);
      const point = new Point(event.x / zoom, event.y / zoom);
      const domRect = Rectangle.fromDOM(elem);
      const { marginTop, marginBottom } = getCollapsedMargins(elem);
      const rect = domRect.generateNewRect({
        bottom: domRect.bottom + marginBottom,
        left: anchorElementRect.left,
        right: anchorElementRect.right,
        top: domRect.top - marginTop,
      });

      const {
        result,
        reason: { isOnTopSide, isOnBottomSide },
      } = rect.contains(point);

      if (result) {
        blockElem = elem;
        prevIndex = index;
        break;
      }

      if (direction === Indeterminate) {
        if (isOnTopSide) {
          direction = Upward;
        } else if (isOnBottomSide) {
          direction = Downward;
        } else {
          // stop search block element
          direction = Infinity;
        }
      }

      index += direction;
    }
  });

  return blockElem;
}

function setMenuPosition(
  targetElem: HTMLElement | null,
  floatingElem: HTMLElement,
  anchorElem: HTMLElement,
  zoomLevel: number
) {
  if (!targetElem) {
    floatingElem.style.display = "none";
    return;
  }

  const targetRect = targetElem.getBoundingClientRect();
  const targetView = targetElem.ownerDocument.defaultView;
  const targetStyle = targetView
    ? targetView.getComputedStyle(targetElem)
    : null;
  const floatingElemRect = floatingElem.getBoundingClientRect();
  const anchorElementRect = anchorElem.getBoundingClientRect();

  // top left
  let targetCalculateHeight: number = targetStyle
    ? parseInt(targetStyle.lineHeight, 10)
    : NaN;
  if (isNaN(targetCalculateHeight)) {
    // middle
    targetCalculateHeight = targetRect.bottom - targetRect.top;
  }

  const top =
    (targetRect.top +
      (targetCalculateHeight -
        (floatingElemRect.height || targetCalculateHeight)) /
        2 -
      anchorElementRect.top +
      anchorElem.scrollTop) /
    zoomLevel;

  const left = SPACE;

  floatingElem.style.display = "flex";
  floatingElem.style.opacity = "1";
  floatingElem.style.transform = `translate(${left}px, ${top}px)`;
}

function setDragImage(
  dataTransfer: DataTransfer,
  draggableBlockElem: HTMLElement
) {
  const { transform } = draggableBlockElem.style;

  // Remove dragImage borders
  draggableBlockElem.style.transform = "translateZ(0)";
  dataTransfer.setDragImage(draggableBlockElem, 0, 0);

  setTimeout(() => {
    draggableBlockElem.style.transform = transform;
  });
}

function setTargetLine(
  targetLineElem: HTMLElement,
  targetBlockElem: HTMLElement,
  mouseY: number,
  anchorElem: HTMLElement
) {
  const { top: targetBlockElemTop, height: targetBlockElemHeight } =
    targetBlockElem.getBoundingClientRect();
  const { top: anchorTop, width: anchorWidth } =
    anchorElem.getBoundingClientRect();
  const { marginTop, marginBottom } = getCollapsedMargins(targetBlockElem);
  let lineTop = targetBlockElemTop;
  if (mouseY >= targetBlockElemTop) {
    lineTop += targetBlockElemHeight + marginBottom / 2;
  } else {
    lineTop -= marginTop / 2;
  }

  const top =
    lineTop - anchorTop - TARGET_LINE_HALF_HEIGHT + anchorElem.scrollTop;
  const left = TEXT_BOX_HORIZONTAL_PADDING - SPACE;

  targetLineElem.style.transform = `translate(${left}px, ${top}px)`;
  targetLineElem.style.width = `${
    anchorWidth - (TEXT_BOX_HORIZONTAL_PADDING - SPACE) * 2
  }px`;
  targetLineElem.style.opacity = ".4";
}

function hideTargetLine(targetLineElem: HTMLElement | null) {
  if (targetLineElem) {
    targetLineElem.style.opacity = "0";
    targetLineElem.style.transform = "translate(-10000px, -10000px)";
  }
}

function useDraggableBlockMenu(
  editor: LexicalEditor,
  anchorElem: HTMLElement,
  menuRef: Accessor<HTMLElement | null>,
  targetLineRef: Accessor<HTMLElement | null>,
  isEditable: Accessor<boolean>,
  menuComponent: JSX.Element,
  targetLineComponent: JSX.Element,
  isOnMenu: (element: HTMLElement) => boolean,
  onElementChanged?: (element: HTMLElement | null) => void
): JSX.Element {
  const scrollerElem = getParentElement(anchorElem);

  const isDraggingBlockRef = { current: false };
  const [draggableBlockElem, setDraggableBlockElemState] =
    createSignal<HTMLElement | null>(null);

  const setDraggableBlockElem = (elem: HTMLElement | null) => {
    setDraggableBlockElemState(elem);
    if (onElementChanged) {
      onElementChanged(elem);
    }
  };

  createEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const target = getComposedEventTarget(event);
      if (!isHTMLElement(target)) {
        setDraggableBlockElem(null);
        return;
      }

      if (isOnMenu(target)) {
        return;
      }

      const _draggableBlockElem = getBlockElement(anchorElem, editor, event);

      setDraggableBlockElem(_draggableBlockElem);
    }

    function onMouseLeave() {
      setDraggableBlockElem(null);
    }

    if (scrollerElem != null) {
      onCleanup(
        registerEventListeners(scrollerElem, {
          mouseleave: onMouseLeave,
          mousemove: onMouseMove,
        })
      );
    }
  });

  createEffect(() => {
    const zoomLevel = calculateZoomLevel(editor.getRootElement(), true);
    const menuRefUnwrapped = menuRef();
    if (menuRefUnwrapped) {
      setMenuPosition(
        draggableBlockElem(),
        menuRefUnwrapped,
        anchorElem,
        zoomLevel
      );
    }
  });

  createEffect(() => {
    function onDragover(event: DragEvent): boolean {
      if (!isDraggingBlockRef.current) {
        return false;
      }
      const [isFileTransfer] = eventFiles(event);
      if (isFileTransfer) {
        return false;
      }
      const pageY = event.pageY;
      // Composed target so the zoom level is read from the real element rather
      // than the shadow host when the editor is in a shadow tree.
      const target = getComposedEventTarget(event);
      if (!isHTMLElement(target)) {
        return false;
      }
      const targetBlockElem = getBlockElement(anchorElem, editor, event, true);
      const targetLineElem = targetLineRef();
      if (targetBlockElem === null || targetLineElem === null) {
        return false;
      }
      setTargetLine(
        targetLineElem,
        targetBlockElem,
        pageY / calculateZoomLevel(target),
        anchorElem
      );
      // Prevent default event to be able to trigger onDrop events
      event.preventDefault();
      return true;
    }

    function $onDrop(event: DragEvent): boolean {
      if (!isDraggingBlockRef.current) {
        return false;
      }
      const [isFileTransfer] = eventFiles(event);
      if (isFileTransfer) {
        return false;
      }
      const dataTransfer = event.dataTransfer;
      const pageY = event.pageY;
      // Composed target so the zoom level is read from the real element rather
      // than the shadow host when the editor is in a shadow tree.
      const target = getComposedEventTarget(event);
      const dragData =
        dataTransfer != null ? dataTransfer.getData(DRAG_DATA_FORMAT) : "";
      const draggedNode = $getNodeByKey(dragData);
      if (!draggedNode) {
        return false;
      }
      if (!isHTMLElement(target)) {
        return false;
      }
      const targetBlockElem = getBlockElement(anchorElem, editor, event, true);
      if (!targetBlockElem) {
        return false;
      }
      const targetNode = $getNearestNodeFromDOMNode(targetBlockElem);
      if (!targetNode) {
        return false;
      }
      if (targetNode === draggedNode) {
        // Firefox-specific fix: Even when no move occurs, restore focus to ensure cursor visibility
        if (IS_FIREFOX) {
          editor.focus();
        }
        return true;
      }
      const targetBlockElemTop = targetBlockElem.getBoundingClientRect().top;
      if (pageY / calculateZoomLevel(target) >= targetBlockElemTop) {
        targetNode.insertAfter(draggedNode);
      } else {
        targetNode.insertBefore(draggedNode);
      }
      setDraggableBlockElem(null);

      // Firefox-specific fix: Use editor.focus() after drop to properly restore
      // both focus and selection. This ensures cursor visibility immediately.
      if (IS_FIREFOX) {
        // Using $onUpdate ensures this happens after the current update cycle finishes
        $onUpdate(() => {
          editor.focus();
        });
      }

      return true;
    }

    onCleanup(
      mergeRegister(
        editor.registerCommand(
          DRAGOVER_COMMAND,
          (event) => {
            return onDragover(event);
          },
          COMMAND_PRIORITY_LOW
        ),
        editor.registerCommand(
          DROP_COMMAND,
          (event) => {
            return $onDrop(event);
          },
          COMMAND_PRIORITY_HIGH
        )
      )
    );
  });

  // Firefox-specific: Prevent blur when clicking on drag handle to maintain cursor visibility.
  // Firefox fires blur before dragstart, causing focus loss. We detect this by checking if
  // the blur's relatedTarget is on the menu using isOnMenu, then restore focus synchronously.
  createEffect(() => {
    if (!IS_FIREFOX || !isEditable()) {
      return;
    }

    onCleanup(
      mergeRegister(
        editor.registerRootListener((rootElement) => {
          function onBlur(event: FocusEvent) {
            const relatedTarget = event.relatedTarget;
            if (isHTMLElement(relatedTarget) && isOnMenu(relatedTarget)) {
              // Blur is caused by clicking on drag handle - restore focus immediately
              // to prevent cursor from disappearing. This must be synchronous to work.
              if (rootElement) {
                restoreEditorFocus(editor, rootElement);
              }
              // Prevent the event from propagating to LexicalEvents handler
              event.stopImmediatePropagation();
            }
          }

          if (rootElement) {
            return registerEventListener(rootElement, "blur", onBlur, true);
          }
        }),
        // Intercept BLUR_COMMAND if focus is on the menu (fallback in case event propagation wasn't stopped)
        editor.registerCommand(
          BLUR_COMMAND,
          () => {
            const rootElement = editor.getRootElement();
            // getActiveElementDeep so the menu is found whether it is portaled
            // into the light DOM or inside a shadow root (where
            // document.activeElement only reports the shadow host).
            const activeElement = getActiveElementDeep(
              getRootOwnerDocument(rootElement)
            );
            if (
              rootElement &&
              isHTMLElement(activeElement) &&
              isOnMenu(activeElement)
            ) {
              // Focus is on menu - restore to root and prevent blur command
              restoreEditorFocus(editor, rootElement);
              return true; // Prevent command from propagating
            }
            return false;
          },
          COMMAND_PRIORITY_HIGH
        )
      )
    );
  });

  function onDragStart(event: DragEvent): void {
    const dataTransfer = event.dataTransfer;
    const draggableBlockElemUnwrapped = draggableBlockElem();
    if (!dataTransfer || !draggableBlockElemUnwrapped) {
      return;
    }

    setDragImage(dataTransfer, draggableBlockElemUnwrapped);
    let nodeKey = "";
    editor.update(() => {
      const node = $getNearestNodeFromDOMNode(draggableBlockElemUnwrapped);
      if (node) {
        nodeKey = node.getKey();
      }
    });
    isDraggingBlockRef.current = true;
    dataTransfer.setData(DRAG_DATA_FORMAT, nodeKey);

    // Firefox-specific: Restore focus synchronously after drag starts to prevent cursor loss.
    // The blur handler should have already restored focus, but we do it here as a fallback
    // and to ensure selection is properly maintained during drag.
    if (IS_FIREFOX) {
      const rootElement = editor.getRootElement();
      // getActiveElement rather than document.activeElement, which reports the
      // shadow host when the editor is in a shadow root.
      if (
        rootElement !== null &&
        getActiveElement(rootElement) !== rootElement
      ) {
        // Restore focus synchronously - don't use requestAnimationFrame as blur already happened
        // and we need immediate focus restoration to maintain cursor visibility
        restoreEditorFocus(editor, rootElement);
      }
    }
  }

  function onDragEnd(): void {
    isDraggingBlockRef.current = false;
    hideTargetLine(targetLineRef());

    const rootElement = editor.getRootElement();
    if (rootElement !== null && getActiveElement(rootElement) !== rootElement) {
      restoreEditorFocus(editor, rootElement);
    }
  }
  return (
    <Portal mount={anchorElem}>
      <div draggable={true} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {isEditable() && menuComponent}
      </div>
      {targetLineComponent}
    </Portal>
  );
}

export function DraggableBlockPlugin_EXPERIMENTAL(props: {
  anchorElem?: HTMLElement;
  menuRef: HTMLElement | null | undefined;
  targetLineRef: HTMLElement | null | undefined;
  menuComponent: JSX.Element;
  targetLineComponent: JSX.Element;
  isOnMenu: (element: HTMLElement) => boolean;
  onElementChanged?: (element: HTMLElement | null) => void;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  // Subscribed rather than read off the editor, so that setEditable() actually
  // re-renders the handle.
  const isEditable = useLexicalEditable();
  return useDraggableBlockMenu(
    editor,
    props.anchorElem || document.body,
    () => props.menuRef || null,
    () => props.targetLineRef || null,
    isEditable,
    props.menuComponent,
    props.targetLineComponent,
    props.isOnMenu,
    props.onElementChanged
  );
}
