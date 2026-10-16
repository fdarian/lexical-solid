import type { LexicalEditor } from "lexical";

import { COMMAND_PRIORITY_CRITICAL, LexicalCommand } from "lexical";
import { Accessor, createEffect, createSignal, onCleanup } from "solid-js";

export type LexicalCommandEntry = { index: number } & LexicalCommand<unknown> & {
    payload: unknown;
  };

export type LexicalCommandLog = ReadonlyArray<LexicalCommandEntry>;

export function registerLexicalCommandLogger(
  editor: LexicalEditor,
  setLoggedCommands: (
    v: (oldValue: LexicalCommandLog) => LexicalCommandLog
  ) => void
): () => void {
  const unregisterCommandListeners: Array<() => void> = [];
  let index = 0;
  for (const command of editor._commands.keys()) {
    unregisterCommandListeners.push(
      editor.registerCommand(
        command,
        (payload) => {
          index += 1;
          const entry: LexicalCommandEntry = {
            index,
            payload,
            type: command.type ? command.type : "UNKNOWN",
          };
          setLoggedCommands((state) => [...state.slice(-9), entry]);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
  }

  return () => unregisterCommandListeners.forEach((unregister) => unregister());
}

export function useLexicalCommandsLog(
  editor: LexicalEditor | Accessor<LexicalEditor>
): Accessor<LexicalCommandLog> {
  const [loggedCommands, setLoggedCommands] = createSignal<LexicalCommandLog>(
    []
  );

  // The log is kept across editor changes, like upstream: only the listeners
  // move to the new editor.
  createEffect(() => {
    const currentEditor = typeof editor === "function" ? editor() : editor;
    onCleanup(registerLexicalCommandLogger(currentEditor, setLoggedCommands));
  });

  return loggedCommands;
}
