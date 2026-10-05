import type {
  Call,
  Construct,
  Expect,
  Fixture,
  Given,
  Invoke,
  Throws,
} from "../suede.nests.slurp/dsl.import.meta.vitest.ts";
import {
  type AnyParameterHandler,
  type Encoded,
  type UpdateHistoryBehavior,
  evaluate,
  parameterize,
  supportsMultiple,
  verbosify,
} from "./handlers";

/** Parameters to change in a URL: a value, several, or `undefined` to remove it. */
export type Changes = Record<string, Encoded>;

const entries = (encoded: Encoded) =>
  encoded === undefined ? [] : typeof encoded === "string" ? [encoded] : encoded;

/**
 * `href` with `changes` made to its search params, every other part untouched.
 * Returns `href` itself when nothing would change.
 */
export const withParams = (href: string, changes: Changes): string => {
  const url = new URL(href);
  const { searchParams } = url;
  let changed = false;
  for (const [param, value] of Object.entries(changes)) {
    const next = entries(value);
    const current = searchParams.getAll(param);
    if (
      current.length === next.length &&
      current.every((entry, index) => entry === next[index])
    )
      continue;
    changed = true;
    searchParams.delete(param);
    for (const entry of next) searchParams.append(param, entry);
  }
  return changed ? url.href : href;
};

/**
 * Reads the values a URL holds for `param` into `target[key]`, through the
 * handler. Entries of a multiple-entry parameter that are unchanged since
 * `previous` keep their resolved value.
 */
export const assign = (
  target: object,
  key: string,
  handler: AnyParameterHandler,
  param: string,
  values: string[],
  previous: string[] = [],
) => {
  const record = target as Record<string, unknown>;
  if (supportsMultiple(handler)) {
    const current = record[key];
    const array: unknown[] = Array.isArray(current) ? current : [];
    for (let index = 0; index < values.length; index++)
      if (index >= array.length || values[index] !== previous[index])
        array[index] = evaluate(handler, values[index], param, index);
    array.length = values.length;
    if (array !== current) record[key] = array;
  } else
    record[key] =
      values.length === 0
        ? handler.resolve(undefined, param, undefined)
        : evaluate(handler, values[0], param);
};

/**
 * Reads the `previousKeys` a handler migrates from into `target[key]`, and
 * returns the removals to make, by history behavior.
 */
export const migrate = (
  search: string | URLSearchParams,
  target: object,
  key: string,
  handler: AnyParameterHandler,
) => {
  const params = new URLSearchParams(search);
  const removals: Record<UpdateHistoryBehavior, Changes> = {
    push: {},
    replace: {},
  };
  for (const {
    fullname,
    remove = true,
    apply = true,
    behavior = "replace",
  } of handler.previousKeys ?? []) {
    if (!params.has(fullname)) continue;
    if (apply)
      try {
        assign(target, key, handler, fullname, params.getAll(fullname));
      } catch (error) {
        console.error(`URLParameterize: could not read "${fullname}"`, error);
      }
    if (remove) removals[behavior][fullname] = undefined;
  }
  return removals;
};

type Entry = {
  handler: AnyParameterHandler;
  /** the URL's values for the parameter when it was last read or written */
  seen?: string;
  /** the value the target was last synced at, as written to the URL */
  synced?: string;
};

/**
 * Every tracked URL parameter, its handler, and what was last synced, so that
 * neither direction repeats a change the other just made.
 */
export class Registry {
  readonly #entries = new Map<string, Entry>();

  has(param: string) {
    return this.#entries.has(param);
  }

  handler(param: string) {
    return this.#entries.get(param)?.handler;
  }

