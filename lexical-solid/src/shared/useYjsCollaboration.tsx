import {
  Binding,
  BaseBinding,
  Provider,
  CONNECTED_COMMAND,
  createUndoManager,
  initLocalState,
  removeCursorHighlightRule,
  setLocalStateFocus,
  syncCursorPositions,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  TOGGLE_CONNECT_COMMAND,
  SyncCursorPositionsFn,
} from "@lexical/yjs";
import {
  LexicalEditor,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  BLUR_COMMAND,
  CAN_UNDO_COMMAND,
  CAN_REDO_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
  getActiveElement,
  HISTORY_MERGE_TAG,
  mergeRegister,
  REDO_COMMAND,
  registerEventListeners,
  SKIP_COLLAB_TAG,
  UNDO_COMMAND,
} from "lexical";
import { Doc, Transaction, YEvent, UndoManager } from "yjs";
import { InitialEditorStateType } from "../LexicalComposer";
import { JSX, Setter } from "solid-js";
import { Portal } from "solid-js/web";
import {
  Accessor,
  createEffect,
  createMemo,
  onCleanup,
  onMount,
} from "solid-js";

export type CursorsContainerRef = Accessor<HTMLElement | undefined | null>;

/**
 * Well-known key under which the active Yjs {@link UndoManager} is published on
 * the editor instance. Collab disables `@lexical/history`, so this is the
 * handle tooling and e2e tests use to force a deterministic undo boundary via
 * `editor[COLLAB_UNDO_MANAGER]?.stopCapturing()` instead of waiting out the
 * UndoManager capture timeout.
 */
const COLLAB_UNDO_MANAGER = Symbol.for("@lexical/yjs/UndoManager");

type OnYjsTreeChanges = (
  // The below `any` type is taken directly from the vendor types for YJS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: YEvent<any>[],
  transaction: Transaction
) => void;

export function useYjsCollaboration(
  editor: LexicalEditor,
  id: string,
  provider: Accessor<Provider>,
  docMap: Map<string, Doc>,
  name: string,
  color: string,
  shouldBootstrap: boolean,
  binding: Accessor<Binding>,
  setDoc: Setter<Doc | undefined>,
  cursorsContainerRef?: CursorsContainerRef,
  initialEditorState?: InitialEditorStateType,
  awarenessData?: object,
  syncCursorPositionsFn: SyncCursorPositionsFn = syncCursorPositions,
  selectionHighlight: boolean = false
): Accessor<JSX.Element> {
  const isReloadingDoc = { current: false };

  const onBootstrap = () => {
    const currentBinding = binding();
    if (
      shouldBootstrap &&
      currentBinding.root.isEmpty() &&
      currentBinding.root._xmlText._length === 0
    ) {
      bootstrapEditor(currentBinding, editor, initialEditorState);
    }
  };

  createEffect(() => {
    const currentBinding = binding();
    const currentProvider = provider();
    const root = currentBinding.root;

    const onYjsTreeChanges: OnYjsTreeChanges = (events, transaction) => {
      const origin = transaction.origin;
      if (origin !== currentBinding) {
        const isFromUndoManager = origin instanceof UndoManager;
        syncYjsChangesToLexical(
          currentBinding,
          currentProvider,
          events,
          isFromUndoManager,
          syncCursorPositionsFn
        );
      }
    };

    // This updates the local editor state when we receive updates from other clients
    root.getSharedType().observeDeep(onYjsTreeChanges);
    const removeListener = editor.registerUpdateListener(
      ({
        prevEditorState,
        editorState,
        dirtyLeaves,
        dirtyElements,
        normalizedNodes,
        tags,
      }) => {
        if (!tags.has(SKIP_COLLAB_TAG)) {
          syncLexicalUpdateToYjs(
            currentBinding,
            currentProvider,
            prevEditorState,
            editorState,
            dirtyElements,
            dirtyLeaves,
            normalizedNodes,
            tags
          );
        }
      }
    );

    onCleanup(() => {
      root.getSharedType().unobserveDeep(onYjsTreeChanges);
      removeListener();
    });
  });

  // Note: 'reload' is not an actual Yjs event type. Included here for legacy support (#1409).
  createEffect(() => {
    const currentBinding = binding();
    const currentProvider = provider();

    const onProviderDocReload = (ydoc: Doc) => {
      clearEditorSkipCollab(editor, currentBinding);
      setDoc(ydoc);
      docMap.set(id, ydoc);
      isReloadingDoc.current = true;
    };

    const onSync = () => {
      isReloadingDoc.current = false;
    };

    currentProvider.on("reload", onProviderDocReload);
    currentProvider.on("sync", onSync);

    onCleanup(() => {
      currentProvider.off("reload", onProviderDocReload);
      currentProvider.off("sync", onSync);
    });
  });

  useProvider(
    editor,
    provider,
    name,
    color,
    isReloadingDoc,
    awarenessData,
    onBootstrap
  );

  useAwareness(binding, provider, selectionHighlight);

  return useYjsCursors(binding, cursorsContainerRef);
}

