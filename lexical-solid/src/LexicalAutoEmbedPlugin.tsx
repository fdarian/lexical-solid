import {
  LexicalNode,
  $getNodeByKey,
  $getSelection,
  $onUpdate,
  COMMAND_PRIORITY_BEFORE_EDITOR,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  LexicalCommand,
  LexicalEditor,
  mergeRegister,
  MutationListener,
  NodeKey,
  PASTE_COMMAND,
  PASTE_TAG,
  TextNode,
  CommandListenerPriority,
} from "lexical";
import { $isLinkNode, AutoLinkNode, LinkNode } from "@lexical/link";
import { objectKlassEquals } from "@lexical/utils";
import { useLexicalComposerContext } from "./LexicalComposerContext";
import { MenuOption, MenuRenderFn } from "./shared/LexicalMenu";
import {
  createEffect,
  createMemo,
  createSignal,
  JSX,
  onCleanup,
  Show,
} from "solid-js";
import { LexicalNodeMenuPlugin } from "./LexicalNodeMenuPlugin";

export type EmbedMatchResult<TEmbedMatchResult = unknown> = {
  url: string;
  id: string;
  data?: TEmbedMatchResult;
};

export interface EmbedConfig<
  TEmbedMatchResultData = unknown,
  TEmbedMatchResult = EmbedMatchResult<TEmbedMatchResultData>
> {
  // Used to identify this config e.g. youtube, tweet, google-maps.
  type: string;
  // Determine if a given URL is a match and return url data.
  parseUrl: (
    text: string
  ) => Promise<TEmbedMatchResult | null> | TEmbedMatchResult | null;
  // Create the Lexical embed node from the url data.
  insertNode: (editor: LexicalEditor, result: TEmbedMatchResult) => void;
}

export const URL_MATCHER =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/;

export const INSERT_EMBED_COMMAND: LexicalCommand<EmbedConfig["type"]> =
  createCommand("INSERT_EMBED_COMMAND");

export class AutoEmbedOption extends MenuOption {
  title: string;
  onSelect: (targetNode: LexicalNode | null) => void;
  constructor(
    title: string,
    options: {
      onSelect: (targetNode: LexicalNode | null) => void;
    }
  ) {
    super(title);
    this.title = title;
    this.onSelect = options.onSelect.bind(this);
  }
}

type LexicalAutoEmbedPluginProps<TEmbedConfig extends EmbedConfig> = {
  /** An array of configurations used to insert Embed elements */
  embedConfigs: Array<TEmbedConfig>;
  /**
   * Callback for handling the {@link INSERT_EMBED_COMMAND} command.
   * If no function is passed, the command is not registered
   */
  onOpenEmbedModalForConfig?: (embedConfig: TEmbedConfig) => void;
  /**
   * A function that links a specific configuration to a set of options.
   * Each option can be handled by click or by pressing the Enter or Tab key
   * when the cursor hovers over it.
   * Pass the necessary callbacks to {@link AutoEmbedOption.onSelect}
   */
  getMenuOptions: (
    activeEmbedConfig: TEmbedConfig,
    embedFn: () => void,
    dismissFn: () => void
  ) => Array<AutoEmbedOption>;
  /**
   * A function for rendering button menu.
   * By default, it displays a plain list with the option titles
   */
  menuRenderFn?: MenuRenderFn<AutoEmbedOption>;
  /** Priority for key handling in the menu. The default is `COMMAND_PRIORITY_LOW` */
  menuCommandPriority?: CommandListenerPriority;
};

type EmbedMatch<TEmbedConfig extends EmbedConfig> = {
  embedConfig: TEmbedConfig;
  key: NodeKey;
  result: Parameters<TEmbedConfig["insertNode"]>[1];
  url: string;
};

function $getCurrentLink(key: NodeKey, url: string): LinkNode | null {
  const linkNode = $getNodeByKey(key);
  return $isLinkNode(linkNode) &&
    linkNode.isAttached() &&
    linkNode.getURL() === url
    ? linkNode
    : null;
}

/**
 * Watches for pasted AutoLink nodes that match any of the provided embed
 * configurations (e.g., YouTube, Twitter URLs). When a match is found, it shows
 * a menu offering to replace the link with an embedded node.
 */
