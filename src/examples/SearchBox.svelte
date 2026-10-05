<script lang="ts" module>
  import { onDestroy } from "svelte";
  import { URLParameterize } from "../../release";

  /**
   * A search that writes to the URL once typing pauses (`debounce`), as plain
   * text (`?q=svelte`), and leaves the URL when empty (`serialize` returning
   * `undefined` removes the parameter).
   *
   * It used to be stored as `?query=…`: `previousKeys` reads links from back
   * then, and moves them to `?q=`.
   */
  export class Search {
    query = $state("");

    readonly url = URLParameterize<Search>(
      this,
      {
        query: {
          key: "q",
          serialize: (query) => query || undefined,
          // Written as plain text, so read as plain text: the default (JSON)
          // would read ?q=42 as the number 42.
          deserialize: (query) => query,
          resolve: (query) => (typeof query === "string" ? query : ""),
          debounce: { idleMs: 250, maxWaitMs: 1000 },
          previousKeys: [{ fullname: "query" }],
        },
      },
      { onDestroy },
    );
  }
</script>

<script lang="ts">
  import type Self from "./SearchBox.svelte";
  import type {
    Test,
    Widen,
  } from "../../suede.sweater-vest/dsl.import.meta.vitest";

  const search = new Search();
</script>

<input type="search" aria-label="Search" bind:value={search.query} />

<!-- typing is written once it pauses, as one history entry; an empty search leaves the URL -->
{#snippet debounces(SearchBox: typeof Self, test: Test)}
  <SearchBox />
  {test(async ({ expect, user, screen, waitFor }) => {
    const q = () => new URL(location.href).searchParams.get("q");
    const input = screen.getByRole("searchbox", { name: "Search" });
    expect(q()).toBeNull();
    const entries = history.length;

    await user.type(input, "svelte");
    expect(q()).toBeNull();
    await waitFor(() => expect(q()).toBe("svelte"));
    expect(history.length).toBe(entries + 1);

    await user.clear(input);
    await waitFor(() => expect(q()).toBeNull());
  })}
{/snippet}

<!-- an old link, ?query=…, still opens the search, and is moved to ?q= -->
{#snippet readsOldLinks(
  SearchBox: typeof Self,
  pocket: { shown: Widen<false> },
  test: Test,
)}
  {#if pocket.shown}<SearchBox />{/if}
  {test(async ({ expect, screen, flushSync }) => {
    history.replaceState(null, "", "?query=42");
    pocket.shown = true;
    flushSync();
    const input = screen.getByRole<HTMLInputElement>("searchbox");
    expect(input.value).toBe("42");
    const params = new URL(location.href).searchParams;
    expect(params.get("q")).toBe("42");
    expect(params.has("query")).toBe(false);
  })}
{/snippet}
