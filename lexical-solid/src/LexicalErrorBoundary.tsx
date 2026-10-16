import { ErrorBoundary, JSX } from "solid-js";

/**
 * Props for the {@link LexicalErrorBoundary} component.
 */
export type LexicalErrorBoundaryProps = {
  children: JSX.Element;
  fallback?: JSX.Element;
  onError: (error: Error) => void;
};

/**
 * An error boundary used by `RichTextPlugin` and `PlainTextPlugin` to isolate
 * failures thrown while rendering decorator nodes. It renders `fallback` in
 * place of the failed subtree and forwards the error (coerced to an `Error`)
 * to the `onError` callback. When `fallback` is omitted a small default
 * message is shown; pass `fallback={null}` to render nothing.
 */
export function LexicalErrorBoundary(
  props: LexicalErrorBoundaryProps
): JSX.Element {
  return (
    // Solid only calls `fallback` as a function when it declares a parameter.
    <ErrorBoundary
      fallback={(error) => {
        props.onError(
          error instanceof Error
            ? error
            : new Error(String(error), { cause: error })
        );
        return props.fallback === undefined ? (
          <div
            style={{
              border: "1px solid #f00",
              color: "#f00",
              padding: "8px",
            }}
          >
            An error was thrown.
          </div>
        ) : (
          props.fallback
        );
      }}
    >
      {props.children}
    </ErrorBoundary>
  );
}
