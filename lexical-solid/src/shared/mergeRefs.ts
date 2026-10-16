export function mergeRefs<T>(
  ...refs: Array<((arg: T) => void) | undefined | null>
): (arg: T) => void {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(value);
      }
    }
  };
}
