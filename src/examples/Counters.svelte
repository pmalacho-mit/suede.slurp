<script lang="ts" module>
  import { onDestroy } from "svelte";
  import { URLParameterize } from "../../release";

  /**
   * Several instances of one model, each under its own prefix: ?left_count=2&right_count=1.
   *
   * The prefix is a getter, so it is followed as it changes: renaming a counter
   * moves its parameter, without a history entry, and `url.key` tells where it
   * is now.
   */
  export class Counter {
    name = $state("");
    count = $state(0);
    readonly url;

    constructor(name: string) {
      this.name = name;
      this.url = URLParameterize<Counter>(
        this,
        { count: (query) => (typeof query === "number" ? query : 0) },
        { prefix: () => `${this.name}_`, onDestroy },
      );
    }
  }
</script>

<script lang="ts">
  import type Self from "./Counters.svelte";
  import type { Test } from "../../suede.sweater-vest/dsl.import.meta.vitest";

  const counters = [new Counter("left"), new Counter("right")];
</script>

{#each counters as counter}
  <p>
    <button onclick={() => counter.count++}>Add to {counter.name}</button>
    {counter.count}, stored in ?{counter.url.key("count")}=…
  </p>
{/each}
<button onclick={() => (counters[0].name = "first")}
  >Rename left to first</button
>

<!-- each instance has its own parameter, and renaming one moves it -->
{#snippet countsApart(Counters: typeof Self, test: Test)}
  <Counters />
  {test(async ({ expect, user, screen }) => {
    const params = () => new URL(location.href).searchParams;
    await user.click(screen.getByRole("button", { name: "Add to left" }));
    await user.click(screen.getByRole("button", { name: "Add to left" }));
    await user.click(screen.getByRole("button", { name: "Add to right" }));
    expect(params().get("left_count")).toBe("2");
    expect(params().get("right_count")).toBe("1");

    const entries = history.length;
    await user.click(
      screen.getByRole("button", { name: "Rename left to first" }),
    );
    expect(params().get("first_count")).toBe("2");
    expect(params().has("left_count")).toBe(false);
    expect(screen.getByText("2, stored in ?first_count=…")).toBeTruthy();
    expect(history.length).toBe(entries);
  })}
{/snippet}
