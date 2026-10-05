import { onTestFinished, vi } from "vitest";
import { MappedDebouncer, type Config } from "../release/debounce.ts";

export type Step =
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
export const timeline = (config: Config, steps: Step[]): Flush[] => {
  vi.useFakeTimers();
  // The unit project runs under Node: give the debouncer the `window` it expects.
  if (typeof window === "undefined")
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        setTimeout: (handler: () => void, ms: number) =>
          setTimeout(handler, ms),
      }),
    );
  onTestFinished(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
