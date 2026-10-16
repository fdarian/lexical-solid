import { LexicalEditor, NodeKey } from "lexical";
import {
  createComponent,
  createEffect,
  createMemo,
  createSignal,
  mapArray,
  onCleanup,
  onMount,
  Suspense,
  Accessor,
  Component,
  JSX,
} from "solid-js";
import { insert } from "solid-js/web";

type ErrorBoundaryProps = {
  children: JSX.Element;
  onError: (error: Error) => void;
};
export type ErrorBoundaryType = Component<ErrorBoundaryProps>;

export function useDecorators(
  editor: LexicalEditor,
  ErrorBoundary: ErrorBoundaryType
): Accessor<JSX.Element[]> {
  const [decorators, setDecorators] = createSignal<
    Record<NodeKey, () => JSX.Element>
  >(editor.getDecorators<() => JSX.Element>());

  // Subscribe to changes
  onCleanup(
    editor.registerDecoratorListener<() => JSX.Element>((nextDecorators) => {
      setDecorators(nextDecorators);
    })
  );

  // Decorators mount into elements that only exist once the editor has a root
  // element, so they must be remounted when it changes.
  const [rootElement, setRootElement] = createSignal<HTMLElement | null>(
    editor.getRootElement()
  );
  onCleanup(
    editor.registerRootListener((nextRootElement) => {
      setRootElement(nextRootElement);
    })
  );

  onMount(() => {
    // If the content editable mounts before the subscription is added, then
    // nothing will be rendered on initial pass. We can get around that by
    // ensuring that we set the value.
    setDecorators(editor.getDecorators<() => JSX.Element>());
  });

  const onError = (error: Error) => editor._onError(error);

  // Each key mounts its decorator straight into the node's host element. The
  // mount is keyed on the host element and the decorator function identity, so
  // a key remounts only when one of those changes: lexical only re-calls
  // `decorate()` for dirty nodes, which keeps the other decorators alive when
  // a node is added or removed.
  return mapArray(
    () => Object.keys(decorators()),
    (nodeKey) => {
      const target = createMemo(
        () => {
          rootElement();
          return {
            element: editor.getElementByKey(nodeKey),
            decorator: decorators()[nodeKey],
          };
        },
        undefined,
        {
          equals: (prev, next) =>
            prev.element === next.element && prev.decorator === next.decorator,
        }
      );

      createEffect(() => {
        const element = target().element;
        if (element === null) {
          return;
        }
        const decorator = target().decorator;
        insert(element, () => (
          <ErrorBoundary onError={onError}>
            <Suspense fallback={null}>{createComponent(decorator, {})}</Suspense>
          </ErrorBoundary>
        ));
        // Same as what Solid's `render` does when disposed.
        onCleanup(() => {
          element.textContent = "";
        });
      });

      return null;
    }
  );
}
