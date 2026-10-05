import { fetchTests } from "<path>/sweater-vest-suede/runtimes/common.svelte.ts";
import type { PageLoad } from "./$types";

// tests run in the browser only
export const ssr = false;
export const prerender = false;

export const load = (async ({ params, fetch }) => {
  const tests = await fetchTests(fetch);
  const key = params.path.replace(/\/$/, "");
  return { entry: tests.find((t) => t.key === key) ?? null, tests, key };
}) satisfies PageLoad;
