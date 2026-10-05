<script lang="ts">
  // Content under a colour scheme: `<Theme scheme="dark">…</Theme>`. Sets
  // `color-scheme` and `data-theme`, and a matching background, so what reads
  // `prefers-color-scheme`-style styling through either has something to read.
  import type { Snippet } from "svelte";
  import type Self from "./Theme.svelte";
  import type { Test, Widen, Sweater } from "../dsl.import.meta.vitest";

  let {
    scheme = "light",
    children,
  }: { scheme?: "light" | "dark"; children: Snippet } = $props();
</script>

<div class="theme" data-theme={scheme} style:color-scheme={scheme}>
  {@render children()}
</div>

<!-- Theme: the same content under both colour schemes, side by side -->
{#snippet pair(Theme: typeof Self, Row: typeof Sweater.Row)}
  <Row>
    <Theme scheme="light"><span>light</span></Theme>
    <Theme scheme="dark"><span>dark</span></Theme>
  </Row>
{/snippet}

<!-- no scheme: light, with the children inside -->
{#snippet defaults(
  Theme: typeof Self,
  Status: typeof Sweater.Status,
  test: Test,
)}
  <Status {test} />
  <Theme><span>default</span></Theme>
  {test(async ({ expect, screen }) => {
    const theme = screen.getByText("default").parentElement!;
    expect(theme.getAttribute("data-theme")).toBe("light");
    expect(theme.style.colorScheme).toBe("light");
  })}
{/snippet}

<!-- the scheme follows its prop: light, then dark, then light again -->
{#snippet toggles(
  Theme: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { dark: Widen<false> },
  test: Test,
)}
  <Status {test} />
  <Theme scheme={pocket.dark ? "dark" : "light"}><span>toggled</span></Theme>
  {test(async ({ expect, screen, flushSync }) => {
    const theme = screen.getByText("toggled").parentElement!;
    expect(theme.getAttribute("data-theme")).toBe("light");
    expect(theme.style.colorScheme).toBe("light");
    pocket.dark = true;
    flushSync();
    expect(theme.getAttribute("data-theme")).toBe("dark");
    expect(theme.style.colorScheme).toBe("dark");
    pocket.dark = false;
    flushSync();
    expect(theme.getAttribute("data-theme")).toBe("light");
    expect(theme.style.colorScheme).toBe("light");
  })}
{/snippet}

<style>
  .theme {
    display: inline-block;
    padding: 1rem;
    background: white;
    color: #111;
  }
  .theme[data-theme="dark"] {
    background: #1b1b1f;
    color: #eee;
  }
</style>
