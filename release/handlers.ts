import type {
  Expect,
  Invoke,
  Table,
} from "../suede.nests.slurp/dsl.import.meta.vitest.ts";
import { type Expand, type MaybeGetter, resolve } from "./utils";
import type { Config as DebounceConfig } from "./debounce";

export type UpdateHistoryBehavior = "push" | "replace";
/** The part of the URL a parameter is stored in: its query (`?q=…`) or its hash (`#q=…`). */
export type URLPart = "query" | "hash";
export type EntryBehavior = "multiple" | "single";

export type SingularVerboseParameterHandler<T> = Expand<{
  /**
   * The query parameter key to use in the URL.
   *
   * If not provided, the property name from the target object will be used.
   */
  key?: string;
  /**
   * Determines how URL updates affect browser history.
   *
   * - `"push"`: Creates a new history entry (allows back/forward navigation)
   * - `"replace"`: Replaces the current history entry (no new history entry)
   *
   * @default "push"
   */
  history?: UpdateHistoryBehavior;
  /**
   * The part of the URL the parameter is stored in.
   *
   * - `"query"`: the query (`?q=…`), which is sent to the server
   * - `"hash"`: the hash (`#q=…`), which is not; it then holds parameters, so it can't also be an anchor
   *
   * @default "query"
   */
  in?: URLPart;
  /**
   * Specifies whether this parameter allows single or multiple values.
   *
   * For singular handlers, this must be `"single"` (or omitted).
   *
   * @default "single"
   */
  entries?: Extract<EntryBehavior, "single">;
  /**
   * Configures debouncing behavior for URL parameter updates.
   *
   * - `false`: Disables debouncing for this parameter (even if global debounce is configured)
   * - `DebounceConfig`: Custom debounce settings for this parameter
   * - `null`: Uses the global debounce configuration (if any)
   *
   * @default null
   */
  debounce?: false | DebounceConfig | null;
  /**
   * Transforms the deserialized query parameter value into the final application type.
   *
   * This function is called after both decoding and deserializing the URL parameter,
   * and with `undefined` when the parameter is removed from the URL.
   *
   * @param query The intermediate representation of the query parameter value (e.g., a JavaScript object)
   * @returns The resolved value of type T for use in the application
   */
  resolve: (query: unknown, param: string, index: number | undefined) => T;
  /**
   * Converts the application value into a string for URL storage.
   *
   * Returning `undefined` removes the parameter from the URL.
   *
   * @param value The application value to serialize
   * @returns The serialized string representation
   * @default JSON.stringify
   */
  serialize?: (value: T) => string | undefined;
  /**
   * Parses the query parameter string from the URL into an intermediate representation.
   *
   * This function is called after decoding the URL parameter and before resolving it.
   *
   * @param query The query parameter string from the URL
   * @returns The intermediate representation (e.g., a JavaScript object)
   * @default JSON.parse, falling back to the string itself when it is not JSON
   */
  deserialize?: (query: string) => unknown;
  /**
   * Transforms a parameter's value as it is read from the URL, before deserializing.
   *
   * The URL's own percent-encoding is already undone: this is for an encoding of
   * your own (compression, base64, …).
   *
   * @param serialized The value as it appears in the URL's search params
   * @returns The decoded string
   * @default the value unchanged
   */
  decode?: (serialized: string) => string;
  /**
   * Transforms a serialized value before it is written to the URL.
   *
   * The URL percent-encodes whatever this returns, so it need not be URL-safe:
   * this is for an encoding of your own (compression, base64, …).
   *
   * @param serialized The serialized string
   * @returns The string to store in the URL's search params
   * @default the value unchanged
   */
  encode?: (serialized: string) => string;

  previousKeys?:
    | {
        fullname: string;
        remove?: boolean;
        apply?: boolean;
        behavior?: UpdateHistoryBehavior;
        /** where the old key is: default, where the parameter is now */
        in?: URLPart;
      }[]
    | null;
}>;

