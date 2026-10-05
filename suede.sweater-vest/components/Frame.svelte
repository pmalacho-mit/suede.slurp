<script lang="ts">
  // A box that sizes to its content, for a `capture` that shows the component
  // and nothing else: `<Frame bind:element={pocket.frame}>…</Frame>`.
  import type { Snippet } from "svelte";
  import type Self from "./Frame.svelte";
  import type { Test, Widen, Sweater } from "../dsl.import.meta.vitest";

  let {
    element = $bindable(),
    padding = "1rem",
    background = "white",
    border = true,
    children,
  }: {
    element?: HTMLDivElement;
    padding?: string;
    background?: string;
    border?: boolean;
    children: Snippet;
  } = $props();
</script>

<div
  class="frame"
  class:border
  bind:this={element}
  style:padding
  style:background
>
  {@render children()}
</div>

<!-- Frame: around what a capture should show, and nothing else -->
{#snippet framed(Frame: typeof Self, Row: typeof Sweater.Row)}
  <Row>
    <Frame><span>as it comes: padded, white, bordered</span></Frame>
    <Frame padding="0.25rem" background="papayawhip" border={false}>
      <span>tighter, tinted, no border</span>
    </Frame>
  </Row>
{/snippet}

<!-- bind:element hands back the box, to capture just it -->
{#snippet captured(
  Frame: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { frame: HTMLDivElement },
  test: Test,
)}
  <Status {test} />
  <Frame bind:element={pocket.frame}><span>just this</span></Frame>
  {test(async ({ expect, capture, note }) => {
    expect(pocket.frame).toBeInstanceOf(HTMLDivElement);
    expect(pocket.frame.textContent).toBe("just this");
    expect(pocket.frame.style.padding).toBe("1rem");
    expect(pocket.frame.style.background).toBe("white");
    expect(pocket.frame.classList.contains("border")).toBe(true);
    const png = await capture(pocket.frame, "the frame");
    note(
      png
        ? "captured a PNG of the frame"
        : "captured nothing: only the report takes screenshots",
    );
  })}
{/snippet}

<!-- padding, background and border, set and then changed -->
{#snippet styled(
  Frame: typeof Self,
  Status: typeof Sweater.Status,
  pocket: {
    frame: HTMLDivElement;
    padding: Widen<"2px 8px">;
    background: Widen<"papayawhip">;
    border: Widen<false>;
  },
  test: Test,
)}
  <Status {test} />
  <Frame
    bind:element={pocket.frame}
    padding={pocket.padding}
    background={pocket.background}
    border={pocket.border}
  >
    <span>styled</span>
  </Frame>
  {test(async ({ expect, flushSync }) => {
    expect(pocket.frame.style.padding).toBe("2px 8px");
    expect(pocket.frame.style.background).toBe("papayawhip");
    expect(pocket.frame.classList.contains("border")).toBe(false);
    pocket.padding = "0.5rem";
    pocket.background = "lavender";
    pocket.border = true;
    flushSync();
    expect(pocket.frame.style.padding).toBe("0.5rem");
    expect(pocket.frame.style.background).toBe("lavender");
    expect(pocket.frame.classList.contains("border")).toBe(true);
  })}
{/snippet}

<style>
  .frame {
    display: inline-block;
    width: fit-content;
    box-sizing: border-box;
  }
  .border {
    border: 1px solid #ddd;
    border-radius: 6px;
  }
</style>
