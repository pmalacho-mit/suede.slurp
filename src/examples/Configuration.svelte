<script lang="ts">
  /*
   * A reference for every configuration URLParameterize takes. This component
   * tracks a `$state` object made from `initial` with the `handlers` and
   * `options` it is given, and shows an input for each property and the URL
   * parameter it is stored under. Each snippet below is one configuration,
   * written out as you would write it, with a test of its effect on the URL.
   */
  import { onDestroy, untrack } from "svelte";
  import { URLParameterize } from "../../release";
  import type Self from "./Configuration.svelte";
  import type {
    Test,
    Widen,
  } from "../../suede.sweater-vest/dsl.import.meta.vitest";
  import { count, entries, flag, hash, query, text, visit } from "./support";

  type Value = string | number | boolean | string[];

  let {
    initial,
    handlers,
    options = {},
  }: {
    initial: Record<string, Value | undefined>;
    handlers: Partial<URLParameterize.Handlers<Record<string, any>>>;
    options?: URLParameterize.Options;
  } = $props();

  const values: Record<string, any> = $state(untrack(() => ({ ...initial })));
  const url = untrack(() =>
    URLParameterize(values, handlers, { onDestroy, ...options }),
  );

  /** The `prefix` function URLParameterize returned. */
  export const prefix = (prefix: string) => url.prefix(prefix);
  /** The `cleanup` function URLParameterize returned. */
  export const cleanup = () => url.cleanup();

  const set = (name: string, input: HTMLInputElement) => {
    const current = values[name];
    values[name] =
      typeof current === "number"
        ? Number(input.value)
        : typeof current === "boolean"
          ? input.checked
          : Array.isArray(current)
            ? input.value.split(",").filter(Boolean)
            : input.value;
  };
</script>

