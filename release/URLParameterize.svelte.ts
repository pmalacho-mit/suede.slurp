// @vitest-environment jsdom
import type {
  Expect,
  Invoke,
  Throws,
} from "../suede.nests.slurp/dsl.import.meta.vitest.ts";
import type { count, keys, session, text } from "./_internal/harness.svelte";
import { untrack } from "svelte";
import { isBrowser, resolve, supportsHistory } from "./utils";
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
import {
  type Changes,
  Registry,
  index,
  migrate,
  paramsIn,
  withParams,
} from "./params";

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

    window.addEventListener("popstate", traversed);
    // Changing the hash (a `#…` link, `location.hash = …`, or editing it by hand)
    // fires `hashchange`. Browsers fire `popstate` too, but not all have, and a
    // second announcement of the same URL reads nothing new.
    window.addEventListener("hashchange", traversed);

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

/**
 * The browser moved to another URL (back, forward, a hash change): edits still
 * waiting out their debounce belong to the entry it left, so they are dropped,
 * and the parameters they were for are read again from the URL it arrived at.
 */
const traversed = () => {
  for (const param of debouncer?.pending() ?? []) {
    debouncer!.clear(param);
    registry.invalidate(param);
  }
  URLChangeEvent.emit();
};

/**
 * What the changes made so far in this tick (one event handler's, one flush of
 * effects) did to history. Whatever one action changes goes in one entry: the
 * first change that pushes makes it, and the rest of the tick amend it.
 */
type Tick = {
  pushed: boolean;
  /** parameters whose debounced writes were queued this tick, before the entry was made */
  fresh: Set<string>;
};
let tick: Tick | undefined;
const thisTick = () => {
  if (!tick) {
    tick = { pushed: false, fresh: new Set() };
    queueMicrotask(() => (tick = undefined));
  }
  return tick;
};

/** Where `record` collects changes instead of committing them, while `take` runs. */
let collecting: { changes: Changes; push: boolean } | undefined;

/** Runs the debounced writes `which` picks now, and returns what they change, uncommitted. */
const take = (which: (param: string) => boolean) => {
  const taken = (collecting = { changes: {}, push: false });
  try {
    for (const param of debouncer?.pending() ?? [])
      if (which(param)) debouncer!.flush(param);
  } finally {
    collecting = undefined;
  }
  return taken;
};

/** Writes `changes` to the URL as `behavior` asks, in this tick's history entry. */
const record = (changes: Changes, behavior: UpdateHistoryBehavior) => {
  if (collecting) {
    merge(collecting.changes, changes);
    collecting.push ||= behavior === "push";
    return;
  }
  const now = thisTick();
  if (behavior === "replace" || now.pushed)
    return URLChangeEvent.commit(changes, "replace");
  // Edits still waiting from before this tick were made first: they get an
  // entry of their own, ahead of this one. Those from this tick join it.
  const earlier = take((param) => !now.fresh.has(param));
  URLChangeEvent.commit(earlier.changes, earlier.push ? "push" : "replace");
  const joining = take((param) => now.fresh.has(param));
  merge(changes, joining.changes);
  now.pushed = true;
  URLChangeEvent.commit(changes, "push");
};

/** The current URL's parameters, parsed once however many objects and parameters read them. */
let parsed:
  | { href: string; query: Map<string, string[]>; hash: Map<string, string[]> }
  | undefined;
const current = () => {
  const { href } = window.location;
  if (parsed?.href !== href)
    parsed = {
      href,
      query: index(paramsIn(href, "query")),
      hash: index(paramsIn(href, "hash")),
    };
  return parsed;
};

const merge = (into: Changes, from: Changes) => {
  for (const part of ["query", "hash"] as const)
    if (from[part]) Object.assign((into[part] ??= {}), from[part]);
};

const isEmpty = (changes: Changes) =>
  !Object.values(changes).some((part) => Object.keys(part ?? {}).length > 0);

