// @vitest-environment jsdom
import type {
  Expect,
  Invoke,
  Throws,
} from "../suede.nests.slurp/dsl.import.meta.vitest.ts";
import type {
  afterConflict,
  count,
  historyState,
  keys,
  object,
  rendered,
  session,
  strict,
  text,
  writes,
} from "./_internal/harness.svelte";
import { untrack } from "svelte";
import { isBrowser, resolve, supportsHistory } from "./utils";
import { MappedDebouncer } from "./debounce";
import {
  type Options,
  type ParameterHandlers,
  type URLPart,
  type UpdateHistoryBehavior,
  type AnyParameterHandler,
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

/**
 * Set on `history` once it is patched, by whichever copy of this module got
 * there first (a hot reload, or two versions in one bundle), so that it is
 * patched once and every copy hears the same announcements.
 */
const patched = Symbol.for("URLParameterize.patched");

const URLChangeEvent = {
  key: "urlchange",

  /** Fired before pushState or replaceState changes the URL. */
  before: "urlchange:before",

  /** Announces the URL the browser moved to (a `detail` of "history": changed by pushState or replaceState). */
  emit: (detail?: "history") =>
    window.dispatchEvent(new CustomEvent(URLChangeEvent.key, { detail })),

  setupComplete: false,

  /** Patches the History API so that every change to the URL is announced. */
  setupListener: (): boolean => {
    if (URLChangeEvent.setupComplete) return true;
    if (!supportsHistory) return false;

    if (!(patched in history)) {
      const announce = (change: History["pushState"]) =>
        function (this: History, ...args: Parameters<History["pushState"]>) {
          window.dispatchEvent(new CustomEvent(URLChangeEvent.before));
          change.apply(this, args);
          URLChangeEvent.emit("history");
        };
      history.pushState = announce(history.pushState);
      history.replaceState = announce(history.replaceState);
      Object.defineProperty(history, patched, { value: true });
    }

    // Changes still waiting for the end of this tick were made before the
    // call: they go first, so that history keeps the order of things.
    window.addEventListener(URLChangeEvent.before, settle);
    window.addEventListener(URLChangeEvent.key, moved);
    window.addEventListener("popstate", traversed);
    // Changing the hash (a `#…` link, `location.hash = …`, or editing it by hand)
    // fires `hashchange`. Browsers fire `popstate` too, but not all have, and a
    // second announcement of the same URL reads nothing new.
    window.addEventListener("hashchange", traversed);

    entries = history.length;
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

/** `history.length` when the URL last changed: a hash change that grows it added an entry. */
let entries = 0;
/** The URL the browser last arrived at, so that its second announcement (`popstate`, then `hashchange`) is not taken for another move. */
let arrived: string | undefined;

const moved = (event: Event) => {
  if ((event as CustomEvent).detail !== "history") return;
  entries = history.length;
  arrived = undefined;
};

/**
 * The browser moved to another URL, which pushState and replaceState do not
 * announce. Back and forward move between entries, and edits still waiting
 * out their debounce belong to the entry left: they are dropped, and the
 * parameters they were for are read again from the URL arrived at. A link
 * (`#…`) adds an entry instead, and they stay waiting, to be written to it.
 * Past its cap (50 entries in most browsers) `history.length` stops growing,
 * and a link is then taken for a move between entries.
 */
const traversed = () => {
  if (location.href !== arrived) {
    arrived = location.href;
    const added = history.length > entries;
    entries = history.length;
    if (!added)
      for (const param of debouncer?.pending() ?? []) {
        debouncer!.clear(param);
        registry.invalidate(param);
      }
  }
  URLChangeEvent.emit();
};

/**
 * The changes made in this tick (one event handler's, one flush of effects),
 * to be written at its end, as one call to the History API: whatever one
 * action changes is one history entry, however many properties it touches.
 */
type Tick = {
  changes: Changes;
  push: boolean;
  /** parameters whose debounced writes were queued this tick */
  fresh: Set<string>;
};
let tick: Tick | undefined;
const thisTick = () => {
  if (!tick) {
    tick = { changes: {}, push: false, fresh: new Set() };
    queueMicrotask(settle);
  }
  return tick;
};

/** Writes this tick's changes to the URL, now. */
const settle = () => {
  const now = tick;
  if (!now) return;
  tick = undefined;
  if (now.push) {
    // Edits still waiting from before this tick were made first: they get an
    // entry of their own, ahead of this one. Those from this tick join it.
    const earlier = take((param) => !now.fresh.has(param));
    URLChangeEvent.commit(earlier.changes, earlier.push ? "push" : "replace");
    merge(now.changes, take((param) => now.fresh.has(param)).changes);
  }
  URLChangeEvent.commit(now.changes, now.push ? "push" : "replace");
};

/** Drops a change to `param` not yet written: it is leaving the URL, or moving. */
const forget = (param: string, part: URLPart) => {
  delete tick?.changes[part]?.[param];
};

/** Where `record` collects changes instead, while `take` runs. */
let collecting: Pick<Tick, "changes" | "push"> | undefined;

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

/** Adds `changes` to what this tick writes to the URL. */
const record = (changes: Changes, behavior: UpdateHistoryBehavior) => {
  const into = collecting ?? thisTick();
  merge(into.changes, changes);
  into.push ||= behavior === "push";
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

  // Every key is checked before any is taken, so that a conflict leaves nothing behind.
  const verbose = new Map<Key, AnyParameterHandler>();
  for (const key in handlers)
    verbose.set(key as Key, verbosify(handlers[key]!, key, options));
  const params = [...verbose.values()].map((handler) => handler.key);
  params.forEach((param, index) => {
    if (registry.has(param) || params.indexOf(param) !== index)
      throw new Error(`URL parameter key conflict detected: "${param}"`);
  });

  const paramByKey = new Map<Key, string>();
  /** The path the parameters were last written on: once the URL is another page's, they are not this instance's to remove. */
  let path = location.pathname;
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
    if (!registry.write(param, encoded)) return;
    record({ [handler.in]: { [param]: encoded } }, behavior);
    path = location.pathname;
  };

  const setup = (key: Key) => {
    const handler = verbose.get(key)!;
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
      else if (thisTick().push)
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
        forget(from, handler.in);
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
      const encoded = parameterize(
        untrack(() => value(key)),
        handler,
      );
      registry.write(to, encoded);
      (changes[handler.in] ??= {})[to] = encoded;
    }
    moves++;
    URLChangeEvent.commit(changes, "replace");
    path = location.pathname;
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
      if (handler) {
        forget(param, handler.in);
        (removals[handler.in] ??= {})[param] = undefined;
      }
      registry.unregister(param);
    }
    paramByKey.clear();
    if (location.pathname === path) URLChangeEvent.commit(removals, "replace");
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

  // Mounting, and what one action writes

  /** every initial value is written at mount in one call to the History API */
  export type MountsInOneCall = Expect<
    Invoke<
      typeof writes,
      [
        scenario: {
          url: '?a="from-url"';
          initial: { a: "x"; b: "y"; c: "z" };
          handlers: { a: typeof text; b: typeof text; c: typeof text };
        },
      ]
    >,
    "=",
    [1]
  >;

  /** an action that changes several properties is one call to the History API */
  export type OneActionOneCall = Expect<
    Invoke<
      typeof writes,
      [
        scenario: {
          initial: { a: "x"; b: "y"; c: "z" };
          handlers: { a: typeof text; b: typeof text; c: typeof text };
          steps: [{ set: { a: "1"; b: "2"; c: "3" } }];
        },
      ]
    >,
    "=",
    [1, 1]
  >;

  /** assigning a property the value it has writes nothing */
  export type UnchangedNotWritten = Expect<
    Invoke<
      typeof writes,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ set: { q: "init" } }];
        },
      ]
    >,
    "=",
    [1, 0]
  >;

  /** one action that changes objects tracked side by side is one history entry too */
  export type SideBySideOneEntry = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          beside: [
            { initial: { other: "x" }; handlers: { other: typeof text } },
          ];
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ set: { q: "a" }; beside: { other: "y" } }, { back: true }];
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
        url: { other: '"y"'; q: '"a"' };
        entries: 1;
        values: { q: "a" };
        errors: 0;
      },
      {
        url: { other: '"x"'; q: '"init"' };
        entries: 1;
        values: { q: "init" };
        errors: 0;
      },
    ]
  >;

  /** changing what a property holds (pushing onto its array, assigning into its object) is written too */
  export type WritesDeepChanges = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { tags: ["a"]; filter: { min: 1; max: 5 } };
          handlers: {
            tags: { entries: "multiple"; resolve: typeof text };
            filter: typeof object;
          };
          steps: [
            { append: { tags: "b" } },
            { merge: { filter: { max: 9 } } },
            { back: true },
          ];
        },
      ]
    >,
    "=",
    [
      {
        url: { tags: '"a"'; filter: '{"min":1,"max":5}' };
        entries: 0;
        values: { tags: ["a"]; filter: { min: 1; max: 5 } };
        errors: 0;
      },
      {
        url: { tags: ['"a"', '"b"']; filter: '{"min":1,"max":5}' };
        entries: 1;
        values: { tags: ["a", "b"]; filter: { min: 1; max: 5 } };
        errors: 0;
      },
      {
        url: { tags: ['"a"', '"b"']; filter: '{"min":1,"max":9}' };
        entries: 2;
        values: { tags: ["a", "b"]; filter: { min: 1; max: 9 } };
        errors: 0;
      },
      {
        url: { tags: ['"a"', '"b"']; filter: '{"min":1,"max":5}' };
        entries: 2;
        values: { tags: ["a", "b"]; filter: { min: 1; max: 5 } };
        errors: 0;
      },
    ]
  >;

  /** code that pushes a URL in the same action as a change goes after it: the change keeps an entry of its own */
  export type OthersGoAfter = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ set: { q: "a" }; thenNavigate: '?q="b"' }, { back: true }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"b"' }; entries: 2; values: { q: "b" }; errors: 0 },
      { url: { q: '"a"' }; entries: 2; values: { q: "a" }; errors: 0 },
    ]
  >;

  /** replacing an entry keeps the history state other code (a router) keeps there */
  export type KeepsHistoryState = Expect<
    Invoke<
      typeof historyState,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: { resolve: typeof text; history: "replace" } };
          steps: [
            { navigate: "?other=1"; state: { page: 1 } },
            { set: { q: "a" } },
          ];
        },
      ]
    >,
    "=",
    [null, { page: 1 }, { page: 1 }]
  >;

  // Reading

  /** one entry of several that cannot be read leaves the whole property as it was, and nothing is written back */
  export type ReadsEntriesAtomically = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { nums: [1, 2, 3] };
          handlers: { nums: { entries: "multiple"; resolve: typeof strict } };
          steps: [{ navigate: "?nums=7&nums=x&nums=9" }];
        },
      ]
    >,
    "=",
    [
      {
        url: { nums: ["1", "2", "3"] };
        entries: 0;
        values: { nums: [1, 2, 3] };
        errors: 0;
      },
      {
        url: { nums: ["7", "x", "9"] };
        entries: 1;
        values: { nums: [1, 2, 3] };
        errors: 1;
      },
    ]
  >;

  /** an array read from the URL is assigned, so markup sees it whether the property is $state or $state.raw */
  export type ReadsIntoRawState = [
    Expect<
      Invoke<
        typeof rendered,
        [
          scenario: {
            raw: true;
            initial: { tags: ["a"] };
            handlers: { tags: { entries: "multiple"; resolve: typeof text } };
            steps: [
              { navigate: '?tags="x"&tags="y"' },
              { set: { tags: ["z"] } },
              { back: true },
            ];
          },
        ]
      >,
      "=",
      [[["a"]], [["x", "y"]], [["z"]], [["x", "y"]]]
    >,
  ];

  // Debouncing

  /** the options' debounce applies to every handler, and debounce: false opts one out */
  export type GlobalDebounce = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { a: "a0"; b: "b0" };
          handlers: {
            a: typeof text;
            b: { resolve: typeof text; debounce: false };
          };
          options: { debounce: { idleMs: 20; maxWaitMs: 200 } };
          steps: [{ set: { b: "b1" } }, { set: { a: "a1" } }, { wait: 80 }];
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
        url: { a: '"a0"'; b: '"b1"' };
        entries: 1;
        values: { a: "a0"; b: "b1" };
        errors: 0;
      },
      {
        url: { a: '"a0"'; b: '"b1"' };
        entries: 1;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
      {
        url: { a: '"a1"'; b: '"b1"' };
        entries: 2;
        values: { a: "a1"; b: "b1" };
        errors: 0;
      },
    ]
  >;

  /** a debounced change undone before it is written writes nothing */
  export type UndoneBeforeWritten = Expect<
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
          steps: [{ set: { q: "a" } }, { set: { q: "init" } }, { wait: 80 }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"init"' }; entries: 0; values: { q: "a" }; errors: 0 },
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
    ]
  >;

  /** a link (#…) followed while a debounced change waits keeps it: it is written to the entry the link added */
  export type LinkKeepsWaitingChange = Expect<
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
          steps: [{ set: { q: "typed" } }, { hash: "section" }, { wait: 80 }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"init"' }; entries: 0; values: { q: "typed" }; errors: 0 },
      {
        url: { q: '"init"'; "#section": "" };
        entries: 1;
        values: { q: "typed" };
        errors: 0;
      },
      {
        url: { q: '"typed"'; "#section": "" };
        entries: 2;
        values: { q: "typed" };
        errors: 0;
      },
    ]
  >;

  /** leaving the page writes a debounced change at once */
  export type LeavingWrites = Expect<
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
          steps: [{ set: { q: "a" } }, { dispatch: "pagehide" }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"init"' }; entries: 0; values: { q: "a" }; errors: 0 },
      { url: { q: '"a"' }; entries: 1; values: { q: "a" }; errors: 0 },
    ]
  >;

  /** a debounced change waiting when the prefix moves is written under the new key, and the old key is not brought back */
  export type PrefixTakesWaitingChange = Expect<
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
          steps: [{ set: { q: "a" } }, { prefix: "v2_" }, { wait: 80 }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: { q: '"init"' }; entries: 0; values: { q: "a" }; errors: 0 },
      { url: { v2_q: '"a"' }; entries: 0; values: { q: "a" }; errors: 0 },
      { url: { v2_q: '"a"' }; entries: 0; values: { q: "a" }; errors: 0 },
    ]
  >;

  // Cleaning up

  /** cleanup drops a change not yet written, whether waiting out a debounce or made in the same action; calling it again does nothing */
  export type CleanupDropsWaitingChanges = [
    Expect<
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
            steps: [
              { set: { q: "a" } },
              { cleanup: true },
              { wait: 80 },
              { cleanup: true },
            ];
          },
        ]
      >,
      "=",
      [
        { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
        { url: { q: '"init"' }; entries: 0; values: { q: "a" }; errors: 0 },
        { url: {}; entries: 0; values: { q: "a" }; errors: 0 },
        { url: {}; entries: 0; values: { q: "a" }; errors: 0 },
        { url: {}; entries: 0; values: { q: "a" }; errors: 0 },
      ]
    >,
  ];

  /** cleanup made in the same action as a change: nothing is written, and no entry is added */
  export type CleanupInTheSameAction = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ set: { q: "a" }; thenCleanup: true }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      { url: {}; entries: 0; values: { q: "a" }; errors: 0 },
    ]
  >;

  /** cleanup once the URL is another page's (a router navigated, then unmounted) leaves that page's parameters alone */
  export type CleanupLeavesOtherPages = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { q: "init" };
          handlers: { q: typeof text };
          steps: [{ navigate: '/elsewhere?q="theirs"' }, { cleanup: true }];
        },
      ]
    >,
    "=",
    [
      { url: { q: '"init"' }; entries: 0; values: { q: "init" }; errors: 0 },
      {
        url: { q: '"theirs"' };
        entries: 1;
        values: { q: "theirs" };
        errors: 0;
      },
      {
        url: { q: '"theirs"' };
        entries: 1;
        values: { q: "theirs" };
        errors: 0;
      },
    ]
  >;

  // Conflicts

  /** a conflict on mount leaves nothing behind: once the holder is cleaned up, every key is free */
  export type ConflictLeavesNothing = Expect<
    Invoke<
      typeof afterConflict,
      [
        scenario: {
          holder: { initial: { b: "x" }; handlers: { b: typeof text } };
          conflicting: {
            initial: { a: "y"; b: "y" };
            handlers: { a: typeof text; b: typeof text };
          };
          retry: { initial: { a: "z" }; handlers: { a: typeof text } };
        },
      ]
    >,
    "=",
    {
      error: 'URL parameter key conflict detected: "b"';
      retried: { a: '"z"' };
    }
  >;

  /** two properties of one object stored under the same key conflict too */
  export type ConflictsWithinACall = Throws<
    Invoke<
      typeof session,
      [
        scenario: {
          initial: { a: "x"; b: "y" };
          handlers: {
            a: { resolve: typeof text; key: "q" };
            b: { resolve: typeof text; key: "q" };
          };
        },
      ]
    >,
    'URL parameter key conflict detected: "q"'
  >;

  // Migration

  /** an old key removed with behavior: "push" is removed in a history entry of its own */
  export type MigratesWithAnEntry = Expect<
    Invoke<
      typeof session,
      [
        scenario: {
          url: '?greeting="hi"';
          initial: { hello: "x" };
          handlers: {
            hello: {
              resolve: typeof text;
              previousKeys: [{ fullname: "greeting"; behavior: "push" }];
            };
          };
        },
      ]
    >,
    "=",
    [{ url: { hello: '"hi"' }; entries: 1; values: { hello: "hi" }; errors: 0 }]
  >;
}

export default Object.assign(URLParameterize, defaults);