function connectProvider(provider: Provider) {
  return provider.connect();
}

function disconnectProvider(provider: Provider) {
  try {
    provider.disconnect();
  } catch (_e) {
    // Do nothing
  }
}

function useProvider(
  editor: LexicalEditor,
  provider: Accessor<Provider>,
  name: string,
  color: string,
  isReloadingDoc: { current: boolean },
  awarenessData?: object,
  onBootstrap?: () => void
): void {
  createEffect(() => {
    const currentProvider = provider();

    const onStatus = ({ status }: { status: string }) => {
      editor.dispatchCommand(CONNECTED_COMMAND, status === "connected");
    };

    const onSync = (isSynced: boolean) => {
      if (isSynced && isReloadingDoc.current === false && onBootstrap) {
        onBootstrap();
      }
    };

    const rootElement = editor.getRootElement();
    initLocalState(
      currentProvider,
      name,
      color,
      // getActiveElement rather than document.activeElement, which reports the
      // shadow host when the editor is in a shadow root.
      rootElement !== null && getActiveElement(rootElement) === rootElement,
      awarenessData || {}
    );

    currentProvider.on("status", onStatus);
    currentProvider.on("sync", onSync);

    const connectionPromise = connectProvider(currentProvider);

    onCleanup(() => {
      if (isReloadingDoc.current === false) {
        if (connectionPromise) {
          connectionPromise.then(() => disconnectProvider(currentProvider));
        } else {
          // Workaround for race condition in StrictMode. It's possible there
          // is a different race for the above case where connect returns a
          // promise, but we don't have an example of that in-repo.
          // It's possible that there is a similar issue with
          // TOGGLE_CONNECT_COMMAND below when the provider connect returns a
          // promise.
          // https://github.com/facebook/lexical/issues/6640
          disconnectProvider(currentProvider);
        }
      }

      currentProvider.off("sync", onSync);
      currentProvider.off("status", onStatus);
    });
  });

  onCleanup(
    editor.registerCommand(
      TOGGLE_CONNECT_COMMAND,
      (payload) => {
        const shouldConnect = payload;
        if (shouldConnect) {
          // eslint-disable-next-line no-console
          console.log("Collaboration connected!");
          connectProvider(provider());
        } else {
          // eslint-disable-next-line no-console
          console.log("Collaboration disconnected!");
          disconnectProvider(provider());
        }

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    )
  );

  // Clear awareness state immediately when tab is refreshed or closed
  // This prevents ghost cursors from appearing for several seconds after disconnect
  // See: https://github.com/facebook/lexical/issues/8061
  createEffect(() => {
    const currentProvider = provider();

    const clearAwarenessState = () => {
      // Immediately clear local awareness state to signal disconnection
      // This broadcasts to other clients that this client has disconnected,
      // causing them to remove the cursor immediately instead of waiting for timeout
      try {
        currentProvider.awareness.setLocalState(null);
      } catch (_e) {
        // Ignore errors during cleanup (e.g., if provider is already disconnected)
      }
    };

    // Use both beforeunload and pagehide for maximum browser compatibility
    // beforeunload: fires before page unloads (may be cancelable)
    // pagehide: fires when page is being unloaded (more reliable, especially on mobile)
    onCleanup(
      registerEventListeners(window, {
        beforeunload: clearAwarenessState,
        pagehide: clearAwarenessState,
      })
    );
  });
}

function useAwareness(
  binding: Accessor<Binding>,
  provider: Accessor<Provider>,
  selectionHighlight: boolean
) {
  createEffect(() => {
    const currentBinding = binding();
    const currentProvider = provider();
    const awareness = currentProvider.awareness;
    const onAwarenessUpdate = () => {
      syncCursorPositions(currentBinding, currentProvider, {
        selectionHighlight,
      });
    };
    awareness.on("update", onAwarenessUpdate);

    onCleanup(() => {
      awareness.off("update", onAwarenessUpdate);
    });
  });
}

export function useYjsCursors(
  binding: Accessor<BaseBinding>,
  cursorsContainerRef?: CursorsContainerRef
): Accessor<JSX.Element> {
  return createMemo(() => {
    const ref = (element: null | HTMLElement) => {
      binding().cursorsContainer = element;
    };

    const mountPoint =
      (cursorsContainerRef && cursorsContainerRef()) || document.body;

    return (
      <Portal mount={mountPoint}>
        <div ref={ref} />
      </Portal>
    );
  });
}

export function useYjsFocusTracking(
  editor: LexicalEditor,
  provider: Accessor<Provider>,
  name: string,
  color: string,
  awarenessData?: object
) {
  onCleanup(
    mergeRegister(
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          setLocalStateFocus(
            provider(),
            name,
            color,
            true,
            awarenessData || {}
          );
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          setLocalStateFocus(
            provider(),
            name,
            color,
            false,
            awarenessData || {}
          );
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      )
    )
  );
}

