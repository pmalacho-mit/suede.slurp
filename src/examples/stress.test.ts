// @vitest-environment jsdom
// How URLParameterize's costs grow with the number of parameters. Absolute
// times depend on the machine, so these compare costs with each other: what
// the library adds to a change, beside what the browser's own pushState costs
// for a URL that long, and how mounting grows with the number of parameters.
import { expect, test } from "vitest";
import { flushSync } from "svelte";
import { build } from "./stress.svelte";

/** The median time of `runs` calls, in milliseconds. */
const median = (runs: number, run: (index: number) => void) => {
  const times = Array.from({ length: runs }, (_, index) => {
    const start = performance.now();
    run(index);
    return performance.now() - start;
  });
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
};

test("a change costs about what the browser's own URL update does, even with 400 parameters", () => {
  const tracked = build(400, 20);
  const edit = median(30, (index) => {
    tracked.targets[0].p0 = `y${index}`;
    flushSync();
  });
  const pushState = median(30, (index) => {
    const next = new URL(location.href);
    next.searchParams.set("other", String(index));
    History.prototype.pushState.call(history, {}, "", next);
  });
  tracked.cleanup();
  expect(edit).toBeLessThan(pushState * 3);
});

test("mounting grows in step with the number of parameters", () => {
  const mount = (params: number) =>
    median(5, () => build(params, 20).cleanup());
  mount(50); // warm up
  expect(mount(400)).toBeLessThan(mount(100) * 10);
});
