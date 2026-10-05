// A helper for ./stress.bench.ts: objects of many text properties, all tracked.
import { flushSync } from "svelte";
import { URLParameterize } from "../../release";

const text = (query: unknown) => (typeof query === "string" ? query : "");

/** `instances` objects of `params` text properties of `size` characters each, all tracked. */
export const build = (params: number, size: number, instances = 1) => {
  history.replaceState(null, "", "/");
  const targets: Record<string, string>[] = [];
  const cleanups: (() => void)[] = [];
  for (let i = 0; i < instances; i++) {
    const target = $state(
      Object.fromEntries(
        Array.from({ length: params }, (_, k) => [`p${k}`, "x".repeat(size)]),
      ),
    );
    const tracked = URLParameterize(
      target,
      Object.fromEntries(Object.keys(target).map((key) => [key, text])),
      { prefix: `i${i}_` },
    );
    targets.push(target);
    cleanups.push(tracked.cleanup);
  }
  flushSync();
  return { targets, cleanup: () => cleanups.forEach((cleanup) => cleanup()) };
};
