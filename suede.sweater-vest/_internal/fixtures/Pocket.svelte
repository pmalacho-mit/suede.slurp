<script lang="ts">
  import type Self from "./Pocket.svelte";
  import type { Test, Widen } from "../../dsl.import.meta.vitest";
  import type { seed } from "./seed.ts";
</script>

{#snippet shapes(
  C: typeof Self,
  pocket: {
    n: 2;
    w: Widen<"a">;
    el: HTMLDivElement;
    self: Self;
    nested: { ok: true; list: [1, 2] };
    data: typeof seed;
    maybe: undefined;
  },
  test: Test,
)}
  <C />
  {test(async () => {})}
{/snippet}

<div>fixture</div>
