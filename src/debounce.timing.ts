import type {
  Expect,
  Invoke,
  Throws,
} from "../suede.nests/dsl.import.meta.vitest.ts";
import type { timeline } from "./debounce.harness.ts";

// release/debounce.ts's timing, which needs a harness (fake timers, a `window`),
// so it is tested here rather than beside the class.
declare namespace MappedDebouncer {
  /** a single enqueue runs once idleMs have passed */
  export type FlushesWhenIdle = Expect<
    Invoke<
      typeof timeline,
      [
        config: { idleMs: 100; maxWaitMs: 1000 },
        steps: [{ at: 0; enqueue: "a" }],
      ]
    >,
    "=",
    [{ at: 100; key: "a"; step: 0 }]
  >;

  /** each enqueue restarts the idle wait, and only the latest callback runs */
  export type BurstRunsLatestOnce = Expect<
    Invoke<
      typeof timeline,
      [
        config: { idleMs: 100; maxWaitMs: 1000 },
        steps: [
          { at: 0; enqueue: "a" },
          { at: 50; enqueue: "a" },
          { at: 120; enqueue: "a" },
        ],
      ]
    >,
    "=",
    [{ at: 220; key: "a"; step: 2 }]
  >;

  /** a burst that never goes idle still runs every maxWaitMs */
  export type MaxWaitCapsABurst = Expect<
    Invoke<
      typeof timeline,
      [
        config: { idleMs: 100; maxWaitMs: 150 },
        steps: [
          { at: 0; enqueue: "a" },
          { at: 60; enqueue: "a" },
          { at: 120; enqueue: "a" },
          { at: 180; enqueue: "a" },
        ],
      ]
    >,
    "=",
    [{ at: 150; key: "a"; step: 2 }, { at: 280; key: "a"; step: 3 }]
  >;

  /** keys are debounced independently */
  export type KeysAreIndependent = Expect<
    Invoke<
      typeof timeline,
      [
        config: { idleMs: 100; maxWaitMs: 1000 },
        steps: [
          { at: 0; enqueue: "a" },
          { at: 50; enqueue: "b" },
          { at: 90; enqueue: "a" },
        ],
      ]
    >,
    "=",
    [{ at: 150; key: "b"; step: 1 }, { at: 190; key: "a"; step: 2 }]
  >;

  /** an enqueue's own config overrides the debouncer's */
  export type PerCallConfig = Expect<
    Invoke<
      typeof timeline,
      [
        config: { idleMs: 100; maxWaitMs: 1000 },
        steps: [{ at: 0; enqueue: "a"; config: { idleMs: 10; maxWaitMs: 10 } }],
      ]
    >,
    "=",
    [{ at: 10; key: "a"; step: 0 }]
  >;

  /** a per-call config is validated too */
  export type PerCallConfigValidated = Throws<
    Invoke<
      typeof timeline,
      [
        config: { idleMs: 100; maxWaitMs: 1000 },
        steps: [
          { at: 0; enqueue: "a"; config: { idleMs: 100; maxWaitMs: 50 } },
        ],
      ]
    >,
    "maxWaitMs must be greater than or equal to idleMs"
  >;

  /** clear drops what is pending, so it never runs */
  export type ClearCancels = Expect<
    Invoke<
      typeof timeline,
      [
        config: { idleMs: 100; maxWaitMs: 1000 },
        steps: [{ at: 0; enqueue: "a" }, { at: 50; clear: "a" }],
      ]
    >,
    "isEmpty"
  >;

  /** leaving the page runs everything pending at once, and nothing runs twice */
  export type LeavingFlushes = [
    Expect<
      Invoke<
        typeof timeline,
        [
          config: { idleMs: 100; maxWaitMs: 1000 },
          steps: [
            { at: 0; enqueue: "a" },
            { at: 10; enqueue: "b" },
            { at: 30; dispatch: "pagehide" },
          ],
        ]
      >,
      "=",
      [{ at: 30; key: "a"; step: 0 }, { at: 30; key: "b"; step: 1 }]
    >,
    Expect<
      Invoke<
        typeof timeline,
        [
          config: { idleMs: 100; maxWaitMs: 1000 },
          steps: [
            { at: 0; enqueue: "a" },
            { at: 30; dispatch: "visibilitychange" },
          ],
        ]
      >,
      "=",
      [{ at: 30; key: "a"; step: 0 }]
    >,
    Expect<
      Invoke<
        typeof timeline,
        [
          config: { idleMs: 100; maxWaitMs: 1000 },
          steps: [
            { at: 0; enqueue: "a" },
            { at: 30; dispatch: "beforeunload" },
          ],
        ]
      >,
      "=",
      [{ at: 30; key: "a"; step: 0 }]
    >,
  ];

  /** after dispose, leaving the page no longer flushes: the idle timer still does */
  export type DisposeStopsListening = Expect<
    Invoke<
      typeof timeline,
      [
        config: { idleMs: 100; maxWaitMs: 1000 },
        steps: [
          { at: 0; enqueue: "a" },
          { at: 10; dispose: true },
          { at: 30; dispatch: "pagehide" },
        ],
      ]
    >,
    "=",
    [{ at: 100; key: "a"; step: 0 }]
  >;
}
