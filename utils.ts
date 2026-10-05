import type { Expect, Invoke } from "../suede.nests.slurp/dsl.import.meta.vitest.ts";

export const isBrowser = typeof window !== "undefined";

/**
 * Detects whether the current environment supports the History API.
 */
export const supportsHistory =
  isBrowser &&
  typeof history !== "undefined" &&
  typeof history.pushState === "function" &&
  typeof history.replaceState === "function";

export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

export type ExpandRecursively<T> = T extends object
  ? T extends infer O
    ? { [K in keyof O]: ExpandRecursively<O[K]> }
    : never
  : T;

export type MaybeGetter<T> = T | (() => T);

export const resolve = <T>(value: MaybeGetter<T>, fallback?: T): T => {
  if (typeof value === "function") {
    const result = (value as () => T)();
    return result === undefined ? (fallback as T) : result;
  } else return value === undefined ? (fallback as T) : value;
};

const getter = () => "from getter";
const undefinedGetter = () => undefined;

declare namespace isBrowser {
  /** false under Node, where there is no `window` */
  export type OutsideABrowser = Expect<typeof isBrowser, "=", false>;
}

declare namespace supportsHistory {
  /** false without a browser's History API */
  export type OutsideABrowser = Expect<typeof supportsHistory, "=", false>;
}

declare namespace resolve {
  /** a value is returned as it is */
  export type Value = Expect<Invoke<typeof resolve, [value: 3]>, "=", 3>;

  /** a getter is called, and its result returned */
  export type Getter = Expect<Invoke<typeof resolve, [value: typeof getter]>, "=", "from getter">;

  /** an undefined value falls back */
  export type UndefinedFallsBack = Expect<
    Invoke<typeof resolve, [value: undefined, fallback: "fallback"]>,
    "=",
    "fallback"
  >;

  /** a getter that returns undefined falls back */
  export type UndefinedGetterFallsBack = Expect<
    Invoke<typeof resolve, [value: typeof undefinedGetter, fallback: "fallback"]>,
    "=",
    "fallback"
  >;

  /** only undefined falls back: other falsy values are kept */
  export type FalsyKept = [
    Expect<Invoke<typeof resolve, [value: null, fallback: "fallback"]>, "=", null>,
    Expect<Invoke<typeof resolve, [value: 0, fallback: 1]>, "=", 0>,
    Expect<Invoke<typeof resolve, [value: "", fallback: "fallback"]>, "=", "">,
    Expect<Invoke<typeof resolve, [value: false, fallback: true]>, "=", false>,
  ];

  /** with nothing to fall back to, undefined stays undefined */
  export type NoFallback = Expect<Invoke<typeof resolve, [value: undefined]>, "undefined">;
}
