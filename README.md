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

`URLParameterize(target, handlers, options?)` returns `{ cleanup, prefix, key }`. Call `cleanup()` on destroy to tear down listeners and remove the parameters from the URL.

`key(property)` tells the URL parameter a tracked property is stored under now, its prefix included, for reading the URL yourself (on a server too, where nothing else runs). It is reactive: markup and effects that call it follow a moving prefix.

```ts
const page = new URL(href).searchParams.get(model.url.key("page"));
```

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
    in: "hash",                             // "query" (default) | "hash"
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
| `in` | The part of the URL the parameter is stored in: `"query"` (default) or `"hash"` — see below. |
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
  in: "hash",                    // every parameter in the hash, but for handlers that say otherwise
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

## The hash

With `in: "hash"` (on a handler, or in the options for every handler), a parameter is stored in the URL's hash instead of its query, written the same way: `#tab=about&q=%22x%22`. The hash is not sent to the server, and changing it does not reload the page, so it suits state only the page cares about. The hash then holds parameters, so it can't also be an anchor.

Changing the hash yourself is read like any other change. A plain link switches a tab stored there:

```svelte
<a href="#tab=about">About</a>
```

Following a `#…` link, assigning `location.hash`, or editing the hash in the address bar adds a history entry and fires `hashchange`, which URLParameterize listens for (as well as `popstate`, which browsers also fire), so the property follows it, and the back button undoes it. Your own code can listen for the same event:

```ts
window.addEventListener("hashchange", () => {
  const tab = new URLSearchParams(location.hash.slice(1)).get(model.url.key("tab"));
});
```

URLParameterize's own writes use `history.pushState`/`replaceState`, which fire neither event, and so do not scroll the page.

## Debouncing

URL writes can be coalesced per-parameter:

- `idleMs` — flush this many ms after the last mutation.
- `maxWaitMs` — hard upper bound; force-flush even if mutations keep arriving. Must be `≥ idleMs`.

Pending writes are flushed on `visibilitychange`, `pagehide`, and `beforeunload`, so leaving the page never drops state.

A debounced change made in the same action as other changes is not held back: it is written at once, in the same history entry as the rest. One still waiting when a later change is written goes first, in an entry of its own, so history keeps the order things were done in. Back, forward, or a hash change drops writes still waiting: they were made on the entry the browser left, so each such property is read again from the URL it arrived at.

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
- `in` (default: where the parameter is stored now) — where the old key is, so a parameter moved to the hash still reads links that have it in the query: `previousKeys: [{ fullname: "tab", in: "query" }]`.

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

## Large and busy state

URLParameterize parses the URL once per change, however many objects and
parameters read it, and writes every initial value at mount as one change, so
its own cost stays close to the browser's for hundreds of parameters. What
limits a large app is the URL itself:

- **Length.** The query is sent to the server on every load. Many servers
  refuse long request lines: nginx and Apache at about 8 KB by default, Node
  (and so Vite's dev server) at 16 KB, answering a reload with 414 or 431. Keep
  large values (documents, code, long lists) `in: "hash"`, which is never sent,
  or shrink them with your own `encode`/`decode`.
- **Rate.** Browsers limit how often a page may call `pushState` and
  `replaceState`; Safari, for one, throws after 100 calls in 30 seconds. Each
  change to a tracked property is one call, so a text field written on every
  keystroke can reach the limit while someone types. Give text fields a
  `debounce`.
- **History.** Whatever one action changes (one event handler, one tick) is
  one history entry, however many properties and tracked objects it touches,
  so a "reset" button takes one press of Back to undo. Changes made in separate
  ticks (either side of an `await`, say) are separate entries. Use
  `history: "replace"` for properties that are not navigation.

## Caveats

- Requires a browser environment with the History API. Outside a browser (SSR) importing and calling it is safe and does nothing; in a browser without the History API it logs an error and does nothing. The returned `cleanup`/`prefix` functions are always safe to call.
- Every tracked property must have a unique fully-qualified key (prefix + key), across the query and the hash together. Conflicting registrations throw on mount — use distinct `key` overrides or distinct prefixes.
- The utility remembers, per parameter, what the URL last held and what the property was last synced at, so `resolve` runs only when a parameter's value in the URL changes, and the URL is written only when a property's value changes. A URL value written differently from how it would be serialized (by hand, or by an older version) is read, but not rewritten until the property changes.
- Links written by versions that percent-encoded values twice still read with the default `deserialize`.

## Tests

The modules carry their tests as [namespace tests](https://github.com/pmalacho-mit/suede.nests): `declare namespace` blocks of types beside the code they test, which a Vite plugin turns into Vitest tests (and which a build erases). They import the DSL through `../suede.nests.slurp`, which installing this dependency puts beside it.

- `handlers.ts` — handler defaults, keys, and the serialize/encode pipeline.
- `params.ts` — editing a URL's search params, and the registry that reads parameters into properties and decides when to write.
- `URLParameterize.svelte.ts` — the whole behavior in a browser: each test is a scenario (a URL, a tracked object, steps such as `set`, `navigate`, `hash`, `back`, `prefix`, `wait`, `cleanup`) and what the URL (hash parameters keyed with a `#`), the history and the values are after each step.
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
