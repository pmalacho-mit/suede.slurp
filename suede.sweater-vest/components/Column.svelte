<script lang="ts">
  // Variants stacked: `<Column gap="0.5rem">…</Column>`.
  import type { Snippet } from "svelte";
  import type Self from "./Column.svelte";
  import type { Test, Widen, Sweater } from "../dsl.import.meta.vitest";

  let {
    gap = "1rem",
    align = "start",
    children,
  }: {
    gap?: string;
    align?: "start" | "center" | "end" | "stretch";
    children: Snippet;
  } = $props();
</script>

<div class="column" style:gap style:align-items={align}>
  {@render children()}
</div>

<!-- Column: variants stacked, with a Row of them nested inside -->
{#snippet stacked(
  Column: typeof Self,
  Row: typeof Sweater.Row,
  Labeled: typeof Sweater.Labeled,
)}
  <Column gap="0.5rem">
    <Labeled label="first!"><span>one</span></Labeled>
    <Row gap="0.5rem">
      <Labeled label="second"><span>two</span></Labeled>
      <Labeled label="third"><span>three</span></Labeled>
    </Row>
    <Labeled label="last"><span>four</span></Labeled>
  </Column>
{/snippet}

<!-- left alone: a 1rem gap, aligned to the start, and the children in the order written -->
{#snippet defaults(
  Column: typeof Self,
  Status: typeof Sweater.Status,
  test: Test,
)}
  <Status {test} />
  <Column>
    <span>a</span>
    <span>b</span>
    <span>c</span>
  </Column>
  {test(async ({ expect, screen }) => {
    const column = screen.getByText("a").parentElement as HTMLElement;
    expect(column.style.gap).toBe("1rem");
    expect(column.style.alignItems).toBe("start");
    expect([...column.children].map((child) => child.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
  })}
{/snippet}

<!-- every other align, each column as wide as its widest child -->
{#snippet aligned(
  Column: typeof Self,
  Status: typeof Sweater.Status,
  Row: typeof Sweater.Row,
  Labeled: typeof Sweater.Labeled,
  test: Test,
)}
  <Status {test} />
  <Row align="start">
    <Labeled label="align=center">
      <Column align="center"
        ><button>center</button><button>a wider one</button></Column
      >
    </Labeled>
    <Labeled label="align=end">
      <Column align="end"
        ><button>end</button><button>a wider one</button></Column
      >
    </Labeled>
    <Labeled label="align=stretch">
      <Column align="stretch"
        ><button>stretch</button><button>a wider one</button></Column
      >
    </Labeled>
  </Row>
  {test(async ({ expect, screen }) => {
    for (const align of ["center", "end", "stretch"]) {
      const column = screen.getByRole("button", { name: align })
        .parentElement as HTMLElement;
      expect(column.style.alignItems).toBe(align);
    }
  })}
{/snippet}

<!-- gap, of any CSS length, and align, each following its prop as it changes -->
{#snippet follows(
  Column: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { gap: Widen<"2rem">; centred: Widen<false> },
  test: Test,
)}
  <Status {test} />
  <Column gap={pocket.gap} align={pocket.centred ? "center" : "end"}>
    <span>top</span>
    <span>bottom</span>
  </Column>
  {test(async ({ expect, screen, flushSync }) => {
    const column = screen.getByText("top").parentElement as HTMLElement;
    expect(column.style.gap).toBe("2rem");
    expect(column.style.alignItems).toBe("end");
    pocket.gap = "4px";
    pocket.centred = true;
    flushSync();
    expect(column.style.gap).toBe("4px");
    expect(column.style.alignItems).toBe("center");
  })}
{/snippet}

<style>
  .column {
    display: flex;
    flex-direction: column;
  }
</style>
