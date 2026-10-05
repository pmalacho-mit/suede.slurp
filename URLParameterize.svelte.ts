// @vitest-environment jsdom
import type {
  Expect,
  Invoke,
  Throws,
} from "../suede.nests.slurp/dsl.import.meta.vitest.ts";
import type { count, session, text } from "./_internal/harness.svelte";
import { untrack } from "svelte";
import { isBrowser, supportsHistory } from "./utils";
import { MappedDebouncer } from "./debounce";
import {
  type Options,
  type ParameterHandlers,
  type UpdateHistoryBehavior,
  defaults,
  keyOf,
  parameterize,
  verbosify,
} from "./handlers";
import { type Changes, Registry, migrate, withParams } from "./params";

export type { Options, ParameterHandler, ParameterHandlers } from "./handlers";
export { defaults } from "./handlers";

const URLChangeEvent = {
  key: "urlchange",

  emit: () => window.dispatchEvent(new CustomEvent(URLChangeEvent.key)),

  setupComplete: false,

  /** Patches the History API so that every change to the URL is announced. */
  setupListener: (): boolean => {
    if (URLChangeEvent.setupComplete) return true;
    if (!supportsHistory) return false;

    const { pushState, replaceState } = history;

    history.pushState = function (...args) {
      pushState.apply(this, args);
      URLChangeEvent.emit();
    };

    history.replaceState = function (...args) {
      replaceState.apply(this, args);
      URLChangeEvent.emit();
    };

    window.addEventListener("popstate", URLChangeEvent.emit);

    return (URLChangeEvent.setupComplete = true);
  },

  /** Makes `changes` to the URL as one history entry, or none if nothing changes. */
  commit: (changes: Changes, behavior: UpdateHistoryBehavior) => {
    const href = withParams(window.location.href, changes);
    if (href === window.location.href) return;
    if (behavior === "replace") history.replaceState(history.state, "", href);
    else history.pushState({}, "", href);
  },
};

const registry = new Registry();

let debouncer: MappedDebouncer<string> | undefined;
/** Created on first use, since it listens on `window`. */
const debounced = () =>
  (debouncer ??= new MappedDebouncer<string>({ idleMs: 0, maxWaitMs: 0 }));

export type Return = {
  cleanup: () => void;
  prefix: (prefix: string) => void;
};

const unsupported: Return = { cleanup: () => {}, prefix: () => {} };

/**
 * Synchronizes an object's properties with URL query parameters.
 *
 * This function establishes a bidirectional binding between the properties of a target object
 * and URL query parameters. Changes to the object properties automatically update the URL,
 * and changes to the URL (e.g., browser back/forward, manual edits) update the object.
 *
 * @template T The type of the target object to synchronize
 * @param target The object whose properties will be synchronized with URL parameters
 * @param handlers Configuration for each property, defining how values are converted to/from URL strings
 * @param options Optional global configuration (prefix, cleanup callback, debounce settings)
 * @returns `cleanup`, to stop synchronizing and remove the parameters from the URL, and `prefix`, to move them under a new prefix
 *
 * @example
 * ```ts
 * class Model {
 *   search = $state('');
 *   page = $state(1);
 *
 *   readonly url = URLParameterize<Model>(this, {
 *     search: (query) => String(query ?? ''),
 *     page: (query) => Number(query ?? 1)
 *   });
 * }
 * ```
 */
