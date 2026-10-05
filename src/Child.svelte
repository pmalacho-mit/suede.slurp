<script lang="ts" module>
  import { onDestroy } from "svelte";
  import { URLParameterize } from "../release";

  /**
   * A search whose query is written to the URL once typing pauses, under the
   * key `q`, whose tags are repeated entries, and whose tab is kept in the hash
   * (`#tab=about`), so plain `#…` links switch it.
   */
  export class Search {
    query = $state("");
    tags = $state<string[]>([]);
    tab = $state<"home" | "about">("home");

    readonly url = URLParameterize<Search>(
      this,
      {
        query: {
          key: "q",
          resolve: (query) => (typeof query === "string" ? query : ""),
          debounce: { idleMs: 50, maxWaitMs: 200 },
        },
        tags: { entries: "multiple", resolve: (query) => String(query) },
        tab: {
          in: "hash",
          serialize: (tab) => tab,
          resolve: (query) => (query === "about" ? "about" : "home"),
        },
      },
      { onDestroy },
    );
  }
</script>

<script lang="ts">
  import type Self from "./Child.svelte";
  import type { Test } from "../suede.sweater-vest/dsl.import.meta.vitest";

  const search = new Search();
</script>

<input aria-label="Search" bind:value={search.query} />
<button onclick={() => search.tags.push(search.query)}>Tag</button>
<ul>
  {#each search.tags as tag}<li>{tag}</li>{/each}
</ul>
<nav>
  <a href="#tab=home">home</a>
  <a href="#tab=about">about</a>
</nav>
<p>Showing {search.tab}, from #{search.url.key("tab")}</p>

<!-- typing is written once it pauses, as one history entry -->
{#snippet debouncesTyping(Child: typeof Self, test: Test)}
  <Child />
  {test(async ({ expect, user, screen, waitFor }) => {
    const param = () => new URL(location.href).searchParams.get("q");
    expect(param()).toBe('""');
    const entries = history.length;

    await user.type(screen.getByRole("textbox", { name: "Search" }), "svelte");
    expect(param()).toBe('""');
    await waitFor(() => expect(param()).toBe('"svelte"'));
    expect(history.length).toBe(entries + 1);
  })}
{/snippet}

<!-- an array is written as repeated entries, and read back from them -->
{#snippet repeatsEntries(Child: typeof Self, test: Test)}
  <Child />
  {test(async ({ expect, user, screen, flushSync }) => {
    const tags = () => new URL(location.href).searchParams.getAll("tags");
    expect(tags()).toEqual([]);

    const input = screen.getByRole("textbox", { name: "Search" });
    const tag = screen.getByRole("button", { name: "Tag" });
    await user.type(input, "js");
    await user.click(tag);
    await user.clear(input);
    await user.type(input, "ts");
    await user.click(tag);
    expect(tags()).toEqual(['"js"', '"ts"']);

    const url = new URL(location.href);
    url.searchParams.delete("tags");
    url.searchParams.append("tags", '"svelte"');
    history.pushState({}, "", url);
    flushSync();
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["svelte"]);
  })}
{/snippet}

<!-- a #… link changes the hash, which fires hashchange: the tab follows it, and back again -->
{#snippet followsHashLinks(Child: typeof Self, test: Test)}
  <Child />
  {test(async ({ expect, user, screen, waitFor }) => {
    const tab = () => new URLSearchParams(location.hash.slice(1)).get("tab");
    expect(tab()).toBe("home");
    expect(screen.getByText("Showing home, from #tab")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "about" }));
    await waitFor(() =>
      expect(screen.getByText("Showing about, from #tab")).toBeTruthy(),
    );
    expect(tab()).toBe("about");

    history.back();
    await waitFor(() =>
      expect(screen.getByText("Showing home, from #tab")).toBeTruthy(),
    );
    expect(tab()).toBe("home");
  })}
{/snippet}
