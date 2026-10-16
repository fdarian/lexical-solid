import { Doc } from "yjs";
import { createContext, DEV, JSX, useContext } from "solid-js";

export type CollaborationContextType = {
  color: string;
  isCollabActive: boolean;
  name: string;
  yjsDocMap: Map<string, Doc>;
};

const entries = [
  ["Cat", "rgb(125, 50, 0)"],
  ["Dog", "rgb(100, 0, 0)"],
  ["Rabbit", "rgb(150, 0, 0)"],
  ["Frog", "rgb(200, 0, 0)"],
  ["Fox", "rgb(200, 75, 0)"],
  ["Hedgehog", "rgb(0, 75, 0)"],
  ["Pigeon", "rgb(0, 125, 0)"],
  ["Squirrel", "rgb(75, 100, 0)"],
  ["Bear", "rgb(125, 100, 0)"],
  ["Tiger", "rgb(0, 0, 150)"],
  ["Leopard", "rgb(0, 0, 200)"],
  ["Zebra", "rgb(0, 0, 250)"],
  ["Wolf", "rgb(0, 100, 150)"],
  ["Owl", "rgb(0, 100, 100)"],
  ["Gull", "rgb(100, 0, 100)"],
  ["Squid", "rgb(150, 0, 150)"],
];

// Picked on first use rather than at module scope so importing this module has
// no side effect. It is still picked once and shared by every context created
// afterwards.
let randomEntry: undefined | (typeof entries)[number];
function getRandomEntry(): (typeof entries)[number] {
  if (randomEntry === undefined) {
    randomEntry = entries[Math.floor(Math.random() * entries.length)];
  }
  return randomEntry;
}

export const CollaborationContext =
  createContext<CollaborationContextType | null>(null);

export function newContext(): CollaborationContextType {
  const [name, color] = getRandomEntry();
  return {
    color,
    isCollabActive: false,
    name,
    yjsDocMap: new Map(),
  };
}

// This is here to help the transition post-#7818, however should be removed in a future release as
// a shared context across editors is likely to lead to bugs.
const UNSAFE_GLOBAL_CONTEXT = newContext();

export function LexicalCollaboration(props: {
  children?: JSX.Element;
}): JSX.Element {
  const collabContext = newContext();

  return (
    <CollaborationContext.Provider value={collabContext}>
      {props.children}
    </CollaborationContext.Provider>
  );
}

export function useCollaborationContext(
  username?: string,
  color?: string
): CollaborationContextType {
  let collabContext = useContext(CollaborationContext);
  if (collabContext == null) {
    const message = "useCollaborationContext: no context provider found";
    if (DEV) {
      throw new Error(message);
    }
    console.warn(message);
  }

  collabContext = collabContext ?? UNSAFE_GLOBAL_CONTEXT;

  if (username != null) {
    collabContext.name = username;
  }

  if (color != null) {
    collabContext.color = color;
  }

  return collabContext;
}
