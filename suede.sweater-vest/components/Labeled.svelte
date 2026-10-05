<script lang="ts">
  // A caption over a variant: `<Labeled label="tone=good"><Badge tone="good" /></Labeled>`.
  import type { Snippet } from "svelte";
  import type Self from "./Labeled.svelte";
  import type { Test, Widen, Sweater } from "../dsl.import.meta.vitest";

  let {
    label,
    children,
    below = false,
  }: { label: string; children: Snippet; below?: boolean } = $props();
</script>

<figure class="labeled" class:below>
  <figcaption>{label}</figcaption>
  <div class="content">{@render children()}</div>
</figure>

<!-- a caption over each variant, above by default or below -->
{#snippet usage(Labeled: typeof Self, Row: typeof Sweater.Row)}
  <Row>
    <Labeled label="size=small"><span style="font-size: 12px">Aa</span></Labeled
    >
    <Labeled label="size=large"><span style="font-size: 24px">Aa</span></Labeled
    >
    <Labeled label="caption below" below><span>Aa</span></Labeled>
  </Row>
{/snippet}

<!-- a figure whose figcaption is the label, and the children after it -->
{#snippet captions(
  Labeled: typeof Self,
  Status: typeof Sweater.Status,
  test: Test,
)}
  <Status {test} />
  <Labeled label="tone=good"><span>good</span></Labeled>
  {test(async ({ expect, screen, within }) => {
    const figure = screen.getByRole("figure");
    expect(figure.classList.contains("below")).toBe(false);
    const caption = within(figure).getByText("tone=good");
    expect(caption.tagName).toBe("FIGCAPTION");
    expect(figure.firstElementChild).toBe(caption);
    expect(within(figure).getByText("good").closest("figcaption")).toBeNull();
  })}
{/snippet}

<!-- below: the caption under the variant, a class away and still first in the DOM; both props follow their values -->
{#snippet flipped(
  Labeled: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { label: Widen<"under">; below: Widen<true> },
  test: Test,
)}
  <Status {test} />
  <Labeled label={pocket.label} below={pocket.below}
    ><span>variant</span></Labeled
  >
  {test(async ({ expect, screen, flushSync }) => {
    const figure = screen.getByRole("figure");
    expect(figure.classList.contains("below")).toBe(true);
    expect(figure.firstElementChild?.tagName).toBe("FIGCAPTION");
    expect(figure.firstElementChild?.textContent).toBe("under");
    pocket.below = false;
    pocket.label = "over";
    flushSync();
    expect(figure.classList.contains("below")).toBe(false);
    expect(figure.firstElementChild?.textContent).toBe("over");
  })}
{/snippet}

<!-- in a Row: a gallery of swatches, each figure its own caption over its own variant -->
{#snippet gallery(
  Labeled: typeof Self,
  Status: typeof Sweater.Status,
  Row: typeof Sweater.Row,
  test: Test,
)}
  <Status {test} />
  <Row gap="0.5rem" align="end">
    {#each [8, 16, 24] as size (size)}
      <Labeled label="size={size}">
        <span
          style:display="inline-block"
          style:width="{size}px"
          style:height="{size}px"
          style:background="#888"
        ></span>
      </Labeled>
    {/each}
  </Row>
  {test(async ({ expect, screen }) => {
    const figures = screen.getAllByRole("figure");
    expect(figures).toHaveLength(3);
    for (const [i, size] of [8, 16, 24].entries()) {
      expect(figures[i].firstElementChild?.textContent).toBe(`size=${size}`);
      expect(
        figures[i].lastElementChild?.querySelector("span")?.style.width,
      ).toBe(`${size}px`);
    }
  })}
{/snippet}

<style>
  .labeled {
    display: inline-flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: 0;
  }
  .below {
    flex-direction: column-reverse;
  }
  figcaption {
    font:
      12px/1.2 ui-monospace,
      monospace;
    color: #666;
  }
</style>
