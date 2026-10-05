# Configuration reference

Every configuration `URLParameterize` takes, each written out as you would
write it and verified by a test of its effect on the URL. The sections below
are generated from the snippets in [Configuration.svelte](./Configuration.svelte),
whose tests run with the rest (`npx vitest run --project sweater-vest`). To
regenerate them after changing a snippet:

```sh
node suede.sweater-vest/cli.ts src/examples/Configuration.svelte --markdown --header-level 2
```

`Configuration` tracks a `$state` object made from `initial` with the
`handlers` and `options` it is given (`onDestroy` included), and shows an input
for each property and the parameter it is stored under. The tests read the URL
with `query(key)` and `hash(key)`, and count history entries with `entries()`,
from [support.ts](./support.ts).

| Configuration | Set on | Sections |
| --- | --- | --- |
| `resolve` | handler (a bare function is one) | [resolveShorthand](#resolveshorthand), [booleans](#booleans), [resolveFallback](#resolvefallback) |
| `key` | handler | [key](#key) |
| `history` | handler, options | [historyPush](#historypush), [historyReplace](#historyreplace), [optionsHistory](#optionshistory) |
| `in` | handler, options | [inHash](#inhash), [optionsIn](#optionsin) |
| `entries` | handler | [multipleEntries](#multipleentries) |
| `debounce` | handler, options | [debounce](#debounce), [optionsDebounce](#optionsdebounce) |
| `serialize`, `deserialize` | handler, options | [plainText](#plaintext), [optionsSerialize](#optionsserialize) |
| `encode`, `decode` | handler, options | [encoding](#encoding) |
| `previousKeys` (`remove`, `apply`, `behavior`, `in`) | handler | [previousKeys](#previouskeys), [previousKeysKept](#previouskeyskept), [previousKeysIgnored](#previouskeysignored), [previousKeysPushed](#previouskeyspushed), [previousKeysMoved](#previouskeysmoved) |
| `prefix` | options | [prefixString](#prefixstring), [prefixGetter](#prefixgetter) |
| `onDestroy` | options | [onDestroyRemoves](#ondestroyremoves) |
| `prefix()`, `cleanup()`, `key()` | what URLParameterize returns | [prefixCall](#prefixcall), [cleanupStops](#cleanupstops), [prefixString](#prefixstring) |

A handler's own setting wins over the options', which win over the defaults.


### resolveShorthand

A bare function is a handler's resolve: it turns whatever is in the URL into the property's value.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { count } from "./support";
</script>

<Configuration initial={{ page: 1 }} handlers={{ page: count }} />
```

Verified by:

```ts
expect(query("page")).toBe("1");
const page = screen.getByLabelText("page");
await user.clear(page);
await user.type(page, "3");
expect(query("page")).toBe("3");
```

### key

key: the parameter's name in the URL, instead of the property's.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ search: "svelte" }}
  handlers={{ search: { resolve: text, key: "q" } }}
/>
```

Verified by:

```ts
expect(query("q")).toBe('"svelte"');
expect(query("search")).toBeNull();
expect(screen.getByLabelText("search parameter").textContent).toBe("q");
```

### historyPush

history: "push" (the default) makes each change a history entry, which back undoes.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration initial={{ q: "" }} handlers={{ q: text }} />
```

Verified by:

```ts
const added = entries();
const input = screen.getByLabelText<HTMLInputElement>("q");
await user.type(input, "ab");
expect(added()).toBe(2);
history.back();
await waitFor(() => expect(input.value).toBe("a"));
```

### booleans

A boolean is written as true or false; flag reads anything else as false.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { flag } from "./support";
</script>

<Configuration initial={{ dark: false }} handlers={{ dark: flag }} />
```

Verified by:

```ts
expect(query("dark")).toBe("false");
await user.click(screen.getByLabelText("dark"));
expect(query("dark")).toBe("true");
```

### resolveFallback

A parameter removed from the URL is resolved from undefined, so resolve's fallback applies.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { count } from "./support";
</script>

<Configuration initial={{ page: 5 }} handlers={{ page: count }} />
```

Verified by:

```ts
expect(query("page")).toBe("5");
history.pushState({}, "", "?");
flushSync();
expect(screen.getByLabelText<HTMLInputElement>("page").value).toBe("0");
```

### historyReplace

history: "replace" writes changes without history entries: for state that is not a navigation.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ q: "" }}
  handlers={{ q: { resolve: text, history: "replace" } }}
/>
```

Verified by:

```ts
const added = entries();
await user.type(screen.getByLabelText("q"), "ab");
expect(query("q")).toBe('"ab"');
expect(added()).toBe(0);
```

### inHash

in: "hash" stores the parameter in the URL's hash instead of its query.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ q: "init" }}
  handlers={{ q: { resolve: text, in: "hash" } }}
/>
```

Verified by:

```ts
expect(hash("q")).toBe('"init"');
expect(query("q")).toBeNull();
```

### multipleEntries

entries: "multiple" stores an array as one entry per element; resolve is called per entry.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ tags: ["js"] }}
  handlers={{ tags: { resolve: text, entries: "multiple" } }}
/>
```

Verified by:

```ts
expect(query("tags")).toBe('"js"');
const tags = screen.getByLabelText<HTMLInputElement>("tags");
await user.clear(tags);
await user.type(tags, "js,ts");
expect(query("tags")).toEqual(['"js"', '"ts"']);

history.pushState({}, "", '?tags="svelte"');
flushSync();
expect(tags.value).toBe("svelte");
```

### debounce

debounce: changes are written once they pause for idleMs, and at least every maxWaitMs.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ q: "" }}
  handlers={{ q: { resolve: text, debounce: { idleMs: 100, maxWaitMs: 1000 } } }}
/>
```

Verified by:

```ts
const added = entries();
await user.type(screen.getByLabelText("q"), "abc");
expect(query("q")).toBe('""');
await waitFor(() => expect(query("q")).toBe('"abc"'));
expect(added()).toBe(1);
```

### plainText

serialize and deserialize: how a value becomes text and back. Here, plain text instead of JSON.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ q: "hello world" }}
  handlers={{
    q: { resolve: text, serialize: (q) => q, deserialize: (q) => q },
  }}
/>
```

Verified by:

```ts
expect(query("q")).toBe("hello world");
expect(location.search).toBe("?q=hello+world");
```

### encoding

encode and decode: an encoding of your own on top of the URL's (base64, compression).

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ q: "hi" }}
  handlers={{ q: { resolve: text, encode: btoa, decode: atob } }}
/>
```

Verified by:

```ts
expect(query("q")).toBe(btoa('"hi"'));
history.pushState({}, "", `?q=${btoa('"there"')}`);
flushSync();
expect(screen.getByLabelText<HTMLInputElement>("q").value).toBe("there");
```

### previousKeys

previousKeys: a link with an old key is read, and the old key replaced by the new one.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let shown = $state(false);
</script>

{#if shown}
  <Configuration
    initial={{ q: "init" }}
    handlers={{ q: { resolve: text, previousKeys: [{ fullname: "query" }] } }}
  />
{/if}
```

Verified by:

```ts
visit('?query="old"');
const added = entries();
shown = true;
flushSync();
expect(query("q")).toBe('"old"');
expect(query("query")).toBeNull();
expect(added()).toBe(0);
```

### previousKeysKept

previousKeys with remove: false reads the old key and leaves it in the URL.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let shown = $state(false);
</script>

{#if shown}
  <Configuration
    initial={{ q: "init" }}
    handlers={{
      q: { resolve: text, previousKeys: [{ fullname: "query", remove: false }] },
    }}
  />
{/if}
```

Verified by:

```ts
visit('?query="old"');
shown = true;
flushSync();
expect(query("q")).toBe('"old"');
expect(query("query")).toBe('"old"');
```

### previousKeysIgnored

previousKeys with apply: false only removes the old key; its value is not read.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let shown = $state(false);
</script>

{#if shown}
  <Configuration
    initial={{ q: "init" }}
    handlers={{
      q: { resolve: text, previousKeys: [{ fullname: "query", apply: false }] },
    }}
  />
{/if}
```

Verified by:

```ts
visit('?query="old"');
shown = true;
flushSync();
expect(query("q")).toBe('"init"');
expect(query("query")).toBeNull();
```

### previousKeysPushed

previousKeys with behavior: "push" removes the old key as a history entry of its own.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let shown = $state(false);
</script>

{#if shown}
  <Configuration
    initial={{ q: "init" }}
    handlers={{
      q: { resolve: text, previousKeys: [{ fullname: "query", behavior: "push" }] },
    }}
  />
{/if}
```

Verified by:

```ts
visit('?query="old"');
const added = entries();
shown = true;
flushSync();
expect(query("query")).toBeNull();
expect(added()).toBe(1);
```

### previousKeysMoved

previousKeys with in: "query": a parameter moved to the hash still reads old links' query.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let shown = $state(false);
</script>

{#if shown}
  <Configuration
    initial={{ q: "init" }}
    handlers={{
      q: {
        resolve: text,
        in: "hash",
        previousKeys: [{ fullname: "q", in: "query" }],
      },
    }}
  />
{/if}
```

Verified by:

```ts
visit('?q="old"');
shown = true;
flushSync();
expect(hash("q")).toBe('"old"');
expect(query("q")).toBeNull();
```

### prefixString

options.prefix: a string put before every parameter's key, the handler's own key included.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { count, text } from "./support";
</script>

<Configuration
  initial={{ search: "", page: 1 }}
  handlers={{ search: { resolve: text, key: "q" }, page: count }}
  options={{ prefix: "app_" }}
/>
```

Verified by:

```ts
expect(query("app_q")).toBe('""');
expect(query("app_page")).toBe("1");
expect(screen.getByLabelText("search parameter").textContent).toBe("app_q");
```

### prefixGetter

options.prefix as a getter: when what it reads changes, the parameters move, without a history entry.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let prefix = $state("a_");
</script>

<Configuration
  initial={{ q: "x" }}
  handlers={{ q: text }}
  options={{ prefix: () => prefix }}
/>
```

Verified by:

```ts
expect(query("a_q")).toBe('"x"');
const added = entries();
prefix = "b_";
flushSync();
expect(query("b_q")).toBe('"x"');
expect(query("a_q")).toBeNull();
expect(added()).toBe(0);
expect(screen.getByLabelText("q parameter").textContent).toBe("b_q");
```

### prefixCall

prefix(): the function URLParameterize returns moves the parameters too.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let panel = $state<Configuration>();
</script>

<Configuration
  bind:this={panel}
  initial={{ search: "x" }}
  handlers={{ search: { resolve: text, key: "q" } }}
/>
```

Verified by:

```ts
panel.prefix("v2_");
flushSync();
expect(query("v2_q")).toBe('"x"');
expect(query("q")).toBeNull();
```

### optionsHistory

options.history applies to every handler; a handler's own history wins.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ draft: "", title: "" }}
  handlers={{ draft: text, title: { resolve: text, history: "push" } }}
  options={{ history: "replace" }}
/>
```

Verified by:

```ts
const added = entries();
await user.type(screen.getByLabelText("draft"), "abc");
expect(added()).toBe(0);
await user.type(screen.getByLabelText("title"), "a");
expect(added()).toBe(1);
```

### optionsIn

options.in applies to every handler; a handler's own in wins.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { count, text } from "./support";
</script>

<Configuration
  initial={{ tab: "home", page: 1 }}
  handlers={{ tab: text, page: { resolve: count, in: "query" } }}
  options={{ in: "hash" }}
/>
```

Verified by:

```ts
expect(hash("tab")).toBe('"home"');
expect(query("page")).toBe("1");
expect(hash("page")).toBeNull();
```

### optionsDebounce

options.debounce applies to every handler; debounce: false opts one out.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";
</script>

<Configuration
  initial={{ slow: "", fast: "" }}
  handlers={{ slow: text, fast: { resolve: text, debounce: false } }}
  options={{ debounce: { idleMs: 100, maxWaitMs: 1000 } }}
/>
```

Verified by:

```ts
await user.type(screen.getByLabelText("fast"), "a");
expect(query("fast")).toBe('"a"');
await user.type(screen.getByLabelText("slow"), "a");
expect(query("slow")).toBe('""');
await waitFor(() => expect(query("slow")).toBe('"a"'));
```

### optionsSerialize

options.serialize (and deserialize, encode, decode) apply to every handler. Here, plain text for all; the default deserialize still reads numbers, and text that is not JSON as text.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { count, text } from "./support";
</script>

<Configuration
  initial={{ q: "hello", page: 3 }}
  handlers={{ q: text, page: count }}
  options={{ serialize: String }}
/>
```

Verified by:

```ts
expect(query("q")).toBe("hello");
expect(query("page")).toBe("3");
history.pushState({}, "", "?q=there&page=7");
flushSync();
expect(screen.getByLabelText<HTMLInputElement>("q").value).toBe("there");
expect(screen.getByLabelText<HTMLInputElement>("page").value).toBe("7");
```

### onDestroyRemoves

options.onDestroy: handed Svelte's onDestroy, the parameters leave the URL with the component.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let shown = $state(true);
</script>

{#if shown}
  <Configuration initial={{ q: "x" }} handlers={{ q: text }} />
{/if}
```

Verified by:

```ts
expect(query("q")).toBe('"x"');
const added = entries();
shown = false;
flushSync();
expect(query("q")).toBeNull();
expect(added()).toBe(0);
```

### cleanupStops

cleanup(): stops tracking and removes the parameters, whenever you call it.

```svelte
<script lang="ts">
  import Configuration from "./Configuration.svelte";
  import { text } from "./support";

  let panel = $state<Configuration>();
</script>

<Configuration
  bind:this={panel}
  initial={{ q: "x" }}
  handlers={{ q: text }}
/>
```

Verified by:

```ts
panel.cleanup();
expect(query("q")).toBeNull();
await user.type(screen.getByLabelText("q"), "y");
expect(query("q")).toBeNull();
```
