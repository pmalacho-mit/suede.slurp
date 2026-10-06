// @vitest-environment node
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
  type URLPart,
  type UpdateHistoryBehavior,
  evaluate,
  parameterize,
  supportsMultiple,
  verbosify,
} from "./handlers";

/** Parameters to change in a URL, by the part they are in: a value, several, or `undefined` to remove it. */
export type Changes = Partial<Record<URLPart, Record<string, Encoded>>>;

const entries = (encoded: Encoded) =>
  encoded === undefined
    ? []
    : typeof encoded === "string"
      ? [encoded]
      : encoded;

/** The text a part of `href` holds its parameters in, without its `?` or `#`. */
export const paramsIn = (href: string, part: URLPart) => {
  const url = new URL(href, "http://localhost");
  return (part === "hash" ? url.hash : url.search).slice(1);
};

/** Decodes a query component as URLSearchParams does: `+` is a space, and a bad escape is left as it is. */
const decode = (component: string) => {
  const spaced = component.replaceAll("+", " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
};

/** A `name=value` segment's name and value, decoded. */
const split = (segment: string): [string, string] => {
  const at = segment.indexOf("=");
  return at === -1
    ? [decode(segment), ""]
    : [decode(segment.slice(0, at)), decode(segment.slice(at + 1))];
};

/** Every parameter's values in `params` text, by name: parsed once, then looked up. */
export const index = (params: string | URLSearchParams) => {
  const values = new Map<string, string[]>();
  for (const [name, value] of new URLSearchParams(params)) {
    const all = values.get(name);
    if (all) all.push(value);
    else values.set(name, [value]);
  }
  return values;
};

/** Parsed parameters: text, a URLSearchParams, or an `index` of one. */
export type Params = string | URLSearchParams | Map<string, string[]>;

const valuesOf = (params: Params, param: string) =>
  params instanceof Map
    ? (params.get(param) ?? [])
    : new URLSearchParams(params).getAll(param);

/**
 * `params` (`a=1&b=2`) with `changes` made, or undefined when nothing would
 * change. A changed parameter keeps its place; the others keep their spelling.
 * One pass over the text, whatever the number of parameters.
 */
const edit = (params: string, changes: Record<string, Encoded> = {}) => {
  const pending = Object.entries(changes);
  if (pending.length === 0) return undefined;
  let segments = (params ? params.split("&") : []).map((raw) => ({
    raw,
    name: split(raw)[0],
  }));
  let changed = false;
  for (const [param, value] of pending) {
    const next = entries(value);
    const current = segments
      .filter((segment) => segment.name === param)
      .map((segment) => split(segment.raw)[1]);
    if (
      current.length === next.length &&
      current.every((entry, index) => entry === next[index])
    )
      continue;
    changed = true;
    const at = segments.findIndex((segment) => segment.name === param);
    segments = segments.filter((segment) => segment.name !== param);
    segments.splice(
      at === -1 ? segments.length : at,
      0,
      ...next.map((entry) => ({
        raw: new URLSearchParams([[param, entry]]).toString(),
        name: param,
      })),
    );
  }
  return changed ? segments.map((segment) => segment.raw).join("&") : undefined;
};

/**
 * `href` with `changes` made to the parameters in its query and its hash,
 * every other part untouched. Returns `href` itself when nothing would change.
 */
export const withParams = (href: string, changes: Changes): string => {
  const url = new URL(href);
  const query = edit(url.search.slice(1), changes.query);
  const hash = edit(url.hash.slice(1), changes.hash);
  if (query === undefined && hash === undefined) return href;
  if (query !== undefined) url.search = query;
  if (hash !== undefined) url.hash = hash;
  return url.href;
};

declare namespace index {
  type Indexed = Invoke<typeof index, [params: "a=1&b=x+y&a=%22q%22"]>;

  /** every parameter's values, decoded, by name, repeated ones in order */
  export type Indexes = [
    Expect<Call<Indexed, "get", [key: "a"]>, "=", ["1", '"q"']>,
    Expect<Call<Indexed, "get", [key: "b"]>, "=", ["x y"]>,
    Expect<Call<Indexed, "has", [key: "c"]>, "=", false>,
  ];
}

declare namespace withParams {
  /** sets, appends and removes, leaving the other params, the path and the hash alone */
  export type Changes = Expect<
    Invoke<
      typeof withParams,
      [
        href: "https://example.com/page?keep=1&gone=2#top",
        changes: { query: { gone: undefined; one: "a"; many: ["x", "y"] } },
      ]
    >,
    "=",
    "https://example.com/page?keep=1&one=a&many=x&many=y#top"
  >;

  /** values are percent-encoded once, by the URL */
  export type EncodesOnce = Expect<
    Invoke<
      typeof withParams,
      [href: "https://example.com/", changes: { query: { q: '{"a":"b c"}' } }]
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
        changes: { query: { a: "b c"; missing: undefined; empty: [] } },
      ]
    >,
    "=",
    "https://example.com/?a=b%20c&gone"
  >;

  /** a changed parameter keeps its place, and the others keep how they are written */
  export type InPlace = Expect<
    Invoke<
      typeof withParams,
      [
        href: "https://example.com/?a=b%20c&q=1&z=2",
        changes: { query: { q: "3" } },
      ]
    >,
    "=",
    "https://example.com/?a=b%20c&q=3&z=2"
  >;

  /** parameters in the hash are written as they are in the query */
  export type Hash = Expect<
    Invoke<
      typeof withParams,
      [
        href: "https://example.com/?keep=1",
        changes: { hash: { tab: "about"; q: '"b c"' } },
      ]
    >,
    "=",
    "https://example.com/?keep=1#tab=about&q=%22b+c%22"
  >;

  /** a query or hash left without parameters goes, its `?` or `#` with it */
  export type Empties = Expect<
    Invoke<
      typeof withParams,
      [
        href: "https://example.com/?q=1#tab=about",
        changes: { query: { q: undefined }; hash: { tab: undefined } },
      ]
    >,
    "=",
    "https://example.com/"
  >;
}