export function useYjsHistory(
  editor: LexicalEditor,
  binding: Accessor<Binding>
): () => void {
  const undoManager = createMemo(() =>
    createUndoManager(binding(), binding().root.getSharedType())
  );

  onMount(() => {
    const undo = () => {
      undoManager().undo();
    };

    const redo = () => {
      undoManager().redo();
    };

    onCleanup(
      mergeRegister(
        editor.registerCommand(
          UNDO_COMMAND,
          () => {
            undo();
            return true;
          },
          COMMAND_PRIORITY_EDITOR
        ),
        editor.registerCommand(
          REDO_COMMAND,
          () => {
            redo();
            return true;
          },
          COMMAND_PRIORITY_EDITOR
        )
      )
    );
  });
  // Publish the UndoManager on the editor (see COLLAB_UNDO_MANAGER) so tooling
  // and e2e tests can reach it; remove it again when it changes or unmounts.
  createEffect(() => {
    const currentUndoManager = undoManager();
    const withManager = editor as LexicalEditor &
      Record<symbol, UndoManager | undefined>;
    withManager[COLLAB_UNDO_MANAGER] = currentUndoManager;
    onCleanup(() => {
      if (withManager[COLLAB_UNDO_MANAGER] === currentUndoManager) {
        delete withManager[COLLAB_UNDO_MANAGER];
      }
    });
  });

  const clearHistory = () => {
    undoManager().clear();
  };

  // Exposing undo and redo states
  createEffect(() => {
    const updateUndoRedoStates = () => {
      editor.dispatchCommand(
        CAN_UNDO_COMMAND,
        undoManager().undoStack.length > 0
      );
      editor.dispatchCommand(
        CAN_REDO_COMMAND,
        undoManager().redoStack.length > 0
      );
    };
    undoManager().on("stack-item-added", updateUndoRedoStates);
    undoManager().on("stack-item-popped", updateUndoRedoStates);
    undoManager().on("stack-cleared", updateUndoRedoStates);
    onCleanup(() => {
      undoManager().off("stack-item-added", updateUndoRedoStates);
      undoManager().off("stack-item-popped", updateUndoRedoStates);
      undoManager().off("stack-cleared", updateUndoRedoStates);
    });
  });

  return clearHistory;
}

