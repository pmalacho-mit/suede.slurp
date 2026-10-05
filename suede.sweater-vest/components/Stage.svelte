<script lang="ts">
  // A viewport of a known size, for what depends on one: `<Stage width={360} height={640}>…</Stage>`.
  import type { Snippet } from "svelte";
  import type Self from "./Stage.svelte";
  import type { Test, Widen, Sweater } from "../dsl.import.meta.vitest";

  let {
    element = $bindable(),
    width = 320,
    height = 240,
    scroll = false,
    checkered = false,
    children,
  }: {
    element?: HTMLDivElement;
    width?: number;
    height?: number;
    scroll?: boolean;
    checkered?: boolean;
    children: Snippet;
  } = $props();
</script>

<div
  class="stage"
  class:checkered
  bind:this={element}
  style:width="{width}px"
  style:height="{height}px"
  style:overflow={scroll ? "auto" : "hidden"}
>
  {@render children()}
</div>

<!-- a phone-sized viewport, checkered so its edges show, with what it holds placed against them -->
{#snippet phone(Stage: typeof Self)}
  <Stage width={180} height={320} checkered>
    <span style="position: absolute; top: 8px; left: 8px;">top left</span>
    <span style="position: absolute; bottom: 8px; right: 8px;"
      >bottom right</span
    >
  </Stage>
{/snippet}

<!-- defaults: 320 by 240, overflow hidden, a plain background; the element binds out -->
{#snippet defaults(
  Stage: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { stage: HTMLDivElement },
  test: Test,
)}
  <Status {test} />
  <Stage bind:element={pocket.stage}>
    <span>on stage</span>
  </Stage>
  {test(async ({ expect, within }) => {
    expect(pocket.stage).toBeInstanceOf(HTMLDivElement);
    expect(within(pocket.stage).getByText("on stage")).toBeDefined();
    expect(pocket.stage.style.width).toBe("320px");
    expect(pocket.stage.style.height).toBe("240px");
    expect(pocket.stage.style.overflow).toBe("hidden");
    expect(pocket.stage.classList.contains("checkered")).toBe(false);
  })}
{/snippet}

<!-- scroll: content taller than the stage, scrolled to rather than cut off -->
{#snippet scrolling(Stage: typeof Self)}
  <Stage width={200} height={100} scroll checkered>
    <div style="height: 400px;">a tall column, scroll down</div>
  </Stage>
{/snippet}

<!-- every prop follows its value: resize, scroll and checker the same stage -->
{#snippet resized(
  Stage: typeof Self,
  Status: typeof Sweater.Status,
  pocket: {
    stage: HTMLDivElement;
    width: Widen<160>;
    height: Widen<90>;
    scroll: Widen<true>;
    checkered: Widen<true>;
  },
  test: Test,
)}
  <Status {test} />
  <Stage
    bind:element={pocket.stage}
    width={pocket.width}
    height={pocket.height}
    scroll={pocket.scroll}
    checkered={pocket.checkered}
  >
    <span>{pocket.width} by {pocket.height}</span>
  </Stage>
  {test(async ({ expect, within, flushSync }) => {
    expect(pocket.stage.style.width).toBe("160px");
    expect(pocket.stage.style.height).toBe("90px");
    expect(pocket.stage.style.overflow).toBe("auto");
    expect(pocket.stage.classList.contains("checkered")).toBe(true);
    expect(within(pocket.stage).getByText("160 by 90")).toBeDefined();
    pocket.width = 360;
    pocket.height = 640;
    pocket.scroll = false;
    pocket.checkered = false;
    flushSync();
    expect(pocket.stage.style.width).toBe("360px");
    expect(pocket.stage.style.height).toBe("640px");
    expect(pocket.stage.style.overflow).toBe("hidden");
    expect(pocket.stage.classList.contains("checkered")).toBe(false);
    expect(within(pocket.stage).getByText("360 by 640")).toBeDefined();
    pocket.scroll = true;
    pocket.checkered = true;
    flushSync();
    expect(pocket.stage.style.overflow).toBe("auto");
    expect(pocket.stage.classList.contains("checkered")).toBe(true);
  })}
{/snippet}

<style>
  .stage {
    position: relative;
    box-sizing: border-box;
    border: 1px solid #ddd;
    background: white;
  }
  .checkered {
    background-image: linear-gradient(45deg, #eee 25%, transparent 25%),
      linear-gradient(-45deg, #eee 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #eee 75%),
      linear-gradient(-45deg, transparent 75%, #eee 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }
</style>
