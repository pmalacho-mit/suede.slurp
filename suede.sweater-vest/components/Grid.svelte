<script lang="ts">
  // A matrix of variants: `<Grid columns={3}>…</Grid>`.
  import type { Snippet } from "svelte";
  import type Self from "./Grid.svelte";
  import type { Test, Widen, Sweater } from "../dsl.import.meta.vitest";

  let {
    columns = 2,
    gap = "1rem",
    children,
  }: { columns?: number; gap?: string; children: Snippet } = $props();
</script>

<div
  class="grid"
  style:gap
  style:grid-template-columns="repeat({columns}, max-content)"
>
  {@render children()}
</div>

<!-- a matrix of variants: children fill the columns row by row, a size per column, a weight per row -->
{#snippet usage(Grid: typeof Self, Labeled: typeof Sweater.Labeled)}
  <Grid columns={3} gap="0.5rem">
    {#each ["normal", "bold"] as weight (weight)}
      {#each [12, 16, 24] as size (size)}
        <Labeled label="{weight} {size}px">
          <span style:font-weight={weight} style:font-size="{size}px">Aa</span>
        </Labeled>
      {/each}
    {/each}
  </Grid>
{/snippet}

<!-- defaults: two columns, each as wide as its widest child, 1rem apart -->
{#snippet defaults(
  Grid: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { el: HTMLDivElement },
  test: Test,
)}
  <Status {test} />
  <div bind:this={pocket.el}>
    <Grid>
      <span>a</span>
      <span>b</span>
      <span>c</span>
      <span>d</span>
    </Grid>
  </div>
  {test(async ({ expect }) => {
    const grid = pocket.el.querySelector("div")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, max-content)");
    expect(grid.style.gap).toBe("1rem");
    expect([...grid.children].map((child) => child.textContent)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  })}
{/snippet}

<!-- columns and gap set, and both following the values they are given -->
{#snippet reflows(
  Grid: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { el: HTMLDivElement; columns: Widen<3>; gap: Widen<"4px 12px"> },
  test: Test,
)}
  <Status {test} />
  <div bind:this={pocket.el}>
    <Grid columns={pocket.columns} gap={pocket.gap}>
      {#each [1, 2, 3, 4, 5, 6] as n (n)}
        <span>{n}</span>
      {/each}
    </Grid>
  </div>
  {test(async ({ expect, flushSync }) => {
    const grid = pocket.el.querySelector("div")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, max-content)");
    expect(grid.style.gap).toBe("4px 12px");
    pocket.columns = 6;
    pocket.gap = "2px";
    flushSync();
    expect(grid.style.gridTemplateColumns).toBe("repeat(6, max-content)");
    expect(grid.style.gap).toBe("2px");
  })}
{/snippet}

<style>
  .grid {
    display: grid;
    align-items: start;
  }
</style>
