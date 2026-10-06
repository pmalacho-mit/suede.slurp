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

/** The same, for a change whose URL is written at the end of its tick: timed until then. */
const medianTick = async (runs: number, run: (index: number) => void) => {
  const times: number[] = [];
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    run(index);
    flushSync();
    await Promise.resolve();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
};

/** The History API calls `run` makes. */
const historyCalls = async (run: () => void) => {
  let calls = 0;
  const { pushState, replaceState } = history;
  history.pushState = function (...args) {
    calls++;
    return pushState.apply(this, args);
  };
  history.replaceState = function (...args) {
    calls++;
    return replaceState.apply(this, args);
  };
  try {
    run();
    flushSync();
    await Promise.resolve();
  } finally {
    history.pushState = pushState;
    history.replaceState = replaceState;
  }
  return calls;
};

test("a change costs about what the browser's own URL update does, even with 400 parameters", async () => {
  const tracked = build(400, 20);
  const edit = await medianTick(30, (index) => {
    tracked.targets[0].p0 = `y${index}`;
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

test("an action that changes all 400 parameters is one History API call, costing about what one change does", async () => {
  const tracked = build(400, 20);
  const target = tracked.targets[0];
  const calls = await historyCalls(() => {
    for (const key in target) target[key] = "reset";
  });
  const one = await medianTick(10, (index) => {
    target.p0 = `y${index}`;
  });
  const all = await medianTick(10, (index) => {
    for (const key in target) target[key] = `z${index}`;
  });
  tracked.cleanup();
  expect(calls).toBe(1);
  expect(all).toBeLessThan(one * 20);
});
