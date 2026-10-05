# URLParameterize

Bidirectional binding between Svelte 5 `$state` properties and URL query parameters. Mutating a tracked property updates the URL; browser navigation, manual edits, or `pushState`/`replaceState` from elsewhere flow back into the state.

Built on Svelte 5 runes — call sites must live inside a rune-aware context (component script, `.svelte.ts` module, or `$effect.root`).

## Basic usage

```ts
import { URLParameterize } from "...";

class Model {
  search = $state("");
  page = $state(1);

  readonly url = URLParameterize<Model>(this, {
    search: (query) => String(query ?? ""),
    page: (query) => Number(query ?? 1),
  });
}
```

`URLParameterize(target, handlers, options?)` returns `{ cleanup, prefix }`. Call `cleanup()` on destroy to tear down listeners and remove the parameters from the URL.

A property whose parameter is already in the URL starts from it; one whose parameter is not keeps its initial value, which is then written to the URL. Writing those initial values replaces the current history entry rather than adding one, so mounting never costs the back button a press.

```ts
import { onDestroy } from "svelte";

onDestroy(model.url.cleanup);
```

Or hand `onDestroy` to the utility via options and skip the manual wiring:

```ts
URLParameterize(this, handlers, { onDestroy });
```

## Handlers

Each handler is either a **resolve function** or a **verbose config object**.

### Resolve function (shorthand)

```ts
{
  page: (query, param, index) => Number(query ?? 1)
}
```