  register(handler: AnyParameterHandler) {
    if (this.#entries.has(handler.key))
      throw new Error(`URL parameter key conflict detected: "${handler.key}"`);
    this.#entries.set(handler.key, { handler });
  }

  unregister(param: string) {
    this.#entries.delete(param);
  }

  /** Moves a parameter to a new key. Write its value next: nothing is synced under the new key yet. */
  rename(from: string, to: string) {
    const entry = this.#entries.get(from);
    if (!entry) return;
    if (from !== to && this.#entries.has(to))
      throw new Error(`URL parameter key conflict detected: "${to}"`);
    this.#entries.delete(from);
    entry.handler.key = to;
    this.#entries.set(to, { handler: entry.handler });
  }

  /**
   * Reads `param` from `search` into `target[key]` if the URL changed it.
   *
   * A parameter missing from the URL when it is first read leaves the target
   * as it is; one that goes missing later is resolved from `undefined`. A value
   * that cannot be read is reported, and the target keeps what it had.
   */
  read(
    search: string | URLSearchParams,
    target: object,
    key: string,
    param: string,
  ) {
    const entry = this.#entries.get(param);
    if (!entry) return;
    const values = new URLSearchParams(search).getAll(param);
    const seen = JSON.stringify(values);
    if (seen === entry.seen) return;
    const previous: string[] = entry.seen ? JSON.parse(entry.seen) : [];
    const first = entry.seen === undefined;
    entry.seen = seen;
    if (first && values.length === 0) return;
    try {
      assign(target, key, entry.handler, param, values, previous);
      entry.synced = JSON.stringify(
        entries(
          parameterize((target as Record<string, unknown>)[key], entry.handler),
        ),
      );
    } catch (error) {
      console.error(`URLParameterize: could not read "${param}"`, error);
    }
  }

  /**
   * Records `encoded` as what `param` now holds. Returns whether the URL needs
   * to change: false when the target has not changed since it was last synced.
   */
  write(param: string, encoded: Encoded) {
    const entry = this.#entries.get(param);
    if (!entry) return false;
    const synced = JSON.stringify(entries(encoded));
    if (synced === entry.synced) return false;
    entry.synced = entry.seen = synced;
    return true;
  }
}

declare namespace withParams {
  /** sets, appends and removes, leaving the other params, the path and the hash alone */
  export type Changes = Expect<
    Invoke<
      typeof withParams,
      [
        href: "https://example.com/page?keep=1&gone=2#top",
        changes: { gone: undefined; one: "a"; many: ["x", "y"] },
      ]
    >,
    "=",
    "https://example.com/page?keep=1&one=a&many=x&many=y#top"
  >;

  /** values are percent-encoded once, by the URL */
  export type EncodesOnce = Expect<
    Invoke<
      typeof withParams,
      [href: "https://example.com/", changes: { q: '{"a":"b c"}' }]
    >,
    "=",
    "https://example.com/?q=%7B%22a%22%3A%22b+c%22%7D"
  >;

  /** no change, not even to how the URL is written, when the values are already there */
  export type Unchanged = Expect<
    Invoke<
      typeof withParams,
      [
        href: "https://example.com/?a=b%20c&gone",
        changes: { a: "b c"; missing: undefined; empty: [] },
      ]
    >,
    "=",
    "https://example.com/?a=b%20c&gone"
  >;
}

declare namespace assign {
  type Tags = Invoke<
    typeof verbosify,
    [handler: { resolve: typeof String; entries: "multiple" }, property: "tags"]
  >;

  /** an array that the URL shortens loses its extra entries */
  export type Shrinks = Given<
    Invoke<
      typeof assign,
      [
        target: Target,
        key: "tags",
        handler: Tags,
        param: "tags",
        values: ['"x"'],
        previous: [],
      ]
    >,
    Expect<Target["tags"], "=", ["x"]>
  >;
  type Target = Fixture<{ tags: string[] }, { tags: ["a", "b", "c"] }>;

  /** a multiple-entry target that is not an array yet becomes one */
  export type Creates = Given<
    Invoke<
      typeof assign,
      [
        target: Unset,
        key: "tags",
        handler: Tags,
        param: "tags",
        values: ['"x"', '"y"'],
      ]
    >,
    Expect<Unset["tags"], "=", ["x", "y"]>
  >;
  type Unset = Fixture<{ tags?: string[] }, {}>;

  /** a single value read from duplicated entries is the first */
  export type FirstOfDuplicates = Given<
    Invoke<
      typeof assign,
      [
        target: Page,
        key: "page",
        handler: Invoke<typeof verbosify, [handler: typeof Number, property: "page"]>,
        param: "page",
        values: ["2", "5"],
      ]
    >,
    Expect<Page["page"], "=", 2>
  >;
  type Page = Fixture<{ page: number }, { page: 1 }>;
}

declare namespace migrate {
  type Hello = Invoke<
    typeof verbosify,
    [
      handler: {
        resolve: typeof String;
        previousKeys: [
          { fullname: "greeting" },
          { fullname: "salutation"; behavior: "push"; apply: false },
          { fullname: "absent"; behavior: "push" },
        ];
      },
      property: "hello",
    ]
  >;
  type Target = Fixture<{ hello: string }, { hello: "initial" }>;

  /** an old key's value is applied, and the old keys found are removed, by behavior */
  export type Migrates = [
    Expect<
      Invoke<
        typeof migrate,
        [
          search: '?greeting="hi"&salutation="yo"',
          target: Target,
          key: "hello",
          handler: Hello,
        ]
      >,
      "=",
      { push: { salutation: undefined }; replace: { greeting: undefined } }
    >,
    Expect<Target["hello"], "=", "hi">,
  ];

  /** with no old key in the URL, nothing is applied or removed */
  export type Absent = [
    Expect<
      Invoke<
        typeof migrate,
        [search: "?other=1", target: Target, key: "hello", handler: Hello]
      >,
      "=",
      { push: {}; replace: {} }
    >,
    Expect<Target["hello"], "=", "initial">,
  ];
}

declare namespace Registry {
  type Query = Invoke<
    typeof verbosify,
    [handler: { resolve: typeof String; key: "q" }, property: "query"]
  >;
  type Tags = Invoke<
    typeof verbosify,
    [handler: { resolve: typeof String; entries: "multiple" }, property: "tags"]
  >;
  type Model = Fixture<
    { query: string; tags: string[] },
    { query: "initial"; tags: ["a"] }
  >;
  type Registered = Construct<typeof Registry>;
  /** a parameter in the URL is read into the target */
  export type Reads = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<
        Registered,
        "read",
        [search: '?q="hello"&tags="x"&tags="y"', target: Model, key: "query", param: "q"]
      >,
      Call<
        Registered,
        "read",
        [search: '?q="hello"&tags="x"&tags="y"', target: Model, key: "tags", param: "tags"]
      >,
    ],
    [Expect<Model["query"], "=", "hello">, Expect<Model["tags"], "=", ["x", "y"]>]
  >;

  /** missing at first, a parameter leaves the target's initial value alone */
  export type InitialKept = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<Registered, "read", [search: "", target: Model, key: "query", param: "q"]>,
      Call<Registered, "read", [search: "", target: Model, key: "tags", param: "tags"]>,
    ],
    [Expect<Model["query"], "=", "initial">, Expect<Model["tags"], "=", ["a"]>]
  >;