const URLParameterize = <T extends object>(
  target: T,
  handlers: Partial<ParameterHandlers<T>>,
  options?: Options,
): Return => {
  if (!URLChangeEvent.setupListener()) {
    if (isBrowser)
      console.error("History API not supported; URLParameterize disabled");
    return unsupported;
  }

  type Key = keyof T & string;
  const paramByKey = new Map<Key, string>();
  const value = (key: Key) => (target as Record<string, unknown>)[key];

  const onURLChange = () =>
    untrack(() => {
      const search = window.location.search;
      for (const [key, param] of paramByKey)
        registry.read(search, target, key, param);
    });

  window.addEventListener(URLChangeEvent.key, onURLChange);

  /** Writes a property's current value to the URL, if it changed since it was last synced. */
  const write = (key: Key, behavior: UpdateHistoryBehavior) => {
    const param = paramByKey.get(key);
    const handler = param && registry.handler(param);
    if (!handler) return;
    const encoded = parameterize(
      untrack(() => value(key)),
      handler,
    );
    if (registry.write(param, encoded))
      URLChangeEvent.commit({ [param]: encoded }, behavior);
  };

  const setup = (key: Key) => {
    const handler = verbosify(handlers[key]!, key, options);
    registry.register(handler);
    paramByKey.set(key, handler.key);

    const search = window.location.search;
    const removals = migrate(search, target, key, handler);
    registry.read(search, target, key, handler.key);
    URLChangeEvent.commit(removals.push, "push");
    URLChangeEvent.commit(removals.replace, "replace");

    const debounce =
      handler.debounce === false
        ? undefined
        : (handler.debounce ?? options?.debounce);

    let first = true;
    $effect(() => {
      parameterize(value(key), handler); // tracks everything the URL is written from
      if (first) {
        // Writing the initial value is not a navigation: it adds no history entry.
        first = false;
        write(key, "replace");
      } else if (debounce)
        debounced().enqueue(
          paramByKey.get(key)!,
          () => write(key, handler.history),
          debounce,
        );
      else write(key, handler.history);
    });
  };

  const updatePrefix = (prefix: string) => {
    const renames = [...paramByKey].map(([key, from]) => ({
      key,
      from,
      to: keyOf(handlers[key]!, key, prefix),
    }));
    const ours = new Set(paramByKey.values());
    for (const { to } of renames)
      if (!ours.has(to) && registry.has(to))
        throw new Error(`URL parameter key conflict detected: "${to}"`);

    // Every parameter leaves its key before any takes a new one, so two can trade keys.
    const changes: Changes = {};
    const handlerByKey = new Map(
      renames.map(({ key, from }) => {
        debouncer?.clear(from);
        changes[from] = undefined;
        const handler = registry.handler(from)!;
        registry.unregister(from);
        return [key, handler] as const;
      }),
    );
    for (const { key, to } of renames) {
      const handler = handlerByKey.get(key)!;
      handler.key = to;
      registry.register(handler);
      paramByKey.set(key, to);
      const encoded = parameterize(value(key), handler);
      registry.write(to, encoded);
      changes[to] = encoded;
    }
    URLChangeEvent.commit(changes, "replace");
  };

  const trySetupPrefixEffect = () => {
    if (typeof options?.prefix !== "function") return;
    const { prefix } = options;
    let previous = prefix();
    $effect(() => {
      const current = prefix();
      if (previous !== current)
        untrack(() => updatePrefix((previous = current)));
    });
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener(URLChangeEvent.key, onURLChange);
    const removals: Changes = {};
    for (const param of paramByKey.values()) {
      debouncer?.clear(param);
      registry.unregister(param);
      removals[param] = undefined;
    }
    paramByKey.clear();
    URLChangeEvent.commit(removals, "replace");
  };

  const cleanup = $effect.root(() => {
    for (const key in handlers) setup(key as Key);
    trySetupPrefixEffect();
    return dispose;
  });

  options?.onDestroy?.(cleanup);

  return { cleanup, prefix: updatePrefix };
};

// Played out in a browser (jsdom) by the harness's session: each test is a
// scenario, and what is expected after tracking starts and after each step.
declare namespace URLParameterize {
  /** a property not in the URL keeps its initial value, which is written there without a history entry */
  export type WritesInitialValues = Expect<
    Invoke<
      typeof session,
      [scenario: { initial: { q: "init" }; handlers: { q: typeof text } }]
    >,
    "=",
    [{ url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 }]
  >;