/**
 * Reads the values a URL holds for `param` into `target[key]`, through the
 * handler. Entries of a multiple-entry parameter that are unchanged since
 * `previous` keep their resolved value. A multiple-entry property gets a new
 * array, assigned once every entry has been read: one that cannot be read
 * leaves the property as it was, and assigning is what `$state.raw` sees.
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
    record[key] = values.map((value, index) =>
      index < array.length && value === previous[index]
        ? array[index]
        : evaluate(handler, value, param, index),
    );
  } else
    record[key] =
      values.length === 0
        ? handler.resolve(undefined, param, undefined)
        : evaluate(handler, values[0], param);
};

declare namespace assign {
  type Tags = Invoke<
    typeof verbosify,
    [handler: { resolve: typeof String; entries: "multiple" }, property: "tags"]
  >;

  type Target = Fixture<{ tags: string[] }, { tags: ["a", "b", "c"] }>;

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

  type Kept = Fixture<{ tags: string[] }, { tags: ["kept a", "kept b"] }>;

  /** entries unchanged since the URL was last read keep their value: resolve runs only for those that changed */
  export type KeepsUnchanged = Given<
    Invoke<
      typeof assign,
      [
        target: Kept,
        key: "tags",
        handler: Tags,
        param: "tags",
        values: ['"a"', '"x"'],
        previous: ['"a"', '"b"'],
      ]
    >,
    Expect<Kept["tags"], "=", ["kept a", "x"]>
  >;

  type Unset = Fixture<{ tags?: string[] }, {}>;

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

  type Page = Fixture<{ page: number }, { page: 1 }>;

  /** a single value read from duplicated entries is the first */
  export type FirstOfDuplicates = Given<
    Invoke<
      typeof assign,
      [
        target: Page,
        key: "page",
        handler: Invoke<
          typeof verbosify,
          [handler: typeof Number, property: "page"]
        >,
        param: "page",
        values: ["2", "5"],
      ]
    >,
    Expect<Page["page"], "=", 2>
  >;
}