/**
 * Write the initial editor state into an empty shared document. The write is
 * flagged on the binding so that the Yjs UndoManager created by
 * `createUndoManager` skips the resulting transaction: bootstrapping is not a
 * user edit and must not be undoable, which matches a non-collab editor where
 * the initial state is applied with HISTORY_MERGE_TAG (#7110).
 */
function bootstrapEditor(
  binding: BaseBinding,
  editor: LexicalEditor,
  initialEditorState?: InitialEditorStateType
): void {
  binding.isBootstrapping = true;
  try {
    // The Yjs write happens in the update listener during the commit, which is
    // not necessarily synchronous with this call, so the flag has to outlive
    // it. An `onUpdate` callback is the boundary that matches the write:
    // Lexical queues it on `editor._deferred` before the update body runs and
    // flushes it at the tail of the same commit that ran the update listeners,
    // so it lands after the write and never before it. A queued deferred
    // callback also forces a commit on its own, so this still runs when the
    // update turns out to be a no-op.
    initializeEditor(editor, initialEditorState, () => {
      binding.isBootstrapping = false;
    });
  } finally {
    // `onUpdate` alone is not enough: when the update body throws, Lexical
    // reports the error, commits (running the update listeners, so the Yjs
    // write still happens), and skips that commit's deferred callbacks. The
    // reset would then be left queued until the tail of the *next* commit,
    // by which point that commit's listener has already written to Yjs with
    // the flag set, silently keeping the user's first edit after a failed
    // bootstrap out of the undo stack. This bounds the flag's lifetime to a
    // microtask no matter how the update ends. It cannot fire early: the
    // commit is scheduled from inside `editor.update` above, so its microtask
    // is queued ahead of this one.
    queueMicrotask(() => {
      binding.isBootstrapping = false;
    });
  }
}

function initializeEditor(
  editor: LexicalEditor,
  initialEditorState?: InitialEditorStateType,
  onUpdate?: () => void
): void {
  editor.update(
    () => {
      const root = $getRoot();

      if (root.isEmpty()) {
        if (initialEditorState) {
          switch (typeof initialEditorState) {
            case "string": {
              const parsedEditorState =
                editor.parseEditorState(initialEditorState);
              editor.setEditorState(parsedEditorState, {
                tag: HISTORY_MERGE_TAG,
              });
              break;
            }
            case "object": {
              editor.setEditorState(initialEditorState, {
                tag: HISTORY_MERGE_TAG,
              });
              break;
            }
            case "function": {
              editor.update(
                () => {
                  const root1 = $getRoot();
                  if (root1.isEmpty()) {
                    initialEditorState(editor);
                  }
                },
                { tag: HISTORY_MERGE_TAG }
              );
              break;
            }
          }
        } else {
          const paragraph = $createParagraphNode();
          root.append(paragraph);
          const rootElement = editor.getRootElement();

          if (
            $getSelection() !== null ||
            (rootElement !== null &&
              getActiveElement(rootElement) === rootElement)
          ) {
            paragraph.select();
          }
        }
      }
    },
    {
      onUpdate,
      tag: HISTORY_MERGE_TAG,
    }
  );
}

function clearEditorSkipCollab(editor: LexicalEditor, binding: BaseBinding) {
  // reset editor state
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      root.select();
    },
    {
      tag: SKIP_COLLAB_TAG,
    }
  );

  if (binding.cursors == null) {
    return;
  }

  const cursors = binding.cursors;

  if (cursors == null) {
    return;
  }
  const cursorsContainer = binding.cursorsContainer;

  if (cursorsContainer == null) {
    return;
  }

  for (const cursor of cursors.values()) {
    const selection = cursor.selection;
    if (selection === null) {
      continue;
    }
    if (selection.highlight !== null) {
      CSS.highlights.delete(selection.highlightName);
      removeCursorHighlightRule(binding, selection.highlightName);
    }
    if (selection.caret.parentNode === cursorsContainer) {
      cursorsContainer.removeChild(selection.caret);
    }
    for (const span of selection.selections) {
      if (span.parentNode === cursorsContainer) {
        cursorsContainer.removeChild(span);
      }
    }
    cursor.selection = null;
  }
}
