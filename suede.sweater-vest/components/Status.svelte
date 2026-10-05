<script lang="ts">
  // Where a test stands, with its notes and its failure: `<Status {test} />`.
  import type { createHarness, Env } from "../runtimes/common.svelte.ts";
  import type Self from "./Status.svelte";
  import type { Test, Widen } from "../dsl.import.meta.vitest";

  let { test, notes = true }: { test: Test; notes?: boolean } = $props();
</script>

<div class="status" data-state={test.state}>
  <span class="light" aria-hidden="true"></span>
  <span class="name">{test.name}</span>
  <span class="state">{test.state}</span>
  {#if test.error}
    <pre class="error">{test.error}</pre>
  {/if}
  {#if notes && test.notes.length}
    <ol class="notes">
      {#each test.notes as note, i (i)}<li>{note}</li>{/each}
    </ol>
  {/if}
</div>

<!-- a test still running: its name, and where it stands -->
{#snippet running(Status: typeof Self, harness: typeof createHarness)}
  <Status test={harness("Counter > counts", {} as Env).test} />
{/snippet}

<!-- notes: each one under the test as the body writes it, unless notes={false}, until it turns true -->
{#snippet noted(
  Status: typeof Self,
  harness: typeof createHarness,
  pocket: { notes: Widen<false> },
  test: Test,
)}
  {@const quiet = harness("Counter > counts", {} as Env)}
  <Status {test} />
  <Status test={quiet.test} notes={pocket.notes} />
  {test(async ({ expect, screen, note, tick, flushSync }) => {
    const own = screen.getByText("Status > noted").closest(".status")!;
    const muted = screen.getByText("Counter > counts").closest(".status")!;
    expect(own.getAttribute("data-state")).toBe("running");
    expect(own.querySelector(".state")?.textContent).toBe("running");
    expect(own.querySelector("ol")).toBeNull();
    note("clicked twice");
    note("then reset");
    quiet.test(({ note }) => note("kept, shown once asked"));
    await quiet.run();
    await tick();
    expect([...own.querySelectorAll("li")].map((li) => li.textContent)).toEqual(
      ["clicked twice", "then reset"],
    );
    expect(quiet.test.notes).toEqual(["kept, shown once asked"]);
    expect(muted.querySelector("ol")).toBeNull();
    pocket.notes = true;
    flushSync();
    expect(muted.querySelector("li")?.textContent).toBe(
      "kept, shown once asked",
    );
  })}
{/snippet}

<!-- outcomes: a test that passed, and one that failed with its error underneath -->
{#snippet outcomes(
  Status: typeof Self,
  harness: typeof createHarness,
  test: Test,
)}
  {@const passes = harness("Counter > counts", {} as Env)}
  {@const fails = harness("Counter > resets", {} as Env)}
  <Status {test} />
  <Status test={passes.test} />
  <Status test={fails.test} />
  {test(async ({ expect, screen, tick }) => {
    const passed = screen.getByText("Counter > counts").closest(".status")!;
    const failed = screen.getByText("Counter > resets").closest(".status")!;
    expect(failed.getAttribute("data-state")).toBe("running");
    expect(failed.querySelector("pre")).toBeNull();
    passes.test(() => {});
    fails.test(() => {
      throw new Error("expected 1 to be 0");
    });
    await passes.run();
    await expect(fails.run()).rejects.toThrow("expected 1 to be 0");
    await tick();
    expect(passed.getAttribute("data-state")).toBe("passed");
    expect(passed.querySelector(".state")?.textContent).toBe("passed");
    expect(passed.querySelector("pre")).toBeNull();
    expect(failed.getAttribute("data-state")).toBe("failed");
    expect(failed.querySelector(".state")?.textContent).toBe("failed");
    expect(failed.querySelector("pre")?.textContent).toBe("expected 1 to be 0");
  })}
{/snippet}

<style>
  .status {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.25rem 0.5rem;
    align-items: center;
    font:
      13px/1.4 system-ui,
      sans-serif;
    padding: 0.4rem 0.6rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fafafa;
    color: #222;
  }
  .light {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: #f0c419;
  }
  [data-state="passed"] .light {
    background: #2fa84f;
  }
  [data-state="failed"] .light {
    background: #d93025;
  }
  .name {
    font-weight: 600;
  }
  .state {
    color: #666;
  }
  .error,
  .notes {
    grid-column: 1 / -1;
    margin: 0;
  }
  .error {
    white-space: pre-wrap;
    color: #a50e0e;
    font-size: 12px;
  }
  .notes {
    padding-left: 1.2rem;
    color: #555;
  }
</style>