/**
 * Reads the `previousKeys` a handler migrates from (in `href`) into
 * `target[key]`, and returns the removals to make, by history behavior.
 */
export const migrate = (
  href: string,
  target: object,
  key: string,
  handler: AnyParameterHandler,
) => {
  const removals: Record<UpdateHistoryBehavior, Changes> = {
    push: {},
    replace: {},
  };
  for (const {
    fullname,
    remove = true,
    apply = true,
    behavior = "replace",
    in: part = handler.in,
  } of handler.previousKeys ?? []) {
    const params = new URLSearchParams(paramsIn(href, part));
    if (!params.has(fullname)) continue;
    if (apply)
      try {
        assign(target, key, handler, fullname, params.getAll(fullname));
      } catch (error) {
        console.error(`URLParameterize: could not read "${fullname}"`, error);
      }
    if (remove) (removals[behavior][part] ??= {})[fullname] = undefined;
  }
  return removals;
};

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
          href: '?greeting="hi"&salutation="yo"',
          target: Target,
          key: "hello",
          handler: Hello,
        ]
      >,
      "=",
      {
        push: { query: { salutation: undefined } };
        replace: { query: { greeting: undefined } };
      }
    >,
    Expect<Target["hello"], "=", "hi">,
  ];

  /** with no old key in the URL, nothing is applied or removed */
  export type Absent = [
    Expect<
      Invoke<
        typeof migrate,
        [href: "?other=1", target: Target, key: "hello", handler: Hello]
      >,
      "=",
      { push: {}; replace: {} }
    >,
    Expect<Target["hello"], "=", "initial">,
  ];

  /** a parameter moved from the query to the hash reads its old value from the query */
  export type QueryToHash = [
    Expect<
      Invoke<
        typeof migrate,
        [
          href: '?hello="old"#other=1',
          target: Target,
          key: "hello",
          handler: Invoke<
            typeof verbosify,
            [
              handler: {
                resolve: typeof String;
                in: "hash";
                previousKeys: [{ fullname: "hello"; in: "query" }];
              },
              property: "hello",
            ]
          >,
        ]
      >,
      "=",
      { push: {}; replace: { query: { hello: undefined } } }
    >,
    Expect<Target["hello"], "=", "old">,
  ];
}

