<script lang="ts">
  // The dev server's page: / (or /vests) lists every snippet, and
  // /vests/<component>/<snippet> renders one, where the editor extension and
  // the report open them. Any path Vite has no file for falls back to
  // index.html, so no route needs configuring. It routes by path, as
  // sweater-vest's SvelteKit template does, not by hash as its Vite template
  // does: snippets that keep state in the hash would change it underneath.
  import Runner from "../suede.sweater-vest/runtimes/Browser.svelte";
  import {
    fetchTests,
    type VestEntry,
  } from "../suede.sweater-vest/runtimes/common.svelte.ts";

  const key = decodeURIComponent(
    location.pathname.replace(/^\/(vests\/?)?/, ""),
  ).replace(/\/$/, "");

  let tests = $state<VestEntry[]>([]);
  let loaded = $state(false);
  fetchTests().then((all) => {
    tests = all;
    loaded = true;
  });
  const entry = $derived(tests.find((t) => t.key === key) ?? null);
</script>

{#if entry}
  <nav><a href="/vests">← every snippet</a></nav>
  <Runner {entry} />
{:else if loaded}
  <h1>Vests</h1>
  {#if key}<p>No snippet at <code>{key}</code>.</p>{/if}
  <ul>
    {#each tests as t}
      <li>
        <a href="/vests/{t.key}">{t.name}</a>
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
