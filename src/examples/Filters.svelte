<script lang="ts" module>
  export const languages = ["js", "ts", "svelte"];
</script>

<script lang="ts">
  import { onDestroy } from "svelte";
  import { URLParameterize } from "../../release";
  import type Self from "./Filters.svelte";
  import type { Test } from "../../suede.sweater-vest/dsl.import.meta.vitest";

  /*
   * No class needed: any `$state` object can be tracked. An array with
   * `entries: "multiple"` is written as one entry per element (?lang=js&lang=ts),
   * and `resolve` is called once per entry.
   *
   * Called on a plain object, URLParameterize knows exactly which properties it
   * tracks, so `url.key` only accepts those.
   */
  const filters = $state({ languages: [] as string[] });

  const url = URLParameterize(
    filters,
    {
      languages: {
        key: "lang",
        entries: "multiple",
        serialize: (language) => language,
        deserialize: (language) => language,
        resolve: (query) => String(query),
      },
    },
    { onDestroy },
  );
</script>

<fieldset>
  <legend>Languages</legend>
  {#each languages as language}
    <label>
      <input type="checkbox" value={language} bind:group={filters.languages} />
      {language}
    </label>
  {/each}
</fieldset>
<p>Stored in ?{url.key("languages")}=…</p>

<!-- checked boxes are repeated entries, and a link with them checks them -->
{#snippet checksLanguages(Filters: typeof Self, test: Test)}
  <Filters />
  {test(async ({ expect, user, screen, flushSync }) => {
    const entries = () => new URL(location.href).searchParams.getAll("lang");
    expect(screen.getByText("Stored in ?lang=…")).toBeTruthy();

    await user.click(screen.getByRole("checkbox", { name: "js" }));
    await user.click(screen.getByRole("checkbox", { name: "svelte" }));
    expect(entries()).toEqual(["js", "svelte"]);

    history.pushState({}, "", "?lang=ts");
    flushSync();
    const checked = screen
      .getAllByRole<HTMLInputElement>("checkbox")
      .filter((box) => box.checked)
      .map((box) => box.value);
    expect(checked).toEqual(["ts"]);
  })}
{/snippet}