type Entry = {
  handler: AnyParameterHandler;
  /** the URL's values for the parameter when it was last read or written */
  seen?: string;
  /** the value the target was last synced at, as written to the URL */
  synced?: string;
  /** the target holds a change the URL never got: read the URL next time, even if it is unchanged */
  stale?: boolean;
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
   * Reads `param` from `search` (the query or hash it is in) into `target[key]` if the URL changed it.
   *
   * A parameter missing from the URL when it is first read leaves the target
   * as it is; one that goes missing later is resolved from `undefined`. A value
   * that cannot be read is reported, and the target keeps what it had.
   */
  read(search: Params, target: object, key: string, param: string) {
    const entry = this.#entries.get(param);
    if (!entry) return;
    const values = valuesOf(search, param);
    const seen = JSON.stringify(values);
    if (seen === entry.seen && !entry.stale) return;
    const previous: string[] =
      entry.seen && !entry.stale ? JSON.parse(entry.seen) : [];
    const first = entry.seen === undefined;
    entry.seen = seen;
    entry.stale = false;
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

  /** Marks `param` as holding a change that will not be written, so that the next read replaces it. */
  invalidate(param: string) {
    const entry = this.#entries.get(param);
    if (entry) entry.stale = true;
  }

  /** Whether `encoded` is what `param` was last synced at, so that writing it would change nothing. */
  synced(param: string, encoded: Encoded) {
    return (
      this.#entries.get(param)?.synced === JSON.stringify(entries(encoded))
    );
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
        [
          search: '?q="hello"&tags="x"&tags="y"',
          target: Model,
          key: "query",
          param: "q",
        ]
      >,
      Call<
        Registered,
        "read",
        [
          search: '?q="hello"&tags="x"&tags="y"',
          target: Model,
          key: "tags",
          param: "tags",
        ]
      >,
    ],
    [
      Expect<Model["query"], "=", "hello">,
      Expect<Model["tags"], "=", ["x", "y"]>,
    ]
  >;

  /** missing at first, a parameter leaves the target's initial value alone */
  export type InitialKept = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<
        Registered,
        "read",
        [search: "", target: Model, key: "query", param: "q"]
      >,
      Call<
        Registered,
        "read",
        [search: "", target: Model, key: "tags", param: "tags"]
      >,
    ],
    [Expect<Model["query"], "=", "initial">, Expect<Model["tags"], "=", ["a"]>]
  >;

  /** removed later, it is resolved from undefined (String(undefined) here), or emptied for multiple entries */
  export type Removed = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<
        Registered,
        "read",
        [search: '?q="hello"&tags="x"', target: Model, key: "query", param: "q"]
      >,
      Call<
        Registered,
        "read",
        [
          search: '?q="hello"&tags="x"',
          target: Model,
          key: "tags",
          param: "tags",
        ]
      >,
      Call<
        Registered,
        "read",
        [search: "", target: Model, key: "query", param: "q"]
      >,
      Call<
        Registered,
        "read",
        [search: "", target: Model, key: "tags", param: "tags"]
      >,
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
      Expect<
        Call<Registered, "write", [param: "q", encoded: '"a"']>,
        "=",
        true
      >,
      Expect<
        Call<Registered, "write", [param: "q", encoded: '"a"']>,
        "=",
        false
      >,
      Expect<
        Call<Registered, "write", [param: "q", encoded: '"b"']>,
        "=",
        true
      >,
    ]
  >;

  /** what was just read is not written back */
  export type NoEcho = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<
        Registered,
        "read",
        [search: '?q="hello"', target: Model, key: "query", param: "q"]
      >,
    ],
    Expect<
      Call<Registered, "write", [param: "q", encoded: '"hello"']>,
      "=",
      false
    >
  >;

  /** a URL value written differently than it would be is read, but not rewritten */
  export type NotRewritten = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<
        Registered,
        "read",
        [search: "?q=hello", target: Model, key: "query", param: "q"]
      >,
    ],
    [
      Expect<Model["query"], "=", "hello">,
      Expect<
        Call<Registered, "write", [param: "q", encoded: '"hello"']>,
        "=",
        false
      >,
    ]
  >;

  /** an unchanged URL is not read again, so a local change survives it */
  export type ReadOnce = Given<
    [
      Call<Registered, "register", [handler: Query]>,
      Call<Registered, "register", [handler: Tags]>,
      Call<
        Registered,
        "read",
        [search: '?q="hello"', target: Model, key: "query", param: "q"]
      >,
      Invoke<typeof Object.assign, [target: Model, source: { query: "local" }]>,
      Call<
        Registered,
        "read",
        [search: '?q="hello"&other=1', target: Model, key: "query", param: "q"]
      >,
    ],
    Expect<Model["query"], "=", "local">
  >;

  /** a value that cannot be read leaves the target as it was */
  export type Unreadable = Given<
    [
      Call<Registered, "register", [handler: Throwing]>,
      Call<
        Registered,
        "read",
        [search: "?bad=not+json", target: Model, key: "query", param: "bad"]
      >,
    ],
    Expect<Model["query"], "=", "initial">
  >;
  type Throwing = Invoke<
    typeof verbosify,
    [
      handler: {
        resolve: typeof String;
        deserialize: typeof JSON.parse;
        key: "bad";
      },
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
      Call<Registered, "rename", [from: "q", to: "v2_q"]>,
    ],
    [
      Expect<Call<Registered, "has", [param: "q"]>, "=", false>,
      Expect<
        Call<Registered, "handler", [param: "v2_q"]>,
        "matches",
        { key: "v2_q" }
      >,
      Throws<
        Call<Registered, "rename", [from: "v2_q", to: "tags"]>,
        'URL parameter key conflict detected: "tags"'
      >,
    ]
  >;
}