let debouncer: MappedDebouncer<string> | undefined;
/** Created on first use, since it listens on `window`. */
const debounced = () =>
  (debouncer ??= new MappedDebouncer<string>({ idleMs: 0, maxWaitMs: 0 }));

export type Return<Property extends string = string> = {
  cleanup: () => void;
  prefix: (prefix: string) => void;
  /**
   * The URL parameter a tracked property is stored under now (its prefix
   * included), for reading it from the URL yourself: from `url.searchParams`,
   * or, for a parameter `in: "hash"`, from `new URLSearchParams(url.hash.slice(1))`.
   */
  key(property: Property): string;
};

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
/** The properties a call tracks, or any string when its handlers' keys are not known (in generic code, say). */
type Tracked<Handlers> = [keyof Handlers & string] extends [never]
  ? string
  : keyof Handlers & string;

const URLParameterize = <
  T extends object,
  Handlers extends Partial<ParameterHandlers<T>> = Partial<
    ParameterHandlers<T>
  >,
>(
  target: T,
  handlers: Handlers,
  options?: Options,
): Return<Tracked<Handlers>> => {
  type Key = keyof Handlers & string;

  /** The key a property is stored under with the prefix it started with. */
  const initialKey = (property: Key) => {
    const handler = handlers[property];
    if (!handler)
      throw new Error(`URLParameterize: "${property}" is not tracked`);
    return keyOf(handler, property, resolve(options?.prefix, ""));
  };

  if (!URLChangeEvent.setupListener()) {
    if (isBrowser)
      console.error("History API not supported; URLParameterize disabled");
    return {
      cleanup: () => {},
      prefix: () => {},
      key: initialKey,
    };
  }

  const paramByKey = new Map<Key, string>();
  /** Bumped when the parameters move, so that `key` is reactive. */
  let moves = $state(0);
  const value = (key: Key) => (target as Record<string, unknown>)[key];

  const onURLChange = () =>
    untrack(() => {
      const params = current();
      for (const [key, param] of paramByKey) {
        const handler = registry.handler(param);
        if (handler) registry.read(params[handler.in], target, key, param);
      }
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
      record({ [handler.in]: { [param]: encoded } }, behavior);
  };

  const setup = (key: Key) => {
    const handler = verbosify(handlers[key]!, key, options);
    registry.register(handler);
    paramByKey.set(key, handler.key);

    const removals = migrate(window.location.href, target, key, handler);
    registry.read(current()[handler.in], target, key, handler.key);

    // The initial value, to be written with every other property's at once.
    const initial: Changes = {};
    const encoded = parameterize(
      untrack(() => value(key)),
      handler,
    );
    if (registry.write(handler.key, encoded))
      initial[handler.in] = { [handler.key]: encoded };

    const debounce =
      handler.debounce === false
        ? undefined
        : (handler.debounce ?? options?.debounce);

    let first = true;
    $effect(() => {
      const encoded = parameterize(value(key), handler); // tracks everything the URL is written from
      const param = paramByKey.get(key)!;
      if (first) {
        // Written at setup; this only catches a change made in between.
        first = false;
        write(key, "replace");
      } else if (!debounce) write(key, handler.history);
      else if (thisTick().pushed)
        // this tick's change already has an entry: it goes in with the rest
        write(key, handler.history);
      else if (registry.synced(param, encoded))
        // back to what the URL holds (it was just read from it, say): nothing to write
        debouncer?.clear(param);
      else {
        thisTick().fresh.add(param);
        debounced().enqueue(param, () => write(key, handler.history), debounce);
      }
    });
    return { removals, initial };
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
        const handler = registry.handler(from)!;
        (changes[handler.in] ??= {})[from] = undefined;
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
      (changes[handler.in] ??= {})[to] = encoded;
    }
    moves++;
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
      const handler = registry.handler(param);
      if (handler) (removals[handler.in] ??= {})[param] = undefined;
      registry.unregister(param);
    }
    paramByKey.clear();
    URLChangeEvent.commit(removals, "replace");
  };

  const cleanup = $effect.root(() => {
    // Writing the initial values is not a navigation: one change to the URL,
    // replacing the current entry (or pushed, if an old key asks to be removed
    // with a history entry of its own).
    const changes: Changes = {};
    let push = false;
    for (const key in handlers) {
      const { removals, initial } = setup(key as Key);
      push ||= !isEmpty(removals.push);
      merge(changes, removals.push);
      merge(changes, removals.replace);
      merge(changes, initial);
    }
    URLChangeEvent.commit(changes, push ? "push" : "replace");
    trySetupPrefixEffect();
    return dispose;
  });

  options?.onDestroy?.(cleanup);

  return {
    cleanup,
    prefix: updatePrefix,
    key: (property) => {
      moves; // read, so that markup and effects follow a moving prefix
      return paramByKey.get(property as Key) ?? initialKey(property as Key);
    },
  };
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

  /** what one action changes is one history entry, and back undoes all of it */
  export type OneActionOneEntry = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { a: "a0"; b: "b0" };
          handlers: { a: typeof text; b: typeof text };
          steps: [{ set: { a: "a1"; b: "b1" } }, { back: true }];
        },
      ]
    >,
    "=",
    [
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 0;
        values: { a: "a0"; b: "b0" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b1"' };
        entries: 1;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 1;
        values: { a: "a0"; b: "b0" };
        errors: 0;
      },
    ]
  >;

  /** a debounced change made in the same action as one that is not is written with it, at once */
  export type DebouncedJoinsItsAction = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { a: "a0"; b: "b0" };
          handlers: {
            a: typeof text;
            b: {
              resolve: typeof text;
              debounce: { idleMs: 20; maxWaitMs: 200 };
            };
          };
          steps: [{ set: { a: "a1"; b: "b1" } }, { wait: 80 }];
        },
      ]
    >,
    "=",
    [
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 0;
        values: { a: "a0"; b: "b0" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b1"' };
        entries: 1;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b1"' };
        entries: 1;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
    ]
  >;

  /** the same, with the debounced property's change seen first */
  export type DebouncedFirstJoinsItsAction = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { a: "a0"; b: "b0" };
          handlers: {
            b: {
              resolve: typeof text;
              debounce: { idleMs: 20; maxWaitMs: 200 };
            };
            a: typeof text;
          };
          steps: [{ set: { a: "a1"; b: "b1" } }, { wait: 80 }];
        },
      ]
    >,
    "=",
    [
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 0;
        values: { a: "a0"; b: "b0" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b1"' };
        entries: 1;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b1"' };
        entries: 1;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
    ]
  >;

  /** a debounced change still waiting when a later one is written goes first, in an entry of its own */
  export type EarlierChangeFirst = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { a: "a0"; b: "b0" };
          handlers: {
            a: typeof text;
            b: {
              resolve: typeof text;
              debounce: { idleMs: 20; maxWaitMs: 200 };
            };
          };
          steps: [{ set: { b: "b1" } }, { set: { a: "a1" } }, { back: true }];
        },
      ]
    >,
    "=",
    [
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 0;
        values: { a: "a0"; b: "b0" };
        errors: 0;
      },
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 0;
        values: { a: "a0"; b: "b1" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b1"' };
        entries: 2;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
      {
        url: { a: '"a0"'; b: '"b1"' };
        entries: 2;
        values: { a: "a0"; b: "b1" };
        errors: 0;
      },
    ]
  >;

  /** back drops a debounced change still waiting: the URL's value is read instead, and forward is kept */
  export type BackDropsWaitingChange = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { a: "a0"; b: "b0" };
          handlers: {
            a: typeof text;
            b: {
              resolve: typeof text;
              debounce: { idleMs: 20; maxWaitMs: 200 };
            };
          };
          steps: [
            { set: { a: "a1" } },
            { set: { b: "b1" } },
            { back: true },
            { wait: 80 },
            { forward: true },
          ];
        },
      ]
    >,
    "=",
    [
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 0;
        values: { a: "a0"; b: "b0" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b0"' };
        entries: 1;
        values: { a: "a1"; b: "b0" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b0"' };
        entries: 1;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 1;
        values: { a: "a0"; b: "b0" };
        errors: 0;
      },
      {
        url: { a: '"a0"'; b: '"b0"' };
        entries: 1;
        values: { a: "a0"; b: "b0" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b0"' };
        entries: 1;
        values: { a: "a1"; b: "b0" };
        errors: 0;
      },
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

  /** with in: "hash", a parameter is stored in the URL's hash */
  export type StoresInTheHash = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: { resolve: typeof text; in: "hash" } };
          steps: [{ set: { q: "a" } }];
        },
      ]
    >,
    "=",
    [
      { url: { "#q": '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { "#q": '"a"' }; entries: 1; values: { q: "a" }; errors: 0 },
    ]
  >;

  /** in: "hash" in the options stores the whole object there, but for handlers of its own mind; the URL's other parameters stay */
  export type ObjectInTheHash = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          url: "?keep=1#other=x";
          initial: { tab: "home"; page: 1 };
          handlers: {
            tab: typeof text;
            page: { resolve: typeof count; in: "query" };
          };
          options: { in: "hash" };
        },
      ]
    >,
    "=",
    [
      {
        url: { keep: "1"; page: "1"; "#other": "x"; "#tab": '"home"' };
        entries: 0;
        values: { tab: "home"; page: 1 };
        errors: 0;
      },
    ]
  >;

  /** changing the hash (a #… link, location.hash = …) fires hashchange, which is read; back undoes it */
  export type FollowsHashChange = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: { resolve: typeof text; in: "hash" } };
          steps: [{ hash: 'q="typed"' }, { back: true }];
        },
      ]
    >,
    "=",
    [
      { url: { "#q": '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      {
        url: { "#q": '"typed"' };
        entries: 1;
        values: { q: "typed" };
        errors: 0;
      },
      { url: { "#q": '"init"' }; entries: 1; values: { q: "init" }; errors: 0 },
    ]
  >;

  /** a hash change announced only by hashchange (no popstate) is read too */
  export type ListensForHashChange = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: { resolve: typeof text; in: "hash" } };
          steps: [{ hash: 'q="typed"'; popstate: false }];
        },
      ]
    >,
    "=",
    [
      { url: { "#q": '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      {
        url: { "#q": '"typed"' };
        entries: 1;
        values: { q: "typed" };
        errors: 0;
      },
    ]
  >;

  /** a parameter moved to the hash still reads links that have it in the query, and moves it */
  export type MovesToTheHash = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          url: '?q="old"';
          initial: { q: "init" };
          handlers: {
            q: {
              resolve: typeof text;
              in: "hash";
              previousKeys: [{ fullname: "q"; in: "query" }];
            };
          };
        },
      ]
    >,
    "=",
    [{ url: { "#q": '"old"' }; entries: 0; values: { q: "old" }; errors: 0 }]
  >;

  /** key tells a tracked property's parameter, its prefix included, as the prefix moves */
  export type Key = Expect<
    Invoke<
      typeof keys,
      [
        scenario: {
          initial: { query: "init"; page: 1 };
          handlers: {
            query: { resolve: typeof text; key: "q" };
            page: typeof count;
          };
          options: { prefix: "a_" };
          steps: [{ prefix: "b_" }];
        },
      ]
    >,
    "=",
    [{ query: "a_q"; page: "a_page" }, { query: "b_q"; page: "b_page" }]
  >;
}

export default Object.assign(URLParameterize, defaults);
