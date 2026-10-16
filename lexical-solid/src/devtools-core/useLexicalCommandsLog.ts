import type { LexicalEditor } from "lexical";

import { COMMAND_PRIORITY_CRITICAL, LexicalCommand } from "lexical";
import { Accessor, createSignal, onCleanup, onMount } from "solid-js";

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
  editor: LexicalEditor
): Accessor<LexicalCommandLog> {
  const [loggedCommands, setLoggedCommands] = createSignal<LexicalCommandLog>(
    []
  );

  onMount(() =>
    onCleanup(registerLexicalCommandLogger(editor, setLoggedCommands))
  );

  return loggedCommands;
}