  /** removed later, it is resolved from undefined (String(undefined) here), or emptied for multiple entries */
  export type Removed = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<Registered, "read", [search: '?q="hello"&tags="x"', target: Model, key: "query", param: "q"]>,
      Call<Registered, "read", [search: '?q="hello"&tags="x"', target: Model, key: "tags", param: "tags"]>,
      Call<Registered, "read", [search: "", target: Model, key: "query", param: "q"]>,
      Call<Registered, "read", [search: "", target: Model, key: "tags", param: "tags"]>,
    ],
    [Expect<Model["query"], "=", "undefined">, Expect<Model["tags"], "=", []>]
  >;

  /** the first write is needed, the same value again is not */
  export type Writes = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
    ],
    [
      Expect<Call<Registered, "write", [param: "q", encoded: '"a"']>, "=", true>,
      Expect<Call<Registered, "write", [param: "q", encoded: '"a"']>, "=", false>,
      Expect<Call<Registered, "write", [param: "q", encoded: '"b"']>, "=", true>,
    ]
  >;

  /** what was just read is not written back */
  export type NoEcho = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<Registered, "read", [search: '?q="hello"', target: Model, key: "query", param: "q"]>,
    ],
    Expect<Call<Registered, "write", [param: "q", encoded: '"hello"']>, "=", false>
  >;

  /** a URL value written differently than it would be is read, but not rewritten */
  export type NotRewritten = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<Registered, "read", [search: "?q=hello", target: Model, key: "query", param: "q"]>,
    ],
    [
      Expect<Model["query"], "=", "hello">,
      Expect<Call<Registered, "write", [param: "q", encoded: '"hello"']>, "=", false>,
    ]
  >;

  /** an unchanged URL is not read again, so a local change survives it */
  export type ReadOnce = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<Registered, "read", [search: '?q="hello"', target: Model, key: "query", param: "q"]>,
      Invoke<typeof Object.assign, [target: Model, source: { query: "local" }]>,
      Call<Registered, "read", [search: '?q="hello"&other=1', target: Model, key: "query", param: "q"]>,
    ],
    Expect<Model["query"], "=", "local">
  >;

  /** a value that cannot be read leaves the target as it was */
  export type Unreadable = Given<
    [
      Call<Registered, "register", [handler: Throwing]>,
      Call<Registered, "read", [search: "?bad=not+json", target: Model, key: "query", param: "bad"]>,
    ],
    Expect<Model["query"], "=", "initial">
  >;
  type Throwing = Invoke<
    typeof verbosify,
    [
      handler: { resolve: typeof String; deserialize: typeof JSON.parse; key: "bad" },
      property: "query",
    ]
  >;

  /** a key can only be tracked once */
  export type Conflict = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
    ],
    Throws<
      Call<Registered, "register", [handler: Query]>,
      'URL parameter key conflict detected: "q"'
    >
  >;

  /** a renamed parameter answers to its new key, and its old key is free */
  export type Rename = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<Registered, "rename", [from: "q", to: "v2_q"]>],
    [
      Expect<Call<Registered, "has", [param: "q"]>, "=", false>,
      Expect<Call<Registered, "handler", [param: "v2_q"]>, "matches", { key: "v2_q" }>,
      Throws<
        Call<Registered, "rename", [from: "v2_q", to: "tags"]>,
        'URL parameter key conflict detected: "tags"'
      >,
    ]
  >;
}