export type Options = Partial<
  {
    prefix: MaybeGetter<string>;
    onDestroy: (callback: () => void) => void;
    debounce: DebounceConfig;
  } & Pick<
    SingularVerboseParameterHandler<any>,
    "history" | "in" | "encode" | "decode" | "deserialize" | "serialize"
  >
>;

/**
 * Default configuration values for URL parameter handlers.
 *
 * These defaults are applied to any parameter handler that doesn't explicitly
 * specify a value for a particular option. You can override these on a per-parameter
 * basis or globally via the URLParameterize options.
 */
export const defaults = {
  /** Default history behavior: creates new history entries for URL changes */
  history: "push",
  /** Default part of the URL: the query */
  in: "query",
  /** Default entry behavior: single value per parameter */
  entries: "single",
  /** Default debounce behavior: no debouncing (null means use global config if set) */
  debounce: null,
  /** Default encoder: none, since the URL percent-encodes search params itself */
  encode: (serialized) => serialized,
  /** Default decoder: none, since the URL percent-decodes search params itself */
  decode: (serialized) => serialized,
  /**
   * Default deserializer: parses JSON. A value that is not JSON (typed by hand, say)
   * is handed to `resolve` as the string it is; `"undefined"` is `undefined`.
   */
  deserialize: (query) => {
    if (query === "undefined") return undefined;
    try {
      return JSON.parse(query);
    } catch {
      return legacy(query) ?? query;
    }
  },
  /** Default serializer: converts values to JSON strings */
  serialize: (value) => JSON.stringify(value),
  previousKeys: null,
} as const satisfies Pick<
  SingularVerboseParameterHandler<any>,
  | "encode"
  | "decode"
  | "deserialize"
  | "serialize"
  | "history"
  | "in"
  | "entries"
  | "debounce"
  | "previousKeys"
>;

declare namespace defaults {
  type Deserialize = typeof defaults.deserialize;

  export type Deserializes = Table<
    Deserialize,
    [
      [args: [query: '{"a":1}'], expected: { a: 1 }],
      [args: [query: "[1,2]"], expected: [1, 2]],
      [args: [query: "3"], expected: 3],
      [args: [query: '"text"'], expected: "text"],
      [args: [query: "undefined"], expected: undefined],
    ]
  >;

  /** a value that is not JSON, typed into the URL by hand, is kept as a string */
  export type NotJSON = Expect<
    Invoke<Deserialize, [query: "hello world"]>,
    "=",
    "hello world"
  >;

  /** a link written while values were percent-encoded twice still reads */
  export type Legacy = [
    Expect<
      Invoke<Deserialize, [query: "%7B%22hello%22%3A%22world%22%7D"]>,
      "=",
      { hello: "world" }
    >,
    Expect<Invoke<Deserialize, [query: "%22a%20b%22"]>, "=", "a b">,
  ];

  /** a string with a percent sign that is not an escape is just a string */
  export type Percent = Expect<
    Invoke<Deserialize, [query: "100%"]>,
    "=",
    "100%"
  >;

  /** nothing is percent-encoded here: the URL does that itself */
  export type NoEncoding = [
    Expect<Invoke<typeof defaults.encode, [serialized: "a b&c"]>, "=", "a b&c">,
    Expect<Invoke<typeof defaults.decode, [serialized: "a%20b"]>, "=", "a%20b">,
  ];
}

/**
 * Before encoding was left to the URL, values were percent-encoded twice, so
 * links in the wild hold JSON that is still percent-encoded once.
 */
const legacy = (query: string): unknown => {
  if (!/%[0-9A-Fa-f]{2}/.test(query)) return undefined;
  try {
    return JSON.parse(decodeURIComponent(query));
  } catch {
    return undefined;
  }
};

type Default<K extends keyof typeof defaults> = (typeof defaults)[K];

