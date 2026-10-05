<script lang="ts" module>
  import { onDestroy } from "svelte";
  import { URLParameterize } from "../../release";

  /**
   * The basics: a class whose `$state` property is kept in the URL (`?page=2`).
   *
   * The URL is user input, so `resolve` turns whatever is there into a valid
   * page. Handing over `onDestroy` removes the parameter when the component goes.
   */
  export class Paging {
    page = $state(1);

    readonly url = URLParameterize<Paging>(
      this,
      {
        page: (query) =>
          typeof query === "number" && Number.isInteger(query) && query >= 1
            ? query
            : 1,
      },
      { onDestroy },
    );
  }
</script>

<script lang="ts">
  import type Self from "./Pagination.svelte";
  import type {
    Test,
    Widen,
  } from "../../suede.sweater-vest/dsl.import.meta.vitest";

  const paging = new Paging();
</script>

<button onclick={() => paging.page--} disabled={paging.page === 1}>
  Previous
</button>
<span>Page {paging.page}</span>
<button onclick={() => paging.page++}>Next</button>

<!-- each page is a history entry, so the back button goes to the previous page -->
{#snippet pages(Pagination: typeof Self, test: Test)}
  <Pagination />
  {test(async ({ expect, user, screen, waitFor }) => {
    const page = () => new URL(location.href).searchParams.get("page");
    expect(page()).toBe("1");

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(page()).toBe("3");
    expect(screen.getByText("Page 3")).toBeTruthy();

    history.back();
    await waitFor(() => expect(screen.getByText("Page 2")).toBeTruthy());
    expect(page()).toBe("2");
  })}
{/snippet}

<!-- a link with ?page=4 opens on page 4; a page that makes no sense opens on page 1 -->
{#snippet startsFromTheURL(
  Pagination: typeof Self,
  pocket: { shown: Widen<false> },
  test: Test,
)}
  {#if pocket.shown}<Pagination />{/if}
  {test(async ({ expect, screen, flushSync }) => {
    history.replaceState(null, "", "?page=4");
    pocket.shown = true;
    flushSync();
    expect(screen.getByText("Page 4")).toBeTruthy();

    pocket.shown = false;
    flushSync();
    history.replaceState(null, "", "?page=-3");
    pocket.shown = true;
    flushSync();
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(new URL(location.href).searchParams.get("page")).toBe("-3");
  })}
{/snippet}
