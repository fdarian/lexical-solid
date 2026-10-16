import { Doc, XmlText } from "yjs";
import {
  type CollaborationContextType,
  useCollaborationContext,
} from "./LexicalCollaborationContext";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import {
  Binding,
  createYjsBinding,
  ExcludedProperties,
  Provider,
  SyncCursorPositionsFn,
} from "@lexical/yjs";
import { LexicalEditor } from "lexical";
import { InitialEditorStateType } from "./LexicalComposer";
import {
  CursorsContainerRef,
  useYjsCollaboration,
  useYjsFocusTracking,
  useYjsHistory,
} from "./shared/useYjsCollaboration";
import {
  createEffect,
  createSignal,
  JSX,
  onCleanup,
  Setter,
  Show,
  untrack,
} from "solid-js";

type ProviderFactory = (id: string, yjsDocMap: Map<string, Doc>) => Provider;

type Props = {
  id: string;
  providerFactory: ProviderFactory;
  /**
   * Seed the document with an empty paragraph (or `initialEditorState`) once
   * the provider reports `sync` and the document is still empty.
   *
   * At most one client may pass `true` for a given document. The seed is an
   * ordinary Yjs insert rather than a compare-and-set, so two clients that both
   * observe an empty document each insert a paragraph and Yjs keeps both,
   * leaving every client with a spurious leading empty block. This is easy to
   * hit with a nested editor (an image caption, a sticky note), where every
   * client mounts the editor -- and so connects to its document -- at the same
   * moment the node itself syncs. Prefer bootstrapping the document
   * server-side; see the collaboration docs.
   */
  shouldBootstrap: boolean;
  username?: string;
  cursorColor?: string;
  cursorsContainerRef?: CursorsContainerRef;
  initialEditorState?: InitialEditorStateType;
  excludedProperties?: ExcludedProperties;
  // `awarenessData` parameter allows arbitrary data to be added to the awareness.
  awarenessData?: object;
  syncCursorPositionsFn?: SyncCursorPositionsFn;
  /** Opt in to the new CSS Highlights-based selection rendering (if supported by the browser).
   * Fallback to legacy method if not enabled or not supported.
   */
  selectionHighlight?: boolean;
  /** Customize the Yjs shared-type key used for the root `XmlText`. Defaults to `'root'`. */
  rootName?: string;
  /**
   * Resolve the root `XmlText` from the `Doc` yourself, for roots that are not
   * a top-level shared type (e.g. an `XmlText` held in a `Y.Map` or `Y.Array`,
   * as when one `Doc` stores many independently editable documents). Takes
   * precedence over `rootName`.
   *
   * Read when the binding is created: this prop and `rootName` cannot repoint
   * a mounted editor at another document. Remount the editor to edit a
   * different one -- a remount of this plugin alone would leave the previous
   * document's content in the editor and write it into the new root.
   */
  getXmlText?: (doc: Doc) => XmlText;
};

