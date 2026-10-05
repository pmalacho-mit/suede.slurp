<script lang="ts">
  // A live view of a value — a pocket, say — as JSON: `<Inspect value={pocket} />`.
  import type Self from "./Inspect.svelte";
  import type { Test, Widen, Sweater } from "../dsl.import.meta.vitest";

  let { value, label }: { value: unknown; label?: string } = $props();

  const seen = (_key: string, v: unknown) =>
    v instanceof Element
      ? `<${v.tagName.toLowerCase()}>`
      : typeof v === "function"
        ? `[function ${v.name}]`
        : v;
  const text = $derived(JSON.stringify($state.snapshot(value), seen, 2));
</script>

<pre class="inspect">{#if label}<b>{label}</b>
  {/if}{text}</pre>

<!-- a pocket beside what changes it: the view follows every write -->
{#snippet usage(
  Inspect: typeof Self,
  pocket: { name: Widen<"Ada">; clicks: Widen<0> },
)}
  <input bind:value={pocket.name} aria-label="name" />
  <button onclick={() => pocket.clicks++}>click</button>
  <Inspect value={pocket} label="pocket" />
{/snippet}

<!-- any value, as JSON indented by two spaces -->
{#snippet json(
  Inspect: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { box: HTMLDivElement },
  test: Test,
)}
  <Status {test} />
  <div bind:this={pocket.box}>
    <Inspect value={{ name: "Ada", tags: ["a"], none: null }} />
    <Inspect value={42} />
    <Inspect value="text" />
  </div>
  {test(async ({ expect }) => {
    const [object, number, string] = [...pocket.box.querySelectorAll("pre")];
    expect(object.textContent).toBe(
      '{\n  "name": "Ada",\n  "tags": [\n    "a"\n  ],\n  "none": null\n}',
    );
    expect(number.textContent).toBe("42");
    expect(string.textContent).toBe('"text"');
  })}
{/snippet}

<!-- live: a write to the pocket, or a new value, shows once Svelte flushes -->
{#snippet live(
  Inspect: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { count: Widen<1>; items: Widen<["a"]> },
  test: Test,
)}
  <Status {test} />
  <Inspect value={pocket} label="pocket" />
  <Inspect value={pocket.count} label="count" />
  {test(async ({ expect, screen, flushSync }) => {
    const whole = screen.getByText("pocket").parentElement!;
    const part = screen.getByText("count").parentElement!;
    expect(whole.textContent).toContain('"count": 1');
    expect(part.textContent).toBe("count\n1");
    pocket.count = 2;
    pocket.items.push("b");
    flushSync();
    expect(whole.textContent).toContain('"count": 2');
    expect(whole.textContent).toContain('"items": [\n    "a",\n    "b"\n  ]');
    expect(whole.textContent).not.toContain('"count": 1');
    expect(part.textContent).toBe("count\n2");
  })}
{/snippet}

<!-- what JSON cannot hold: an element prints as its tag, a function as its name -->
{#snippet special(
  Inspect: typeof Self,
  Status: typeof Sweater.Status,
  pocket: { el: HTMLSpanElement },
  test: Test,
)}
  <Status {test} />
  <span bind:this={pocket.el}>bound</span>
  <Inspect value={pocket} />
  <Inspect value={function greet() {}} />
  {test(async ({ expect, screen }) => {
    expect(screen.getByText(/"el": "<span>"/).textContent).toBe(
      '{\n  "el": "<span>"\n}',
    );
    expect(screen.getByText('"[function greet]"')).toBeDefined();
  })}
{/snippet}

<!-- label: a bold heading above the JSON, only when given, and following its value -->
{#snippet labeled(
  Inspect: typeof Self,
  Status: typeof Sweater.Status,
  pocket: {
    titled: HTMLDivElement;
    plain: HTMLDivElement;
    label: Widen<"state">;
  },
  test: Test,
)}
  <Status {test} />
  <div bind:this={pocket.titled}>
    <Inspect value={{ n: 1 }} label={pocket.label} />
  </div>
  <div bind:this={pocket.plain}><Inspect value={{ n: 1 }} /></div>
  {test(async ({ expect, flushSync }) => {
    expect(pocket.titled.querySelector("pre > b")?.textContent).toBe("state");
    expect(pocket.titled.textContent).toBe(
      `state\n${JSON.stringify({ n: 1 }, null, 2)}`,
    );
    expect(pocket.plain.querySelector("b")).toBeNull();
    expect(pocket.plain.textContent).toBe(JSON.stringify({ n: 1 }, null, 2));
    pocket.label = "renamed";
    flushSync();
    expect(pocket.titled.querySelector("pre > b")?.textContent).toBe("renamed");
  })}
{/snippet}

<style>
  .inspect {
    margin: 0;
    padding: 0.5rem 0.6rem;
    font:
      12px/1.4 ui-monospace,
      monospace;
    background: #f4f4f4;
    color: #222;
    border-radius: 6px;
    overflow: auto;
  }
</style>
