import type { LexicalEditor } from "lexical";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import {
  createEffect,
  createMemo,
  createSignal,
  JSX,
  onCleanup,
  Show,
  splitProps,
} from "solid-js";
import {
  ContentEditableElement,
  type ContentEditableElementProps,
} from "./shared/LexicalContentEditableElement";
import { useCanShowPlaceholder } from "./shared/useCanShowPlaceholder";

export { ContentEditableElement, type ContentEditableElementProps };

/**
 * Props for the {@link ContentEditable} component. These are the
 * {@link ContentEditableElementProps} (minus `editor`, which is read from
 * context) plus an optional `placeholder`; when a `placeholder` is provided an
 * `aria-placeholder` string is also required for accessibility.
 */
export type ContentEditableProps = Omit<ContentEditableElementProps, "editor"> &
  (
    | {
        "aria-placeholder"?: void;
        placeholder?: null;
      }
    | {
        "aria-placeholder": string;
        placeholder:
          | ((isEditable: boolean) => null | JSX.Element)
          | JSX.Element;
      }
  );

/**
 * The editable surface of a Lexical editor: the `contentEditable` element that
 * users type into. Render it inside a {@link LexicalComposer} (it reads the
 * editor from context) and pass it to {@link RichTextPlugin} or
 * {@link PlainTextPlugin}. An optional `placeholder` is shown while the editor
 * is empty. The `ref` is forwarded to the underlying `<div>`.
 */
export function ContentEditable(props: ContentEditableProps): JSX.Element {
  const [, rest] = splitProps(props, ["placeholder"]);
  const [editor] = useLexicalComposerContext();

  return (
    <>
      <ContentEditableElement editor={editor} {...rest} ref={props.ref} />
      {props.placeholder != null && (
        <Placeholder editor={editor} content={props.placeholder} />
      )}
    </>
  );
}

function Placeholder(props: {
  editor: LexicalEditor;
  content: ((isEditable: boolean) => null | JSX.Element) | JSX.Element;
}): JSX.Element {
  const showPlaceholder = useCanShowPlaceholder(props.editor);

  const [isEditable, setEditable] = createSignal(props.editor.isEditable());
  createEffect(() => {
    setEditable(props.editor.isEditable());
    onCleanup(
      props.editor.registerEditableListener((currentIsEditable) => {
        setEditable(currentIsEditable);
      })
    );
  });
  const placeholder = createMemo(() =>
    typeof props.content === "function"
      ? props.content(isEditable())
      : props.content
  );

  return (
    <Show when={showPlaceholder() && placeholder()}>
      <div aria-hidden={true}>{placeholder()}</div>
    </Show>
  );
}
