import { Doc } from "yjs";
import { createContext, createSignal, DEV, JSX, useContext } from "solid-js";

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

/**
 * @lexical/yjs writes into this Map directly through binding.docMap, so it has
 * to stay a real Map instance; reactivity is layered on by overriding the
 * accessors rather than wrapping it.
 */
class ReactiveDocMap extends Map<string, Doc> {
  // Must not be constructed with entries: Map's constructor would call
  // `this.set` before these fields are initialized.
  private readonly track: () => void;
  private readonly notify: () => void;

  constructor() {
    super();
    const [version, setVersion] = createSignal(undefined, { equals: false });
    this.track = () => {
      version();
    };
    this.notify = () => {
      setVersion();
    };
  }

  override get size(): number {
    this.track();
    return super.size;
  }

  override has(key: string): boolean {
    this.track();
    return super.has(key);
  }

  override get(key: string): Doc | undefined {
    this.track();
    return super.get(key);
  }

  override forEach(
    callbackfn: (value: Doc, key: string, map: Map<string, Doc>) => void,
    thisArg?: unknown
  ): void {
    this.track();
    super.forEach(callbackfn, thisArg);
  }

  override keys(): MapIterator<string> {
    this.track();
    return super.keys();
  }

  override values(): MapIterator<Doc> {
    this.track();
    return super.values();
  }

  override entries(): MapIterator<[string, Doc]> {
    this.track();
    return super.entries();
  }

  override [Symbol.iterator](): MapIterator<[string, Doc]> {
    this.track();
    return super[Symbol.iterator]();
  }

  override set(key: string, value: Doc): this {
    super.set(key, value);
    this.notify();
    return this;
  }

  override delete(key: string): boolean {
    const deleted = super.delete(key);
    this.notify();
    return deleted;
  }

  override clear(): void {
    super.clear();
    this.notify();
  }
}

export function newContext(): CollaborationContextType {
  const [name, color] = getRandomEntry();
  const [isCollabActive, setIsCollabActive] = createSignal(false);
  return {
    color,
    // Signal-backed so consumers (e.g. LexicalNestedComposer) can react to
    // writes made by plain assignment.
    get isCollabActive() {
      return isCollabActive();
    },
    set isCollabActive(value: boolean) {
      setIsCollabActive(value);
    },
    name,
    yjsDocMap: new ReactiveDocMap(),
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
