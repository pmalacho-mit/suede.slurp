<script lang="ts" module>
  import { onDestroy } from "svelte";
  import { URLParameterize } from "../../release";

  export type Tab = "overview" | "details";

  /**
   * State kept in the hash (`#tab=details`) instead of the query: it isn't sent
   * to the server, and plain `#…` links change it without a page load.
   * `in: "hash"` in the options applies to every handler of the object.
   */
  export class TabState {
    tab = $state<Tab>("overview");

    readonly url = URLParameterize<TabState>(
      this,
      {
        tab: {
          serialize: (tab) => tab,
          deserialize: (tab) => tab,
          resolve: (query) => (query === "details" ? "details" : "overview"),
        },
      },
      { in: "hash", onDestroy },
    );
  }
</script>

<script lang="ts">
  import type Self from "./Tabs.svelte";
  import type { Test } from "../../suede.sweater-vest/dsl.import.meta.vitest";

  const tabs = new TabState();

  // Following a #… link (or setting location.hash, or editing the address bar)
  // fires `hashchange`. URLParameterize listens for it to update `tab`, and your
  // own code can too, reading the parameter by its key.
  let changes = $state<string[]>([]);
  $effect(() => {
    const key = tabs.url.key("tab");
    const record = () => {
      const tab = new URLSearchParams(location.hash.slice(1)).get(key);
      changes = [...changes, tab ?? "(none)"];
    };
    addEventListener("hashchange", record);
    return () => removeEventListener("hashchange", record);
  });
</script>

<nav>
  <a
    href="#tab=overview"
    aria-current={tabs.tab === "overview" ? "page" : undefined}>Overview</a
  >
  <a
    href="#tab=details"
    aria-current={tabs.tab === "details" ? "page" : undefined}>Details</a
  >
</nav>
<section aria-label={tabs.tab}>
  {tabs.tab === "overview" ? "The overview." : "The details."}
</section>
<p>hashchange saw: {changes.join(", ") || "nothing yet"}</p>

<!-- a #tab=… link switches the tab, hashchange tells your own code, and back switches it back -->
{#snippet switches(Tabs: typeof Self, test: Test)}
  <Tabs />
  {test(async ({ expect, user, screen, waitFor }) => {
    const tab = () => new URLSearchParams(location.hash.slice(1)).get("tab");
    expect(tab()).toBe("overview");
    expect(screen.getByText("The overview.")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Details" }));
    await waitFor(() => expect(screen.getByText("The details.")).toBeTruthy());
    expect(tab()).toBe("details");
    expect(screen.getByText("hashchange saw: details")).toBeTruthy();

    history.back();
    await waitFor(() => expect(screen.getByText("The overview.")).toBeTruthy());
    await waitFor(() =>
      expect(
        screen.getByText("hashchange saw: details, overview"),
      ).toBeTruthy(),
    );
  })}
{/snippet}
