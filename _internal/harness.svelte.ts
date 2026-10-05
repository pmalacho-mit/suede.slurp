// Harnesses for the namespace tests beside the modules they exercise. A test
// can only say what a type can (literals and calls), so what needs runes,
// timers or awaiting is played out here, and the tests describe it as data.
//
// The modules that use these run under jsdom (`// @vitest-environment jsdom`)
// and Svelte's `browser` export condition, so that effects run.
import { flushSync } from "svelte";
import { onTestFinished, vi } from "vitest";
import URLParameterize from "../URLParameterize.svelte";
import { MappedDebouncer, type Config } from "../debounce";
import type { Options, ParameterHandler } from "../handlers";

/** A resolver for text: anything that is not a string is "". */
export const text = (query: unknown) =>
  typeof query === "string" ? query : "";

/** A resolver for counts: anything that is not a number is 0. */
export const count = (query: unknown) =>
  typeof query === "number" ? query : 0;

type Instance = {
  /** the tracked object's properties, made `$state` */
  initial: Record<string, unknown>;
  handlers: Record<string, ParameterHandler<any>>;
  options?: Options;
};

export type Scenario = Instance & {
  /** the URL's search when tracking starts */
  url?: string;
  /** when given, the prefix is a getter of state that starts here, and `setPrefix` steps change it */
  prefixState?: string;
  /** other objects, tracked before this one */
  beside?: Instance[];
  steps?: Step[];
};

export type Step =
  /** assign to the tracked object */
  | { set: Record<string, unknown> }
  /** push a URL with this search, as a link or other code would */
  | { navigate: string }
  /** set `location.hash`, as a `#…` link or someone editing the address bar would, and wait for `hashchange` */
  | {
      hash: string;
      /** false: as a browser that announces it with `hashchange` alone */
      popstate?: false;
    }
  /** the browser's back and forward buttons */
  | { back: true }
  | { forward: true }
  /** let this many milliseconds pass */
  | { wait: number }
  /** call the `prefix` function URLParameterize returned */
  | { prefix: string }
  /** change the state the prefix getter reads */
  | { setPrefix: string }
  /** call the `cleanup` function URLParameterize returned */
  | { cleanup: true };

export type Observation = {
  /** the URL's parameters, those in the hash keyed with a `#`: one value as a string, repeated ones as an array */
  url: Record<string, string | string[]>;
  /** history entries added since tracking started */
  entries: number;
  /** the tracked object's values */
  values: Record<string, unknown>;
  /** errors reported (with console.error) so far */
  errors: number;
};

const urlParams = () => {
  const url: Observation["url"] = {};
  const { search, hash } = new URL(location.href);
  for (const [params, prefix] of [
    [search, ""],
    [hash.slice(1), "#"],
  ] as const) {
    const parsed = new URLSearchParams(params);
    for (const key of new Set(parsed.keys())) {
      const all = parsed.getAll(key);
      url[prefix + key] = all.length === 1 ? all[0] : all;
    }
  }
  return url;
};

/** Resolves on the next `event` on `window` that `accept`s. */
const next = <E extends Event>(
  type: string,
  accept: (event: E) => boolean = () => true,
) =>
  new Promise<void>((resolve) => {
    const listener = (event: Event) => {
      if (!accept(event as E)) return;
      window.removeEventListener(type, listener);
      resolve();
    };
    window.addEventListener(type, listener);
  });

const changeHash = async (hash: string, popstate = true) => {
  const silence = (event: Event) => event.stopImmediatePropagation();
  if (!popstate)
    window.addEventListener("popstate", silence, { capture: true });
  location.hash = hash;
  // the hashchange of this change, not one still queued from an earlier one
  const href = location.href;
  await next<HashChangeEvent>("hashchange", (event) => event.newURL === href);
  window.removeEventListener("popstate", silence, { capture: true });
};

const traverse = async (direction: "back" | "forward") => {
  const { hash } = location;
  // crossing a hash change, the browser announces it with hashchange too, as soon as popstate
  const changed: string[] = [];
  const record = (event: HashChangeEvent) => void changed.push(event.newURL);
  window.addEventListener("hashchange", record);
  const popped = next("popstate");
  history[direction]();
  await popped;
  const href = location.href;
  if (location.hash !== hash && !changed.includes(href))
    await next<HashChangeEvent>("hashchange", (event) => event.newURL === href);
  window.removeEventListener("hashchange", record);
};

type Tracked = ReturnType<typeof URLParameterize<Record<string, any>>>;

/**
 * Tracks `scenario.initial` with URLParameterize in a URL whose search (and
 * hash) is `scenario.url`, then plays the steps. Returns what `observe` saw
 * once tracking started, and after each step.
 */