  /** a property in the URL starts from it */
  export type ReadsTheURL = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          url: '?q="hello"';
          initial: { q: "init" };
          handlers: { q: typeof text };
        },
      ]
    >,
    "=",
    [{ url: { q: '"hello"' }; entries: 0; values: { q: "hello" }; errors: 0 }]
  >;

  /** each change is written as a history entry */
  export type WritesChanges = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ set: { q: "a" } }, { set: { q: "b c" } }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"a"' }; entries: 1; values: { q: "a" }; errors: 0 },
      { url: { q: '"b c"' }; entries: 2; values: { q: "b c" }; errors: 0 },
    ]
  >;

  /** with history: "replace", changes are written without history entries */
  export type ReplacesHistory = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: { resolve: typeof text; history: "replace" } };
          steps: [{ set: { q: "a" } }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"a"' }; entries: 0; values: { q: "a" }; errors: 0 },
    ]
  >;

  /** the back and forward buttons bring the values back */
  export type FollowsHistory = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ set: { q: "a" } }, { back: true }, { forward: true }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"a"' }; entries: 1; values: { q: "a" }; errors: 0 },
      { url: { q: '"init"' }; entries: 1; values: { q: "init" }; errors: 0 },
      { url: { q: '"a"' }; entries: 1; values: { q: "a" }; errors: 0 },
    ]
  >;

  /** navigating elsewhere is read, and not written back */
  export type FollowsNavigation = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ navigate: '?q="elsewhere"' }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      {
        url: { q: '"elsewhere"' };
        entries: 1;
        values: { q: "elsewhere" };
        errors: 0;
      },
    ]
  >;

  /** a parameter that leaves the URL is resolved from undefined (to "" by text), and not written back */
  export type ResolvesRemoved = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ navigate: "" }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: {}; entries: 1; values: { q: "" }; errors: 0 },
    ]
  >;

  /** a value that serializes to undefined leaves the URL */
  export type RemovesUndefined = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ set: { q: undefined } }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: {}; entries: 1; values: { q: undefined }; errors: 0 },
    ]
  >;

  /** a value that is not JSON (typed by hand) is read as text, and left as it was written */
  export type ReadsText = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          url: "?q=hello";
          initial: { q: "init" };
          handlers: { q: typeof text };
        },
      ]
    >,
    "=",
    [{ url: { q: "hello" }; entries: 0; values: { q: "hello" }; errors: 0 }]
  >;

  /** a link from when values were percent-encoded twice still reads */
  export type ReadsLegacyLinks = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          url: "?q=%2522hi%2522";
          initial: { q: "init" };
          handlers: { q: typeof text };
        },
      ]
    >,
    "=",
    [{ url: { q: "%22hi%22" }; entries: 0; values: { q: "hi" }; errors: 0 }]
  >;

  /** a value that cannot be read is reported, and the property keeps its value, which replaces it */
  export type ReportsUnreadable = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          url: "?q={oops";
          initial: { q: "init" };
          handlers: {
            q: { resolve: typeof text; deserialize: typeof JSON.parse };
          };
        },
      ]
    >,
    "=",
    [{ url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 1 }]
  >;

  /** an array with entries: "multiple" is written as repeated entries, and read back from them */
  export type RepeatsEntries = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { tags: ["a"] };
          handlers: { tags: { resolve: typeof text; entries: "multiple" } };
          steps: [{ set: { tags: ["a", "b"] } }, { navigate: '?tags="c"' }];
        },
      ]
    >,
    "=",
    [
      { url: { tags: '"a"' }; entries: 0; values: { tags: ["a"] }; errors: 0 },
      {
        url: { tags: ['"a"', '"b"'] };
        entries: 1;
        values: { tags: ["a", "b"] };
        errors: 0;
      },
      { url: { tags: '"c"' }; entries: 2; values: { tags: ["c"] }; errors: 0 },
    ]
  >;

  /** a parameter's key is the prefix, then the handler's key or the property's name */
  export type Keys = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { query: "init"; page: 1 };
          handlers: {
            query: { resolve: typeof text; key: "q" };
            page: typeof count;
          };
          options: { prefix: "app_" };
        },
      ]
    >,
    "=",
    [
      {
        url: { app_q: '"init"'; app_page: "1" };
        entries: 0;
        values: { query: "init"; page: 1 };
        errors: 0;
      },
    ]
  >;

  /** prefix() moves every parameter at once, without a history entry, and later changes follow */
  export type MovesPrefix = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { query: "init"; page: 1 };
          handlers: {
            query: { resolve: typeof text; key: "q" };
            page: typeof count;
          };
          options: { prefix: "a_" };
          steps: [{ prefix: "b_" }, { set: { page: 2 } }];
        },
      ]
    >,
    "=",
    [
      {
        url: { a_q: '"init"'; a_page: "1" };
        entries: 0;
        values: { query: "init"; page: 1 };
        errors: 0;
      },
      {
        url: { b_q: '"init"'; b_page: "1" };
        entries: 0;
        values: { query: "init"; page: 1 };
        errors: 0;
      },
      {
        url: { b_q: '"init"'; b_page: "2" };
        entries: 1;
        values: { query: "init"; page: 2 };
        errors: 0;
      },
    ]
  >;

  /** a prefix getter is followed as what it reads changes */
  export type FollowsPrefixGetter = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          prefixState: "a_";
          steps: [{ setPrefix: "b_" }];
        },
      ]
    >,
    "=",
    [
      { url: { a_q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { b_q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
    ]
  >;

  /** a key can only be tracked once, whether on mount or by moving prefixes */
  export type Conflicts = [
    Throws<
      Invoke<
        typeof session,
        [
          scenario: {
            beside: [{ initial: { q: "other" }; handlers: { q: typeof text } }];
            initial: { q: "init" };
            handlers: { q: typeof text };
          },
        ]
      >,
      'URL parameter key conflict detected: "q"'
    >,
    Throws<
      Invoke<
        typeof session,
        [
          scenario: {
            beside: [
              {
                initial: { q: "other" };
                handlers: { q: typeof text };
                options: { prefix: "b_" };
              },
            ];
            initial: { q: "init" };
            handlers: { q: typeof text };
            options: { prefix: "a_" };
            steps: [{ prefix: "b_" }];
          },
        ]
      >,
      'URL parameter key conflict detected: "b_q"'
    >,
  ];

  /** an old key's value is read, and the old key replaced by the new one, without a history entry */
  export type MigratesKeys = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          url: '?greeting="hi"';
          initial: { hello: "init" };
          handlers: {
            hello: {
              resolve: typeof text;
              previousKeys: [{ fullname: "greeting" }];
            };
          };
        },
      ]
    >,
    "=",
    [{ url: { hello: '"hi"' }; entries: 0; values: { hello: "hi" }; errors: 0 }]
  >;

  /** debounced changes are written once they pause, as one history entry */
  export type Debounces = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: {
            q: {
              resolve: typeof text;
              debounce: { idleMs: 20; maxWaitMs: 200 };
            };
          };
          steps: [{ set: { q: "a" } }, { set: { q: "ab" } }, { wait: 80 }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"init"' }; entries: 0; values: { q: "a" }; errors: 0 },
      { url: { q: '"init"' }; entries: 0; values: { q: "ab" }; errors: 0 },
      { url: { q: '"ab"' }; entries: 1; values: { q: "ab" }; errors: 0 },
    ]
  >;

  /** cleanup removes the parameters, without a history entry, and stops tracking */
  export type CleansUp = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [
            { cleanup: true },
            { set: { q: "a" } },
            { navigate: '?q="b"' },
          ];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: {}; entries: 0; values: { q: "init" }; errors: 0 },
      { url: {}; entries: 0; values: { q: "a" }; errors: 0 },
      { url: { q: '"b"' }; entries: 1; values: { q: "a" }; errors: 0 },
    ]
  >;

  /** objects tracked side by side leave each other alone */
  export type SideBySide = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          beside: [
            { initial: { other: "x" }; handlers: { other: typeof text } },
          ];
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ set: { q: "a" } }];
        },
      ]
    >,
    "=",
    [
      {
        url: { other: '"x"'; q: '"init"' };
        entries: 0;
        values: { q: "init" };
        errors: 0;
      },
      {
        url: { other: '"x"'; q: '"a"' };
        entries: 1;
        values: { q: "a" };
        errors: 0;
      },
    ]
  >;
}

export default Object.assign(URLParameterize, defaults);
