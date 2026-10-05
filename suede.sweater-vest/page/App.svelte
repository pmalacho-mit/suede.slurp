<script lang="ts">
  // A whole page for plain Vite: the list of snippets, and one of them when the
  // hash names it (`#src/lib/Button/clicks`). SvelteKit projects use the route
  // template instead, which renders `Runner` directly.
  import { onMount } from "svelte";
  import Runner from "../runtimes/Browser.svelte";
  import { fetchTests, type VestEntry } from "../runtimes/common.svelte.ts";

  let tests = $state<VestEntry[]>([]);
  onMount(async () => (tests = await fetchTests()));

  const keyOf = () =>
    decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\/$/, "");

  let key = $state(keyOf());
  const entry = $derived(tests.find((t) => t.key === key) ?? null);
</script>

<svelte:window onhashchange={() => (key = keyOf())} />

{#if entry}
  <nav><a href="#/">← every snippet</a></nav>
  {#key entry.key}
    <Runner {entry} />
  {/key}
{:else}
  <h1>Vests</h1>
  {#if key}<p>No snippet at <code>{key}</code>.</p>{/if}
  <ul>
    {#each tests as t}
      <li>
        <a href="#{t.key}">{t.name}</a>
        {#if !t.test}<em>(example)</em>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  nav {
    font-family: system-ui, sans-serif;
    padding: 0.5rem 1rem 0;
  }
</style>