const play = async <Seen>(
  scenario: Scenario,
  observe: (seen: {
    target: Record<string, any>;
    tracked: Tracked;
    start: number;
    errors: number;
  }) => Seen,
): Promise<Seen[]> => {
  // pushed, not replaced: it drops any forward entries an earlier session left,
  // so that history.length counts the entries this one adds
  history.pushState(null, "", `/${scenario.url ?? ""}`);
  const start = history.length;
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const cleanups: (() => void)[] = [];
  onTestFinished(() => {
    for (const cleanup of cleanups) cleanup();
    errors.mockRestore();
    history.replaceState(null, "", "/");
  });

  const track = ({ initial, handlers, options }: Instance) => {
    const target: Record<string, any> = $state({ ...initial });
    const tracked = URLParameterize(target, handlers, options);
    cleanups.push(tracked.cleanup);
    return { target, tracked };
  };

  for (const instance of scenario.beside ?? []) track(instance);

  let prefix = $state(scenario.prefixState ?? "");
  const { target, tracked } = track({
    ...scenario,
    options:
      scenario.prefixState === undefined
        ? scenario.options
        : { ...scenario.options, prefix: () => prefix },
  });

  const look = () => {
    flushSync();
    return observe({
      target,
      tracked,
      start,
      errors: errors.mock.calls.length,
    });
  };

  const observations = [look()];
  for (const step of scenario.steps ?? []) {
    // each step a separate action, as a click or a keystroke is: in a tick of its own
    await Promise.resolve();
    if ("set" in step) Object.assign(target, step.set);
    else if ("navigate" in step)
      history.pushState({}, "", step.navigate || "?");
    else if ("hash" in step) await changeHash(step.hash, step.popstate);
    else if ("back" in step) await traverse("back");
    else if ("forward" in step) await traverse("forward");
    else if ("wait" in step)
      await new Promise((resolve) => setTimeout(resolve, step.wait));
    else if ("prefix" in step) tracked.prefix(step.prefix);
    else if ("setPrefix" in step) prefix = step.setPrefix;
    else tracked.cleanup();
    observations.push(look());
  }
  return observations;
};

/** What the URL, the history and the tracked object were, once tracking started and after each step. */
export const session = (scenario: Scenario) =>
  play(
    scenario,
    ({ target, start, errors }): Observation => ({
      url: urlParams(),
      entries: history.length - start,
      values: $state.snapshot(target),
      errors,
    }),
  );

/** What `key` returned for each tracked property, once tracking started and after each step. */
export const keys = (scenario: Scenario) => {
  // Read through a $derived, as markup would: it only updates if key is reactive.
  let seen: { readonly current: Record<string, string> } | undefined;
  return play(scenario, ({ tracked }) => {
    seen ??= derived(() =>
      Object.fromEntries(
        Object.keys(scenario.handlers).map((property) => [
          property,
          tracked.key(property),
        ]),
      ),
    );
    return seen.current;
  });
};

const derived = <T>(compute: () => T) => {
  const value = $derived(compute());
  return {
    get current() {
      return value;
    },
  };
};

export type TimelineStep =
  | { at: number; enqueue: string; config?: Config }
  | { at: number; clear: string }
  | { at: number; dispatch: "visibilitychange" | "pagehide" | "beforeunload" }
  | { at: number; dispose: true };

export type Flush = { at: number; key: string; step: number };

/**
 * Plays `steps` against a `MappedDebouncer` on fake timers, each at its time in
 * milliseconds, then lets every pending timer run. Returns each callback that
 * ran: when, under which key, and the index of the step that enqueued it.
 */
export const timeline = (config: Config, steps: TimelineStep[]): Flush[] => {
  vi.useFakeTimers();
  onTestFinished(() => void vi.useRealTimers());

  const debouncer = new MappedDebouncer<string>(config);
  const flushes: Flush[] = [];
  const start = Date.now();
  const now = () => Date.now() - start;

  steps.forEach((step, index) => {
    vi.advanceTimersByTime(step.at - now());
    if ("enqueue" in step)
      debouncer.enqueue(
        step.enqueue,
        () => flushes.push({ at: now(), key: step.enqueue, step: index }),
        step.config,
      );
    else if ("clear" in step) debouncer.clear(step.clear);
    else if ("dispatch" in step) window.dispatchEvent(new Event(step.dispatch));
    else debouncer.dispose();
  });

  vi.runAllTimers();
  debouncer.dispose();
  return flushes;
};

export const getter = () => "from getter" as const;
export const undefinedGetter = () => undefined;
