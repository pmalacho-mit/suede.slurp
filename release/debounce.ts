// @vitest-environment jsdom
import type {
  Construct,
  Expect,
  Invoke,
  Throws,
} from "../suede.nests.slurp/dsl.import.meta.vitest.ts";
import type { timeline } from "./_internal/harness.svelte";

export type Config = { idleMs: number; maxWaitMs: number };

export class MappedDebouncer<T> {
  private maxTimers = new Map<T, number>();
  private idleTimers = new Map<T, number>();
  private callbacks = new Map<T, () => void>();
  readonly #dispose: () => void;

  constructor(private opts: Config) {
    MappedDebouncer.ValidateConfig(opts);

    const visibilityHandler = () => {
      for (const [key] of this.callbacks) this.flush(key);
    };
    window.addEventListener("visibilitychange", visibilityHandler);
    window.addEventListener("pagehide", visibilityHandler);
    window.addEventListener("beforeunload", visibilityHandler);
    this.#dispose = () => {
      window.removeEventListener("visibilitychange", visibilityHandler);
      window.removeEventListener("pagehide", visibilityHandler);
      window.removeEventListener("beforeunload", visibilityHandler);
    };
  }

  dispose() {
    this.#dispose();
  }

  clear(key: T) {
    clearTimeout(this.idleTimers.get(key));
    clearTimeout(this.maxTimers.get(key));
    this.idleTimers.delete(key);
    this.maxTimers.delete(key);
    this.callbacks.delete(key);
  }

  enqueue(key: T, callback: () => void, config?: Config) {
    if (config) MappedDebouncer.ValidateConfig(config);

    const idleMs = config?.idleMs ?? this.opts.idleMs; // flush after `idleMs` of idle (i.e., no new `enqueue` calls)
    const maxWaitMs = config?.maxWaitMs ?? this.opts.maxWaitMs; // but at least every `maxWaitMs`

    this.callbacks.set(key, callback);

    clearTimeout(this.idleTimers.get(key));
    const flush = this.flush.bind(this, key);
    this.idleTimers.set(key, window.setTimeout(flush, idleMs));

    if (!this.maxTimers.has(key))
      this.maxTimers.set(key, window.setTimeout(flush, maxWaitMs));
  }

  /** The keys with a callback waiting to run. */
  pending(): T[] {
    return [...this.callbacks.keys()];
  }

  /** Runs `key`'s waiting callback now, if it has one. */
  flush(key: T) {
    const callback = this.callbacks.get(key);
    this.clear(key);
    callback?.();
  }

  static ValidateConfig(config: Config) {
    if (config.maxWaitMs < config.idleMs)
      throw new Error("maxWaitMs must be greater than or equal to idleMs");
  }
}

declare namespace MappedDebouncer {
  /** maxWaitMs may equal idleMs */
  export type AcceptsEqualWaits = Expect<
    Invoke<
      typeof MappedDebouncer.ValidateConfig,
      [config: { idleMs: 100; maxWaitMs: 100 }]
    >,
    "undefined"
  >;

  /** maxWaitMs may not be shorter than idleMs */
  export type RejectsShorterMaxWait = Throws<
    Invoke<
      typeof MappedDebouncer.ValidateConfig,
      [config: { idleMs: 100; maxWaitMs: 50 }]
    >,
    "maxWaitMs must be greater than or equal to idleMs"
  >;

  /** the constructor validates its config before anything else */
  export type ConstructorValidates = Throws<
    Construct<typeof MappedDebouncer, [opts: { idleMs: 100; maxWaitMs: 50 }]>,
    "maxWaitMs must be greater than or equal to idleMs"
  >;

  // Timing, played out on fake timers by the harness's timeline.

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
