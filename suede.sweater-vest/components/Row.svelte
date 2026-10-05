<script lang="ts">
  // Variants side by side: `<Row gap="1rem">…</Row>`.
  import type { Snippet } from "svelte";
  import type Self from "./Row.svelte";
  import type { Test, Widen, Sweater } from "../dsl.import.meta.vitest";

  let {
    gap = "1rem",
    align = "center",
    wrap = true,
    children,
  }: {
    gap?: string;
    align?: "start" | "center" | "end" | "stretch";
    wrap?: boolean;
    children: Snippet;
  } = $props();
</script>

<div
  class="row"
  style:gap
  style:align-items={align}
  style:flex-wrap={wrap ? "wrap" : "nowrap"}
>
  {@render children()}
</div>

<!-- variants side by side, a gap apart, lined up along their bottoms -->
{#snippet usage(Row: typeof Self, Labeled: typeof Sweater.Labeled)}
  <Row gap="2rem" align="end">
    <Labeled label="size=small"><span style="font-size: 12px">Aa</span></Labeled
    >
    <Labeled label="size=medium"
      ><span style="font-size: 18px">Aa</span></Labeled
    >
    <Labeled label="size=large"><span style="font-size: 24px">Aa</span></Labeled
    >
  </Row>
{/snippet}

<!-- left alone: a 1rem gap, centred, wrapping, and the children in the order written -->
{#snippet defaults(
  Row: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { el: HTMLDivElement },
  test: Test,
)}
  <Status {test} />
  <div bind:this={pocket.el}>
    <Row>
      <span>a</span>
      <span>b</span>
      <span>c</span>
    </Row>
  </div>
  {test(async ({ expect }) => {
    const row = pocket.el.firstElementChild as HTMLElement;
    expect(row.style.gap).toBe("1rem");
    expect(row.style.alignItems).toBe("center");
    expect(row.style.flexWrap).toBe("wrap");
    expect([...row.children].map((child) => child.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
  })}
{/snippet}

<!-- every prop written, and followed when it changes: a gap, an alignment, wrapping -->
{#snippet overrides(
  Row: typeof Self,
  Status: typeof Sweater.Status,
  pocket: {
    el: HTMLDivElement;
    gap: Widen<"0.25rem">;
    stretch: Widen<false>;
    wrap: Widen<false>;
  },
  test: Test,
)}
  <Status {test} />
  <div bind:this={pocket.el}>
    <Row
      gap={pocket.gap}
      align={pocket.stretch ? "stretch" : "start"}
      wrap={pocket.wrap}
    >
      <span>one</span>
      <span>two</span>
    </Row>
  </div>
  {test(async ({ expect, flushSync }) => {
    const row = pocket.el.firstElementChild as HTMLElement;
    expect(row.style.gap).toBe("0.25rem");
    expect(row.style.alignItems).toBe("start");
    expect(row.style.flexWrap).toBe("nowrap");
    pocket.gap = "3px";
    pocket.stretch = true;
    pocket.wrap = true;
    flushSync();
    expect(row.style.gap).toBe("3px");
    expect(row.style.alignItems).toBe("stretch");
    expect(row.style.flexWrap).toBe("wrap");
  })}
{/snippet}

<style>
  .row {
    display: flex;
    flex-direction: row;
  }
</style>
