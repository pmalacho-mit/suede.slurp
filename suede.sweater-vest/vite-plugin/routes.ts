import fs from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";
import { parse } from "svelte/compiler";

import type {
  Expect,
  Invoke,
  Table,
} from "../../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";
import type { routeImportsLibrary } from "../_internal/harness.ts";

/**
 * A route that imports the library — the pages that render snippets — is a
 * dev-server thing, and must not be a route of a build: a static adapter
 * refuses a dynamic route, and any adapter would ship a page that shows
 * nothing. SvelteKit finds routes by scanning for files whose names start with
 * `+`, so for the length of a build such files are renamed out of its sight.
 */

/** What a hidden route file is renamed to: still beside its siblings, ignored by SvelteKit, and recognisable. */
export const HIDDEN_PREFIX = ".sweater-vest-hidden.";

export type Alias =
  | Record<string, string>
  | { find: string | RegExp; replacement: string }[];

const aliased = (specifier: string, alias: Alias | undefined): string => {
  if (!alias) return specifier;
  const entries = Array.isArray(alias)
    ? alias
    : Object.entries(alias).map(([find, replacement]) => ({
        find,
        replacement,
      }));
  for (const { find, replacement } of entries) {
    if (typeof find === "string") {
      if (specifier === find || specifier.startsWith(`${find}/`))
        return replacement + specifier.slice(find.length);
    } else if (find.test(specifier))
      return specifier.replace(find, replacement);
  }
  return specifier;
};

/** Where a specifier points, as a path, when it points at a file at all. */
export const resolved = (
  file: string,
  specifier: string,
  alias?: Alias,
): string | null => {
  const spec = aliased(specifier, alias);
  if (spec.startsWith(".")) return path.resolve(path.dirname(file), spec);
  if (path.isAbsolute(spec)) return spec;
  return null;
};

const specifiersOfScript = (source: string): string[] =>
  ts
    .createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true)
    .statements.filter(ts.isImportDeclaration)
    .flatMap((s) =>
      ts.isStringLiteral(s.moduleSpecifier) ? [s.moduleSpecifier.text] : [],
    );

/** Every import specifier of a route file: a `.svelte` file's scripts, or a module. */
export function specifiersOf(file: string, source: string): string[] {
  if (!file.endsWith(".svelte")) return specifiersOfScript(source);
  const ast = parse(source, { modern: true, filename: file });
  const programs = [ast.module?.content, ast.instance?.content];
  return programs.flatMap((program) =>
    (program?.body ?? []).flatMap((s) =>
      s.type === "ImportDeclaration" && typeof s.source.value === "string"
        ? [s.source.value]
        : [],
    ),
  );
}

const within = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Does a route file import from the library? */
export const importsLibrary = (
  file: string,
  source: string,
  library: string,
  alias?: Alias,
): boolean =>
  specifiersOf(file, source).some((s) => {
    const target = resolved(file, s, alias);
    return target !== null && within(library, target);
  });

declare namespace importsLibrary {
  type Page = `<script lang="ts">
  import Runner from "../../../../release/runtimes/Browser.svelte";
</script>
<Runner />`;

  type Load = `import { fetchTests } from "$vest/runtimes/common.svelte.ts";
export const load = () => fetchTests();`;

  type Plain = `<script lang="ts">
  import Button from "$lib/Button.svelte";
</script>`;

  /** relative into the library, or through an alias; anything else is an ordinary route */
  export type Cases = Table<
    typeof routeImportsLibrary,
    [
      [
        args: [
          "/p/src/routes/vests/[...path]/+page.svelte",
          Page,
          "/p/release",
        ],
        expected: true,
      ],
      [
        args: [
          "/p/src/routes/vests/[...path]/+page.ts",
          Load,
          "/p/release",
          { $vest: "/p/release" },
        ],
        expected: true,
      ],
      [
        args: ["/p/src/routes/vests/[...path]/+page.ts", Load, "/p/release"],
        expected: false,
      ],
      [
        args: [
          "/p/src/routes/+page.svelte",
          Plain,
          "/p/release",
          { $lib: "/p/src/lib" },
        ],
        expected: false,
      ],
    ]
  >;
}

const isRouteFile = (name: string) => name.startsWith("+");

const hiddenName = (name: string) => `${HIDDEN_PREFIX}${name}`;
const shownName = (name: string) => name.slice(HIDDEN_PREFIX.length);

declare namespace hiddenName {
  type Page = "+page.svelte";
  export type RoundTrip = Expect<
    Invoke<typeof shownName, [Invoke<typeof hiddenName, [Page]>]>,
    "=",
    Page
  >;
}

function* directoriesUnder(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  yield dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules"
    )
      yield* directoriesUnder(path.join(dir, entry.name));
}

/** Route directories under `routes` whose `+` files import from the library. */
export function routesImportingLibrary(
  routes: string,
  library: string,
  alias?: Alias,
): string[] {
  const found: string[] = [];
  for (const dir of directoriesUnder(routes)) {
    const files = fs.readdirSync(dir).filter(isRouteFile);
    if (
      files.some((name) =>
        importsLibrary(
          path.join(dir, name),
          fs.readFileSync(path.join(dir, name), "utf8"),
          library,
          alias,
        ),
      )
    )
      found.push(dir);
  }
  return found;
}

// SvelteKit builds twice in one process (client, then server), re-reading the config and so making a
// second plugin instance; the routes hidden by the first stay hidden, and it is the first that restores them
const HIDING = Symbol.for("sweater-vest.hiding");
const processIsHiding = () =>
  (globalThis as Record<symbol, unknown>)[HIDING] === true;
const markProcessHiding = () =>
  void ((globalThis as Record<symbol, unknown>)[HIDING] = true);

/** Hides those routes for the length of the process, and restores them however it ends. */
export function routeHider(
  routes: string,
  library: string,
  log: (message: string) => void,
) {
  const hidden: { from: string; to: string }[] = [];
  let armed = false;

  const restore = () => {
    for (const { from, to } of hidden.splice(0))
      if (fs.existsSync(to)) fs.renameSync(to, from);
  };

  // a build that died mid-way left its routes hidden: show them before anything else
  const restoreLeftovers = () => {
    for (const dir of directoriesUnder(routes))
      for (const name of fs.readdirSync(dir))
        if (name.startsWith(HIDDEN_PREFIX))
          fs.renameSync(path.join(dir, name), path.join(dir, shownName(name)));
  };

  const arm = () => {
    if (armed) return;
    armed = true;
    process.once("exit", restore);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.once(signal, () => {
        restore();
        process.exit(1);
      });
  };

  return {
    hide(alias?: Alias) {
      if (armed || processIsHiding()) return;
      markProcessHiding();
      restoreLeftovers();
      for (const dir of routesImportingLibrary(routes, library, alias)) {
        for (const name of fs.readdirSync(dir).filter(isRouteFile)) {
          const from = path.join(dir, name);
          const to = path.join(dir, hiddenName(name));
          fs.renameSync(from, to);
          hidden.push({ from, to });
        }
        log(
          `left out of the build, as it imports the library: ${path.relative(process.cwd(), dir)}`,
        );
      }
      arm();
    },
    restore,
  };
}
