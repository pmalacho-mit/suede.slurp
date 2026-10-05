// What the dev server answers while the plugin runs; nothing else serves these.

/** Every snippet, as JSON: a `VestEntry[]` (see `runtimes/common.svelte.ts`). The pages and the report read it. */
export const TESTS_ENDPOINT = "/__sweater-vest/tests.json";

/** How the plugin was configured, for the editor: `{ external }`. */
export const CONFIG_ENDPOINT = "/__sweater-vest/config.json";