export function CollaborationPlugin(props: Props): JSX.Element {
  let isBindingInitialized = false;
  let currentProvider: Provider | null = null;

  const collabContext = useCollaborationContext(
    props.username,
    props.cursorColor
  );

  const yjsDocMap = collabContext.yjsDocMap;
  const name = collabContext.name;
  const color = collabContext.color;

  const [editor] = useLexicalComposerContext();

  useCollabActive(collabContext, editor);

  const [provider, setProvider] = createSignal<Provider>();
  const [doc, setDoc] = createSignal<Doc>();

  createEffect(() => {
    const id = props.id;
    const providerFactory = props.providerFactory;

    const newProvider = untrack(() => providerFactory(id, yjsDocMap));
    const previousProvider = currentProvider;
    // Disconnected here rather than from this effect's cleanup, and only when
    // something really did replace it: when the factory hands back a cached
    // provider, setProvider() bails on the identical value, nothing re-runs,
    // and a cleanup-based disconnect would leave the editor disconnected.
    if (previousProvider !== null && previousProvider !== newProvider) {
      previousProvider.disconnect();
    }
    currentProvider = newProvider;
    setProvider(newProvider);
    setDoc(yjsDocMap.get(id));
  });

  onCleanup(() => {
    if (currentProvider !== null) {
      const providerToDisconnect = currentProvider;
      currentProvider = null;
      providerToDisconnect.disconnect();
    }
  });

  const [binding, setBinding] = createSignal<Binding>();

  createEffect(() => {
    if (!provider()) {
      return;
    }

    if (isBindingInitialized) {
      return;
    }

    const id = props.id;
    const resolvedDoc = doc() || yjsDocMap.get(id);
    if (!resolvedDoc) {
      return;
    }

    isBindingInitialized = true;
    // `excludedProperties`, `rootName` and `getXmlText` configure the binding
    // and are read on the pass that creates it (which is not necessarily the
    // first one -- the effect returns early until the provider exists, so a
    // root that only resolves after mount is still picked up). A binding cannot
    // be reconfigured or repointed once it exists.
    setBinding(
      untrack(() =>
        createYjsBinding({
          doc: resolvedDoc,
          docMap: yjsDocMap,
          editor,
          excludedProperties: props.excludedProperties,
          getXmlText: props.getXmlText,
          id,
          rootName: props.rootName,
        })
      )
    );
  });

  // Destroying the binding belongs to unmount, not to the creation effect: the
  // binding is created once, so destroying it there would tear it down on any
  // input change without building a replacement.
  createEffect(() => {
    const currentBinding = binding();
    if (currentBinding === undefined) {
      return;
    }
    onCleanup(() => {
      currentBinding.root.destroy(currentBinding);
    });
  });

  return (
    <Show when={provider() && binding()}>
      <YjsCollaborationCursors
        awarenessData={props.awarenessData}
        binding={binding()!}
        collabContext={collabContext}
        color={color}
        cursorsContainerRef={props.cursorsContainerRef}
        editor={editor}
        id={props.id}
        initialEditorState={props.initialEditorState}
        name={name}
        provider={provider()!}
        setDoc={setDoc}
        shouldBootstrap={props.shouldBootstrap}
        yjsDocMap={yjsDocMap}
        syncCursorPositionsFn={props.syncCursorPositionsFn}
        selectionHighlight={props.selectionHighlight}
      />
    </Show>
  );
}

function YjsCollaborationCursors(props: {
  editor: LexicalEditor;
  id: string;
  provider: Provider;
  yjsDocMap: Map<string, Doc>;
  name: string;
  color: string;
  shouldBootstrap: boolean;
  binding: Binding;
  setDoc: Setter<Doc | undefined>;
  cursorsContainerRef?: CursorsContainerRef | undefined;
  initialEditorState?: InitialEditorStateType | undefined;
  awarenessData?: object;
  collabContext: CollaborationContextType;
  syncCursorPositionsFn?: SyncCursorPositionsFn;
  /** Opt in to the new CSS Highlights-based selection rendering (if supported by the browser).
   * Fallback to legacy method if not enabled or not supported.
   */
  selectionHighlight?: boolean;
}) {
  const cursors = useYjsCollaboration(
    props.editor,
    props.id,
    () => props.provider,
    props.yjsDocMap,
    props.name,
    props.color,
    props.shouldBootstrap,
    () => props.binding,
    props.setDoc,
    props.cursorsContainerRef,
    props.initialEditorState,
    props.awarenessData,
    props.syncCursorPositionsFn,
    props.selectionHighlight
  );

  useYjsHistory(props.editor, () => props.binding);
  useYjsFocusTracking(
    props.editor,
    () => props.provider,
    props.name,
    props.color,
    props.awarenessData
  );

  return <>{cursors}</>;
}

function useCollabActive(
  collabContext: CollaborationContextType,
  editor: LexicalEditor
) {
  createEffect(() => {
    collabContext.isCollabActive = true;

    onCleanup(() => {
      // Resetting flag only when unmount top level editor collab plugin. Nested
      // editors (e.g. image caption) should unmount without affecting it
      if (editor._parentEditor == null) {
        collabContext.isCollabActive = false;
      }
    });
  });
}