type MultipleVerboseParameterHandler<T extends any[]> = Expand<
  Omit<SingularVerboseParameterHandler<T[number]>, "entries"> & {
    /**
     * Specifies that this parameter allows multiple values.
     *
     * When set to `"multiple"`, the parameter can accept an array of values
     * and will handle multiple query parameter entries with the same key.
     *
     * @example URL with multiple entries: `?tag=js&tag=ts&tag=svelte`
     */
    entries: Extract<EntryBehavior, "multiple">;
  }
>;

// Not distributive (`[…] extends […]`): a property typed as a union, such as
// `"home" | "about"` or `string | undefined`, gets one handler resolving to the
// union, not a union of handlers each resolving to one member.
type VerboseParameterHandler<T> = [NonNullable<T>] extends [any[]]
  ?
      | SingularVerboseParameterHandler<T>
      | MultipleVerboseParameterHandler<NonNullable<T>>
  : SingularVerboseParameterHandler<T>;

export type ParameterHandler<T> =
  | SingularVerboseParameterHandler<T>["resolve"]
  | VerboseParameterHandler<T>;

export type ParameterHandlers<T> = {
  [k in keyof T & string]: ParameterHandler<T[k]>;
};

export type ResolvedParameterHandler<T> = Required<VerboseParameterHandler<T>>;
export type AnyParameterHandler = ResolvedParameterHandler<any | any[]>;

/** What a parameter holds in the URL: one value, several, or none (absent). */
export type Encoded = string | string[] | undefined;

/** The URL parameter a property is stored under: the prefix, then the handler's key or the property's name. */
export const keyOf = (
  handler: ParameterHandler<any>,
  property: string,
  prefix = "",
) =>
  prefix +
  (typeof handler === "function" ? property : (handler.key ?? property));

declare namespace keyOf {
  export type Names = Table<
    typeof keyOf,
    [
      [args: [handler: typeof String, property: "query"], expected: "query"],
      [
        args: [handler: typeof String, property: "query", prefix: "app_"],
        expected: "app_query",
      ],
      [
        args: [
          handler: { resolve: typeof String; key: "q" },
          property: "query",
        ],
        expected: "q",
      ],
      [
        args: [
          handler: { resolve: typeof String; key: "q" },
          property: "query",
          prefix: "app_",
        ],
        expected: "app_q",
      ],
    ]
  >;
}

/** A handler with every field filled in: its own, then the options', then the defaults. */
export const verbosify = (
  handler: ParameterHandler<any>,
  property: string,
  options?: Options,
): AnyParameterHandler => {
  const verbose: VerboseParameterHandler<any> =
    typeof handler === "function" ? { resolve: handler } : handler;
  return {
    resolve: verbose.resolve,
    key: keyOf(handler, property, resolve(options?.prefix, "")),
    entries: (verbose.entries ?? defaults.entries) as Default<"entries">,
    debounce: verbose.debounce ?? defaults.debounce,
    previousKeys: verbose.previousKeys ?? defaults.previousKeys,
    history: verbose.history ?? options?.history ?? defaults.history,
    in: verbose.in ?? options?.in ?? defaults.in,
    deserialize:
      verbose.deserialize ?? options?.deserialize ?? defaults.deserialize,
    serialize: verbose.serialize ?? options?.serialize ?? defaults.serialize,
    encode: verbose.encode ?? options?.encode ?? defaults.encode,
    decode: verbose.decode ?? options?.decode ?? defaults.decode,
  } satisfies Required<
    SingularVerboseParameterHandler<any>
  > as AnyParameterHandler;
};

declare namespace verbosify {
  /** a bare resolve function gets every default */
  export type Defaults = Expect<
    Invoke<typeof verbosify, [handler: typeof String, property: "query"]>,
    "matches",
    {
      key: "query";
      history: "push";
      entries: "single";
      debounce: null;
      previousKeys: null;
      in: "query";
    }
  >;

  /** the prefix is resolved, from a getter too */
  export type Prefix = Expect<
    Invoke<
      typeof verbosify,
      [handler: typeof String, property: "query", options: { prefix: "app_" }]
    >["key"],
    "=",
    "app_query"
  >;

