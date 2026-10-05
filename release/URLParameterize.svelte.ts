import type {
  Expect,
  Invoke,
} from "../suede.nests.slurp/dsl.import.meta.vitest.ts";
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

export type {
  Options,
  ParameterHandler,
  ParameterHandlers,
} from "./handlers";
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

declare namespace URLParameterize {
  /** outside a browser (on a server, say) it does nothing, and importing it does not throw */
  type Returned = Invoke<
    typeof URLParameterize,
    [target: { page: 1 }, handlers: { page: typeof Number }]
  >;

  /** outside a browser (on a server, say) importing and calling it does not throw, and does nothing */
  export type NoOpOutsideABrowser = [
    Expect<Returned, "hasKey", "cleanup">,
    Expect<Invoke<Returned["cleanup"]>, "undefined">,
    Expect<Invoke<Returned["prefix"], [prefix: "v2_"]>, "undefined">,
  ];
}

export default Object.assign(URLParameterize, defaults);
