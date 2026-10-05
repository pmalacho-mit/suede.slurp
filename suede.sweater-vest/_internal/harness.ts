// Development-time scaffolding for the library's own namespace tests.
//
// The plugin's stages take a file and its text; these helpers take markup and
// return what one stage makes of it, so a test stays a plain `Invoke<…>`.
// Modules import this *as a type only*, so it never reaches a build.
import fs from "node:fs";
import path from "node:path";
import {
  analyze,
  isGeneratable,
  type Analysis,
} from "../vite-plugin/analyze.ts";
import { generate } from "../vite-plugin/generate.ts";
import { scrub } from "../vite-plugin/scrub.ts";
import { collectorFor } from "../vite-plugin/plugin.ts";
import { generatedId } from "../vite-plugin/names.ts";
import { pocketValues } from "../vite-plugin/pocket-values.ts";
import { document, markdownOf } from "../document.ts";
import { importsLibrary, type Alias } from "../vite-plugin/routes.ts";

/** Does a route file, as written, import from the library? */
export const routeImportsLibrary = (
  file: string,
  source: string,
  library: string,
  alias?: Alias,
): boolean => importsLibrary(file, source, library, alias);

export const FILE = "/project/src/Probe.svelte";

/** The script every probe starts with: the self import and the DSL, then whatever else a probe needs. */
export const prelude = (script = "") =>
  [
    `<script lang="ts">`,
    `  import type Self from "./Probe.svelte";`,
    `  import type { Test, Widen, Sweater } from "../lib/dsl.import.meta.vitest";`,
    ...(script.trim() ? [script.trim().replace(/^/gm, "  ")] : []),
    `</script>`,
    ``,
  ].join("\n");

/** Markup under the prelude (plus any extra script), analysed as `/project/src/Probe.svelte`. */
export const analyzed = (markup: string, script = "", file = FILE): Analysis =>
  analyze(file, prelude(script) + markup);

/** A whole component, as written, analysed as `file`. */
export const analyzedWhole = (source: string, file = FILE): Analysis =>
  analyze(file, source);

export const snippetNames = (markup: string, script = ""): string[] =>
  analyzed(markup, script)
    .snippets.filter(isGeneratable)
    .map((s) => s.name);

export const warningsOf = (markup: string, script = ""): string[] =>
  analyzed(markup, script).warnings.map((w) => w.message);

/** Only what stops a run. */
export const errorsOf = (markup: string, script = ""): string[] =>
  analyzed(markup, script)
    .warnings.filter((w) => w.severity === "error")
    .map((w) => w.message);

const snippetOf = (analysis: Analysis, name: string) => {
  const snippet = analysis.snippets.find((s) => s.name === name);
  if (!snippet) throw new Error(`no test snippet named ${name}`);
  return snippet;
};

export const paramsOf = (markup: string, snippet: string, script = "") =>
  snippetOf(analyzed(markup, script), snippet).params.map((p) =>
    p.kind === "value"
      ? `${p.kind}:${p.local}`
      : p.kind === "sweater"
        ? `${p.kind}:${p.member}`
        : p.kind,
  );

export const lineOf = (markup: string, snippet: string): number =>
  snippetOf(analyzed(markup), snippet).line;

/** The generated test component, with pocket initial values given by hand. */
export const generated = (
  markup: string,
  snippet: string,
  pockets: Record<string, string> = {},
  script = "",
): string => {
  const analysis = analyzed(markup, script);
  return generate(analysis, snippetOf(analysis, snippet), {
    runtime: "/project/lib/runtimes/common.svelte.ts",
    components: "/project/lib/components/index.ts",
    pockets: new Map(
      Object.entries(pockets).map(([name, initial]) => [
        name,
        { initial, members: [], imports: new Map() },
      ]),
    ),
  }).code;
};

/** The generated test component for a whole component as written. */
export const generatedWhole = (source: string, snippet: string): string => {
  const analysis = analyzedWhole(source);
  return generate(analysis, snippetOf(analysis, snippet), {
    runtime: "/project/lib/runtimes/common.svelte.ts",
    components: "/project/lib/components/index.ts",
    pockets: new Map<
      string,
      { initial: string; members: []; imports: Map<string, Set<string>> }
    >(),
  }).code;
};

/** The component as a build (or, with the collector, as Vitest) sees it. */
export const scrubbed = (source: string, collected = false): string => {
  const analysis = analyzedWhole(source);
  const ids = analysis.snippets.map((s) => generatedId(FILE, s.name));
  return scrub(
    analysis,
    collected && ids.length ? collectorFor(FILE, ids) : null,
  ).code;
};

/** A fixture beside this harness, so the library's own tests never reach outside `release/`. */
const fixture = (name: string) =>
  path.join(import.meta.dirname, "fixtures", name);

/** The initial value of a pocket parameter in a fixture component, read through the type checker. */
export function pocketOf(name: string, snippet: string, param: string) {
  const file = fixture(name);
  const analysis = analyze(file, fs.readFileSync(file, "utf8"));
  const values = pocketValues(process.cwd(), "tsconfig.json").forSnippet(
    analysis,
    snippetOf(analysis, snippet),
  );
  const value = values.get(param);
  if (!value) throw new Error(`no pocket named ${param}`);
  return {
    initial: value.initial,
    imports: Object.fromEntries(
      [...value.imports].map(([specifier, bindings]) => [
        specifier,
        [...bindings],
      ]),
    ),
  };
}

const COMPONENTS = "/project/lib/components/index.ts";

/** A snippet as documentation, pocket values given by hand as `{ pocket: { member: "2" } }`. */
export const documented = (
  markup: string,
  snippet: string,
  pockets: Record<string, Record<string, string>> = {},
  script = "",
  file = FILE,
) => {
  const analysis = analyzed(markup, script, file);
  return document(analysis, snippetOf(analysis, snippet), {
    components: COMPONENTS,
    pockets: new Map(
      Object.entries(pockets).map(([name, members]) => [
        name,
        Object.entries(members),
      ]),
    ),
  });
};

export const usageOf = (
  markup: string,
  snippet: string,
  pockets: Record<string, Record<string, string>> = {},
  script = "",
): string => documented(markup, snippet, pockets, script).usage;

export const verifiedByOf = (
  markup: string,
  snippet: string,
  pockets: Record<string, Record<string, string>> = {},
): string | null => documented(markup, snippet, pockets).verifiedBy;

export const markdownFor = (
  markup: string,
  snippet: string,
  level = 2,
): string => markdownOf(documented(markup, snippet), level);

/** The usage of a probe that is itself one of the library's components: beside the components index. */
export const usageAmongComponentsOf = (
  markup: string,
  snippet: string,
): string =>
  documented(
    markup,
    snippet,
    {},
    "",
    path.join(path.dirname(COMPONENTS), "Probe.svelte"),
  ).usage;