<dl>
  {#each Object.keys(values) as name (name)}
    {@const value = values[name]}
    <dt><label for="input-{name}">{name}</label></dt>
    <dd>
      {#if typeof value === "boolean"}
        <input
          id="input-{name}"
          type="checkbox"
          checked={value}
          onchange={(e) => set(name, e.currentTarget)}
        />
      {:else}
        <input
          id="input-{name}"
          type={typeof value === "number" ? "number" : "text"}
          value={Array.isArray(value) ? value.join(",") : (value ?? "")}
          oninput={(e) => set(name, e.currentTarget)}
        />
      {/if}
      <output aria-label="{name} parameter">{url.key(name)}</output>
    </dd>
  {/each}
</dl>

<!-- A bare function is a handler's resolve: it turns whatever is in the URL into the property's value. -->
{#snippet resolveShorthand(Configuration: typeof Self, test: Test)}
  <Configuration initial={{ page: 1 }} handlers={{ page: count }} />
  {test(async ({ expect, user, screen }) => {
    expect(query("page")).toBe("1");
    const page = screen.getByLabelText("page");
    await user.clear(page);
    await user.type(page, "3");
    expect(query("page")).toBe("3");
  })}
{/snippet}

<!-- key: the parameter's name in the URL, instead of the property's. -->
{#snippet key(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ search: "svelte" }}
    handlers={{ search: { resolve: text, key: "q" } }}
  />
  {test(async ({ expect, screen }) => {
    expect(query("q")).toBe('"svelte"');
    expect(query("search")).toBeNull();
    expect(screen.getByLabelText("search parameter").textContent).toBe("q");
  })}
{/snippet}

<!-- history: "push" (the default) makes each change a history entry, which back undoes. -->
{#snippet historyPush(Configuration: typeof Self, test: Test)}
  <Configuration initial={{ q: "" }} handlers={{ q: text }} />
  {test(async ({ expect, user, screen, waitFor }) => {
    const added = entries();
    const input = screen.getByLabelText<HTMLInputElement>("q");
    await user.type(input, "ab");
    expect(added()).toBe(2);
    history.back();
    await waitFor(() => expect(input.value).toBe("a"));
  })}
{/snippet}

<!-- A boolean is written as true or false; flag reads anything else as false. -->
{#snippet booleans(Configuration: typeof Self, test: Test)}
  <Configuration initial={{ dark: false }} handlers={{ dark: flag }} />
  {test(async ({ expect, user, screen }) => {
    expect(query("dark")).toBe("false");
    await user.click(screen.getByLabelText("dark"));
    expect(query("dark")).toBe("true");
  })}
{/snippet}

<!-- A parameter removed from the URL is resolved from undefined, so resolve's fallback applies. -->
{#snippet resolveFallback(Configuration: typeof Self, test: Test)}
  <Configuration initial={{ page: 5 }} handlers={{ page: count }} />
  {test(async ({ expect, screen, flushSync }) => {
    expect(query("page")).toBe("5");
    history.pushState({}, "", "?");
    flushSync();
    expect(screen.getByLabelText<HTMLInputElement>("page").value).toBe("0");
  })}
{/snippet}

<!-- history: "replace" writes changes without history entries: for state that is not a navigation. -->
{#snippet historyReplace(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ q: "" }}
    handlers={{ q: { resolve: text, history: "replace" } }}
  />
  {test(async ({ expect, user, screen }) => {
    const added = entries();
    await user.type(screen.getByLabelText("q"), "ab");
    expect(query("q")).toBe('"ab"');
    expect(added()).toBe(0);
  })}
{/snippet}

<!-- in: "hash" stores the parameter in the URL's hash instead of its query. -->
{#snippet inHash(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ q: "init" }}
    handlers={{ q: { resolve: text, in: "hash" } }}
  />
  {test(async ({ expect }) => {
    expect(hash("q")).toBe('"init"');
    expect(query("q")).toBeNull();
  })}
{/snippet}

<!-- entries: "multiple" stores an array as one entry per element; resolve is called per entry. -->
{#snippet multipleEntries(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ tags: ["js"] }}
    handlers={{ tags: { resolve: text, entries: "multiple" } }}
  />
  {test(async ({ expect, user, screen, flushSync }) => {
    expect(query("tags")).toBe('"js"');
    const tags = screen.getByLabelText<HTMLInputElement>("tags");
    await user.clear(tags);
    await user.type(tags, "js,ts");
    expect(query("tags")).toEqual(['"js"', '"ts"']);

    history.pushState({}, "", '?tags="svelte"');
    flushSync();
    expect(tags.value).toBe("svelte");
  })}
{/snippet}

<!-- debounce: changes are written once they pause for idleMs, and at least every maxWaitMs. -->
{#snippet debounce(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ q: "" }}
    handlers={{
      q: { resolve: text, debounce: { idleMs: 100, maxWaitMs: 1000 } },
    }}
  />
  {test(async ({ expect, user, screen, waitFor }) => {
    const added = entries();
    await user.type(screen.getByLabelText("q"), "abc");
    expect(query("q")).toBe('""');
    await waitFor(() => expect(query("q")).toBe('"abc"'));
    expect(added()).toBe(1);
  })}
{/snippet}

<!-- serialize and deserialize: how a value becomes text and back. Here, plain text instead of JSON. -->
{#snippet plainText(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ q: "hello world" }}
    handlers={{
      q: { resolve: text, serialize: (q) => q, deserialize: (q) => q },
    }}
  />
  {test(async ({ expect }) => {
    expect(query("q")).toBe("hello world");
    expect(location.search).toBe("?q=hello+world");
  })}
{/snippet}

<!-- encode and decode: an encoding of your own on top of the URL's (base64, compression). -->
{#snippet encoding(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ q: "hi" }}
    handlers={{ q: { resolve: text, encode: btoa, decode: atob } }}
  />
  {test(async ({ expect, screen, flushSync }) => {
    expect(query("q")).toBe(btoa('"hi"'));
    history.pushState({}, "", `?q=${btoa('"there"')}`);
    flushSync();
    expect(screen.getByLabelText<HTMLInputElement>("q").value).toBe("there");
  })}
{/snippet}

<!-- previousKeys: a link with an old key is read, and the old key replaced by the new one. -->
{#snippet previousKeys(
  Configuration: typeof Self,
  pocket: { shown: Widen<false> },
  test: Test,
)}
  {#if pocket.shown}
    <Configuration
      initial={{ q: "init" }}
      handlers={{ q: { resolve: text, previousKeys: [{ fullname: "query" }] } }}
    />
  {/if}
  {test(async ({ expect, flushSync }) => {
    visit('?query="old"');
    const added = entries();
    pocket.shown = true;
    flushSync();
    expect(query("q")).toBe('"old"');
    expect(query("query")).toBeNull();
    expect(added()).toBe(0);
  })}
{/snippet}

<!-- previousKeys with remove: false reads the old key and leaves it in the URL. -->
{#snippet previousKeysKept(
  Configuration: typeof Self,
  pocket: { shown: Widen<false> },
  test: Test,
)}
  {#if pocket.shown}
    <Configuration
      initial={{ q: "init" }}
      handlers={{
        q: {
          resolve: text,
          previousKeys: [{ fullname: "query", remove: false }],
        },
      }}
    />
  {/if}
  {test(async ({ expect, flushSync }) => {
    visit('?query="old"');
    pocket.shown = true;
    flushSync();
    expect(query("q")).toBe('"old"');
    expect(query("query")).toBe('"old"');
  })}
{/snippet}

<!-- previousKeys with apply: false only removes the old key; its value is not read. -->
{#snippet previousKeysIgnored(
  Configuration: typeof Self,
  pocket: { shown: Widen<false> },
  test: Test,
)}
  {#if pocket.shown}
    <Configuration
      initial={{ q: "init" }}
      handlers={{
        q: {
          resolve: text,
          previousKeys: [{ fullname: "query", apply: false }],
        },
      }}
    />
  {/if}
  {test(async ({ expect, flushSync }) => {
    visit('?query="old"');
    pocket.shown = true;
    flushSync();
    expect(query("q")).toBe('"init"');
    expect(query("query")).toBeNull();
  })}
{/snippet}

<!-- previousKeys with behavior: "push" removes the old key as a history entry of its own. -->
{#snippet previousKeysPushed(
  Configuration: typeof Self,
  pocket: { shown: Widen<false> },
  test: Test,
)}
  {#if pocket.shown}
    <Configuration
      initial={{ q: "init" }}
      handlers={{
        q: {
          resolve: text,
          previousKeys: [{ fullname: "query", behavior: "push" }],
        },
      }}
    />
  {/if}
  {test(async ({ expect, flushSync }) => {
    visit('?query="old"');
    const added = entries();
    pocket.shown = true;
    flushSync();
    expect(query("query")).toBeNull();
    expect(added()).toBe(1);
  })}
{/snippet}

<!-- previousKeys with in: "query": a parameter moved to the hash still reads old links' query. -->
{#snippet previousKeysMoved(
  Configuration: typeof Self,
  pocket: { shown: Widen<false> },
  test: Test,
)}
  {#if pocket.shown}
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
  {test(async ({ expect, flushSync }) => {
    visit('?q="old"');
    pocket.shown = true;
    flushSync();
    expect(hash("q")).toBe('"old"');
    expect(query("q")).toBeNull();
  })}
{/snippet}

<!-- options.prefix: a string put before every parameter's key, the handler's own key included. -->
{#snippet prefixString(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ search: "", page: 1 }}
    handlers={{ search: { resolve: text, key: "q" }, page: count }}
    options={{ prefix: "app_" }}
  />
  {test(async ({ expect, screen }) => {
    expect(query("app_q")).toBe('""');
    expect(query("app_page")).toBe("1");
    expect(screen.getByLabelText("search parameter").textContent).toBe("app_q");
  })}
{/snippet}

<!-- options.prefix as a getter: when what it reads changes, the parameters move, without a history entry. -->
{#snippet prefixGetter(
  Configuration: typeof Self,
  pocket: { prefix: Widen<"a_"> },
  test: Test,
)}
  <Configuration
    initial={{ q: "x" }}
    handlers={{ q: text }}
    options={{ prefix: () => pocket.prefix }}
  />
  {test(async ({ expect, screen, flushSync }) => {
    expect(query("a_q")).toBe('"x"');
    const added = entries();
    pocket.prefix = "b_";
    flushSync();
    expect(query("b_q")).toBe('"x"');
    expect(query("a_q")).toBeNull();
    expect(added()).toBe(0);
    expect(screen.getByLabelText("q parameter").textContent).toBe("b_q");
  })}
{/snippet}

<!-- prefix(): the function URLParameterize returns moves the parameters too. -->
{#snippet prefixCall(
  Configuration: typeof Self,
  pocket: { panel: Self },
  test: Test,
)}
  <Configuration
    bind:this={pocket.panel}
    initial={{ search: "x" }}
    handlers={{ search: { resolve: text, key: "q" } }}
  />
  {test(async ({ expect, flushSync }) => {
    pocket.panel.prefix("v2_");
    flushSync();
    expect(query("v2_q")).toBe('"x"');
    expect(query("q")).toBeNull();
  })}
{/snippet}

<!-- options.history applies to every handler; a handler's own history wins. -->
{#snippet optionsHistory(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ draft: "", title: "" }}
    handlers={{ draft: text, title: { resolve: text, history: "push" } }}
    options={{ history: "replace" }}
  />
  {test(async ({ expect, user, screen }) => {
    const added = entries();
    await user.type(screen.getByLabelText("draft"), "abc");
    expect(added()).toBe(0);
    await user.type(screen.getByLabelText("title"), "a");
    expect(added()).toBe(1);
  })}
{/snippet}

<!-- options.in applies to every handler; a handler's own in wins. -->
{#snippet optionsIn(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ tab: "home", page: 1 }}
    handlers={{ tab: text, page: { resolve: count, in: "query" } }}
    options={{ in: "hash" }}
  />
  {test(async ({ expect }) => {
    expect(hash("tab")).toBe('"home"');
    expect(query("page")).toBe("1");
    expect(hash("page")).toBeNull();
  })}
{/snippet}

<!-- options.debounce applies to every handler; debounce: false opts one out. -->
{#snippet optionsDebounce(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ slow: "", fast: "" }}
    handlers={{ slow: text, fast: { resolve: text, debounce: false } }}
    options={{ debounce: { idleMs: 100, maxWaitMs: 1000 } }}
  />
  {test(async ({ expect, user, screen, waitFor }) => {
    await user.type(screen.getByLabelText("fast"), "a");
    expect(query("fast")).toBe('"a"');
    await user.type(screen.getByLabelText("slow"), "a");
    expect(query("slow")).toBe('""');
    await waitFor(() => expect(query("slow")).toBe('"a"'));
  })}
{/snippet}

<!-- options.serialize (and deserialize, encode, decode) apply to every handler. Here, plain text for all; the default deserialize still reads numbers, and text that is not JSON as text. -->
{#snippet optionsSerialize(Configuration: typeof Self, test: Test)}
  <Configuration
    initial={{ q: "hello", page: 3 }}
    handlers={{ q: text, page: count }}
    options={{ serialize: String }}
  />
  {test(async ({ expect, screen, flushSync }) => {
    expect(query("q")).toBe("hello");
    expect(query("page")).toBe("3");
    history.pushState({}, "", "?q=there&page=7");
    flushSync();
    expect(screen.getByLabelText<HTMLInputElement>("q").value).toBe("there");
    expect(screen.getByLabelText<HTMLInputElement>("page").value).toBe("7");
  })}
{/snippet}

<!-- options.onDestroy: handed Svelte's onDestroy, the parameters leave the URL with the component. -->
{#snippet onDestroyRemoves(
  Configuration: typeof Self,
  pocket: { shown: Widen<true> },
  test: Test,
)}
  {#if pocket.shown}
    <Configuration initial={{ q: "x" }} handlers={{ q: text }} />
  {/if}
  {test(async ({ expect, flushSync }) => {
    expect(query("q")).toBe('"x"');
    const added = entries();
    pocket.shown = false;
    flushSync();
    expect(query("q")).toBeNull();
    expect(added()).toBe(0);
  })}
{/snippet}

<!-- cleanup(): stops tracking and removes the parameters, whenever you call it. -->
{#snippet cleanupStops(
  Configuration: typeof Self,
  pocket: { panel: Self },
  test: Test,
)}
  <Configuration
    bind:this={pocket.panel}
    initial={{ q: "x" }}
    handlers={{ q: text }}
  />
  {test(async ({ expect, user, screen }) => {
    pocket.panel.cleanup();
    expect(query("q")).toBeNull();
    await user.type(screen.getByLabelText("q"), "y");
    expect(query("q")).toBeNull();
  })}
{/snippet}