- `query` — the value after `decode` + `deserialize` (by default, the URL's value parsed as JSON, or the string itself when it is not JSON). When the parameter is removed from the URL (by navigating back to an entry without it, say), `query` is `undefined`.
- `param` — the fully-qualified URL key (with prefix applied).
- `index` — the position within a `"multiple"`-entry array, otherwise `undefined`.

The function's job is to **coerce/validate** the unknown query value into the target property's type. Always provide a fallback for the `undefined` / wrong-shape case.

### Verbose handler

```ts
{
  search: {
    resolve: (query) => typeof query === "string" ? query : "",
    serialize: (value) => value,            // default: JSON.stringify
    deserialize: (query) => query,          // default: JSON.parse, or the string itself when it is not JSON
    encode: (serialized) => serialized,     // default: unchanged (the URL percent-encodes)
    decode: (serialized) => serialized,     // default: unchanged (the URL percent-decodes)
    key: "q",                               // default: property name
    history: "replace",                     // "push" (default) | "replace"
    entries: "single",                      // "single" (default) | "multiple"
    debounce: { idleMs: 250, maxWaitMs: 1000 },
    previousKeys: [{ fullname: "query", remove: true }],
  }
}
```

#### Pipeline

Writing to the URL: `value → serialize → encode → URL`
Reading from the URL: `URL → decode → deserialize → resolve → property`

The URL percent-encodes and decodes search params itself, so `encode` and `decode` are only for an encoding of your own (compression, base64, …). A value that serializes to `undefined` (as `undefined` does with `JSON.stringify`) is removed from the URL.

A value that cannot be read (a `deserialize` or `resolve` that throws) is reported with `console.error`, and the property keeps what it had. A single-entry parameter that appears more than once is read from its first entry.

#### Field reference

| Field | Purpose |
|---|---|
| `resolve` | **Required.** Coerces the deserialized query into the property type. |
| `serialize` | Value → string, or `undefined` to remove the parameter. Default `JSON.stringify`. |
| `deserialize` | String → intermediate value. Default `JSON.parse`, falling back to the string itself (and `"undefined"` → `undefined`). |
| `encode` / `decode` | An encoding of your own, on top of the URL's. Default: none. |
| `key` | Override the URL parameter name (otherwise uses the property name). |
| `history` | `"push"` creates a back-button entry per change; `"replace"` does not. |
| `entries` | `"single"` (default) or `"multiple"` — see below. |
| `debounce` | `false` disables; `{ idleMs, maxWaitMs }` overrides; `null` falls back to the global option. |
| `previousKeys` | Migration from older URL key names — see below. |

### Multiple-entry parameters (arrays)

Set `entries: "multiple"` for properties that map to repeated query keys like `?tag=js&tag=ts`:

```ts
tags: {
  entries: "multiple",
  resolve: (query, _param, index) => String(query),
}
```

The property must be an array. `serialize`/`encode` are applied per element. `resolve` is called once per entry, with `index` set.

## Options

Second-tier defaults applied to every handler in the call:

```ts
URLParameterize(this, handlers, {
  prefix: () => "app_",          // string | () => string. Prepended to every key.
  onDestroy,                     // Svelte's onDestroy — auto-wires cleanup.
  debounce: { idleMs: 200, maxWaitMs: 800 },
  history: "replace",
  encode, decode, serialize, deserialize,
});
```

### Reactive prefix

When `prefix` is a function, it is tracked reactively. Changing what the getter returns moves every parameter to the new prefix (using `replace`-history, as one history change), preserving values and each handler's own `key`. This is the supported way to scope multiple instances of the same model — e.g. one instance per array index. Moving onto a key another instance tracks throws, as a conflict on mount does: clean up the instance that held it first.

You can also imperatively trigger a prefix change:

```ts
const { prefix } = URLParameterize(this, handlers);
prefix("v2_");
```

## Debouncing

URL writes can be coalesced per-parameter:

- `idleMs` — flush this many ms after the last mutation.
- `maxWaitMs` — hard upper bound; force-flush even if mutations keep arriving. Must be `≥ idleMs`.

Pending writes are flushed on `visibilitychange`, `pagehide`, and `beforeunload`, so navigation never drops state.

Per-handler `debounce` overrides the global option. Set `debounce: false` on a handler to opt out when a global is configured.

## Legacy key migration (`previousKeys`)

Used when renaming a URL parameter without breaking links already in the wild:

```ts
{
  hello: {
    resolve: (q) => typeof q === "string" ? q : "hi",
    previousKeys: [
      { fullname: "greeting", apply: true, remove: true, behavior: "replace" },
    ],
  }
}
```

On mount, for each entry whose old key is in the URL:
- `apply` (default `true`) — if the old key is present, read its value into the property.
- `remove` (default `true`) — strip the old key from the URL.
- `behavior` (default `"replace"`) — history mode used to strip.

`fullname` is matched verbatim (no prefix is prepended).

## Defaults

The defaults applied to omitted fields are exported for inspection or composition:

```ts
import { defaults } from "...";
// { history, entries, debounce, encode, decode, serialize, deserialize, previousKeys }
```

## TypeScript

The `URLParameterize` namespace re-exports the relevant types:

```ts
import type { URLParameterize as UP } from "...";

const handlers: UP.Handlers<Model> = { /* ... */ };
const options: UP.Options = { /* ... */ };
const ret: UP.Return = model.url;
```

## Caveats

- Requires a browser environment with the History API. Outside a browser (SSR) importing and calling it is safe and does nothing; in a browser without the History API it logs an error and does nothing. The returned `cleanup`/`prefix` functions are always safe to call.
- Every tracked property must have a unique fully-qualified key (prefix + key). Conflicting registrations throw on mount — use distinct `key` overrides or distinct prefixes.
- The utility remembers, per parameter, what the URL last held and what the property was last synced at, so `resolve` runs only when a parameter's value in the URL changes, and the URL is written only when a property's value changes. A URL value written differently from how it would be serialized (by hand, or by an older version) is read, but not rewritten until the property changes.
- Links written by versions that percent-encoded values twice still read with the default `deserialize`.

## Tests

The modules carry their tests as [namespace tests](https://github.com/pmalacho-mit/suede.nests): `declare namespace` blocks of types beside the code they test, which a Vite plugin turns into Vitest tests (and which a build erases). They import the DSL through `../suede.nests.slurp`, which installing this dependency puts beside it.

- `handlers.ts` — handler defaults, keys, and the serialize/encode pipeline.
- `params.ts` — editing a URL's search params, and the registry that reads parameters into properties and decides when to write.
- `URLParameterize.svelte.ts` — the whole behavior in a browser: each test is a scenario (a URL, a tracked object, steps such as `set`, `navigate`, `back`, `prefix`, `wait`, `cleanup`) and what the URL, the history and the values are after each step.
- `debounce.ts` — validation, and timing on fake timers.
- `utils.ts` — `resolve`, and doing nothing outside a browser.

What a type cannot say (runes, timers, awaiting the back button) is played out by the harnesses in `_internal/harness.svelte.ts`, which the tests import as types: none of it reaches a build.

`URLParameterize.svelte.ts` and `debounce.ts` declare `// @vitest-environment jsdom`. To run them, give the Vitest project that runs namespace tests Svelte's client build:

```ts
{
  extends: true,
  resolve: { conditions: ["browser"] },
  plugins: [namespaceTests()],
  test: { name: "unit", environment: "node" },
}
```
