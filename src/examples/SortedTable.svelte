<script lang="ts" module>
  import { onDestroy } from "svelte";
  import { URLParameterize } from "../../release";

  export type Column = "name" | "size";

  export const files = [
    { name: "b.txt", size: 30 },
    { name: "a.txt", size: 20 },
    { name: "c.txt", size: 10 },
  ];

  /**
   * Verbose handlers: an object instead of a bare resolve function, to choose
   * the parameter's `key`, its `history` behavior, and how it is written.
   *
   * Re-sorting is not a navigation, so it uses `history: "replace"`: the back
   * button leaves the page instead of undoing each sort. The column is written
   * as plain text (`?sort=size`, not `?sort="size"`) by serializing it as itself.
   */
  export class Sorting {
    column = $state<Column>("name");
    descending = $state(false);

    readonly url = URLParameterize<Sorting>(
      this,
      {
        column: {
          key: "sort",
          serialize: (column) => column,
          resolve: (query) => (query === "size" ? "size" : "name"),
        },
        descending: { key: "desc", resolve: (query) => query === true },
      },
      { history: "replace", onDestroy },
    );

    sortBy(column: Column) {
      this.descending = this.column === column && !this.descending;
      this.column = column;
    }
  }
</script>

<script lang="ts">
  import type Self from "./SortedTable.svelte";
  import type { Test } from "../../suede.sweater-vest/dsl.import.meta.vitest";

  const sorting = new Sorting();
  const sorted = $derived(
    [...files].sort((a, b) => {
      const order =
        sorting.column === "size"
          ? a.size - b.size
          : a.name.localeCompare(b.name);
      return sorting.descending ? -order : order;
    }),
  );
</script>

<table>
  <thead>
    <tr>
      <th><button onclick={() => sorting.sortBy("name")}>Name</button></th>
      <th><button onclick={() => sorting.sortBy("size")}>Size</button></th>
    </tr>
  </thead>
  <tbody>
    {#each sorted as file (file.name)}
      <tr><td>{file.name}</td><td>{file.size}</td></tr>
    {/each}
  </tbody>
</table>

<!-- sorting is written as ?sort=size&desc=true, replacing the history entry instead of adding one -->
{#snippet sorts(SortedTable: typeof Self, test: Test)}
  <SortedTable />
  {test(async ({ expect, user, screen }) => {
    const params = () => new URL(location.href).searchParams;
    const names = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.firstElementChild!.textContent);
    expect(names()).toEqual(["a.txt", "b.txt", "c.txt"]);
    const entries = history.length;

    await user.click(screen.getByRole("button", { name: "Size" }));
    expect(params().get("sort")).toBe("size");
    expect(names()).toEqual(["c.txt", "a.txt", "b.txt"]);

    await user.click(screen.getByRole("button", { name: "Size" }));
    expect(params().get("desc")).toBe("true");
    expect(names()).toEqual(["b.txt", "a.txt", "c.txt"]);
    expect(history.length).toBe(entries);
  })}
{/snippet}