export function LexicalAutoEmbedPlugin<TEmbedConfig extends EmbedConfig>(
  props: LexicalAutoEmbedPluginProps<TEmbedConfig>
): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  const [embedMatch, setEmbedMatch] =
    createSignal<EmbedMatch<TEmbedConfig> | null>(null);
  // Only the most recent paste may open the menu, even when an older
  // asynchronous parseUrl result resolves after a newer one.
  let latestCheck = 0;

  const reset = () => {
    setEmbedMatch(null);
  };

  const checkIfLinkNodeIsEmbeddable = async (key: NodeKey) => {
    const check = ++latestCheck;
    const url = editor.read("latest", function () {
      const linkNode = $getNodeByKey(key);
      if ($isLinkNode(linkNode)) {
        return linkNode.getURL();
      }
    });
    if (url === undefined) {
      return;
    }
    const embedConfigs = props.embedConfigs;
    // When several configs match, the last one wins, so check them from
    // the end and stop at the first match to call parseUrl no more often
    // than needed.
    for (let i = embedConfigs.length - 1; i >= 0; i--) {
      const embedConfig = embedConfigs[i];
      const result = await Promise.resolve(embedConfig.parseUrl(url));
      if (check !== latestCheck) {
        return;
      }
      if (result != null) {
        // Edits made while parseUrl was pending may not be committed yet
        if (editor.read("pending", () => $getCurrentLink(key, url) !== null)) {
          setEmbedMatch({ embedConfig, key, result, url });
        }
        return;
      }
    }
  };

  createEffect(() => {
    let isSingleTokenPaste = false;
    const listener: MutationListener = (nodeMutations, { updateTags }) => {
      const activeMatch = embedMatch();
      for (const [key, mutation] of nodeMutations) {
        if (
          mutation === "created" &&
          updateTags.has(PASTE_TAG) &&
          isSingleTokenPaste
        ) {
          checkIfLinkNodeIsEmbeddable(key);
        } else if (activeMatch !== null && key === activeMatch.key) {
          reset();
        }
      }
    };
    onCleanup(
      mergeRegister(
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            isSingleTokenPaste =
              objectKlassEquals(event, ClipboardEvent) &&
              event.clipboardData !== null &&
              /^\S+$/.test(event.clipboardData.getData("text/plain"));
            if (isSingleTokenPaste) {
              $onUpdate(() => {
                isSingleTokenPaste = false;
              });
            }
            return false;
          },
          COMMAND_PRIORITY_BEFORE_EDITOR
        ),
        ...[LinkNode, AutoLinkNode].map((Klass) =>
          editor.registerMutationListener(Klass, listener, {
            skipInitialization: true,
          })
        )
      )
    );
  });

  createEffect(() => {
    const onOpenEmbedModalForConfig = props.onOpenEmbedModalForConfig;
    if (!onOpenEmbedModalForConfig) return;

    onCleanup(
      editor.registerCommand(
        INSERT_EMBED_COMMAND,
        (embedConfigType: TEmbedConfig["type"]) => {
          const embedConfig = props.embedConfigs.find(
            ({ type }) => type === embedConfigType
          );
          if (embedConfig) {
            onOpenEmbedModalForConfig(embedConfig);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      )
    );
  });

  const embedLinkViaActiveEmbedConfig = () => {
    const match = embedMatch();
    if (match == null) {
      return;
    }
    editor.update(() => {
      const linkNode = $getCurrentLink(match.key, match.url);
      if (linkNode === null) {
        return;
      }
      if (!$getSelection()) {
        linkNode.selectEnd();
      }
      match.embedConfig.insertNode(editor, match.result);
      if (linkNode.isAttached()) {
        linkNode.remove();
      }
    });
  };

  const options = createMemo(() => {
    const match = embedMatch();
    return match != null
      ? props.getMenuOptions(
          match.embedConfig,
          embedLinkViaActiveEmbedConfig,
          reset
        )
      : [];
  });

  const onSelectOption = (
    selectedOption: AutoEmbedOption,
    targetNode: TextNode | null,
    closeMenu: () => void
  ) => {
    editor.update(() => {
      selectedOption.onSelect(targetNode);
      closeMenu();
    });
  };

  return (
    <Show when={embedMatch()}>
      {(match) => (
        <LexicalNodeMenuPlugin<AutoEmbedOption>
          nodeKey={match().key}
          onClose={reset}
          onSelectOption={onSelectOption}
          options={options()}
          menuRenderFn={props.menuRenderFn}
          commandPriority={props.menuCommandPriority ?? COMMAND_PRIORITY_LOW}
        />
      )}
    </Show>
  );
}