  /** the handler's own setting wins over the options', which win over the defaults */
  export type Precedence = [
    Expect<
      Invoke<
        typeof verbosify,
        [
          handler: typeof String,
          property: "query",
          options: { history: "replace" },
        ]
      >["history"],
      "=",
      "replace"
    >,
    Expect<
      Invoke<
        typeof verbosify,
        [
          handler: { resolve: typeof String; history: "push" },
          property: "query",
          options: { history: "replace" },
        ]
      >["history"],
      "=",
      "push"
    >,
  ];

  /** where a parameter is stored: the options' choice for every handler, a handler's own for itself */
  export type In = [
    Expect<
      Invoke<
        typeof verbosify,
        [handler: typeof String, property: "query", options: { in: "hash" }]
      >["in"],
      "=",
      "hash"
    >,
    Expect<
      Invoke<
        typeof verbosify,
        [
          handler: { resolve: typeof String; in: "query" },
          property: "query",
          options: { in: "hash" },
        ]
      >["in"],
      "=",
      "query"
    >,
  ];
}

export const supportsMultiple = (
  handler: AnyParameterHandler,
): handler is Required<MultipleVerboseParameterHandler<any[]>> =>
  handler.entries === "multiple";

/** Reading: a value from the URL, through `decode`, `deserialize` and `resolve`. */
export const evaluate = (
  { decode, deserialize, resolve }: AnyParameterHandler,
  value: string,
  param: string,
  index: number | undefined = undefined,
) => resolve(deserialize(decode(value)), param, index);

declare namespace evaluate {
  type Single = Invoke<
    typeof verbosify,
    [handler: typeof String, property: "query"]
  >;

  /** what parameterize writes (see parameterize > Values), evaluate reads back */
  export type RoundTrip = Expect<
    Invoke<
      typeof evaluate,
      [handler: Single, value: '"a b&c"', param: "query"]
    >,
    "=",
    "a b&c"
  >;

  /** resolve is handed the deserialized value, the param and the index */
  export type Resolves = Expect<
    Invoke<
      typeof evaluate,
      [
        handler: Invoke<
          typeof verbosify,
          [handler: typeof Number, property: "page"]
        >,
        value: "7",
        param: "page",
      ]
    >,
    "=",
    7
  >;
}

/** Writing: a value, through `serialize` and `encode`, to what the URL should hold. */
export const parameterize = (
  value: any,
  { serialize, encode, entries }: AnyParameterHandler,
): Encoded => {
  const single = (value: any) => {
    const serialized = serialize(value);
    return serialized === undefined ? undefined : encode(serialized);
  };
  if (entries !== "multiple") return single(value);
  if (!Array.isArray(value)) return undefined;
  return value.map(single).filter((entry) => entry !== undefined);
};

declare namespace parameterize {
  type Single = Invoke<
    typeof verbosify,
    [handler: typeof String, property: "query"]
  >;
  type Multiple = Invoke<
    typeof verbosify,
    [handler: { resolve: typeof String; entries: "multiple" }, property: "tags"]
  >;

  export type Values = Table<
    typeof parameterize,
    [
      [args: [value: "a b&c", handler: Single], expected: '"a b&c"'],
      [args: [value: { a: 1 }, handler: Single], expected: '{"a":1}'],
      [args: [value: 0, handler: Single], expected: "0"],
      [args: [value: null, handler: Single], expected: "null"],
    ]
  >;

  /** undefined serializes to nothing, which removes the parameter */
  export type Undefined = Expect<
    Invoke<typeof parameterize, [value: undefined, handler: Single]>,
    "undefined"
  >;

  /** with multiple entries, each element is its own value */
  export type Entries = [
    Expect<
      Invoke<typeof parameterize, [value: ["js", "ts"], handler: Multiple]>,
      "=",
      ['"js"', '"ts"']
    >,
    Expect<
      Invoke<typeof parameterize, [value: [], handler: Multiple]>,
      "=",
      []
    >,
  ];
}
