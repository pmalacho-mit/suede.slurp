// Which project a component belongs to, when that is not the workspace folder:
// an app in a subdirectory of a repository (a workspace package, say) runs its
// own Vitest and dev server from its own directory. That directory is the one
// whose Vite config adds this library's plugin, and the import is what says so.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { isLibrary, libraryAt, type Library } from "./library.ts";

export type Project = { root: string; library: Library };

const NAMES = ["vite.config", "vitest.config"];
const EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/** The Vite and Vitest config file names a project may have, in the order Vitest prefers them. */
export const CONFIG_FILES = [...NAMES]
  .reverse()
  .flatMap((name) => EXTENSIONS.map((ext) => name + ext));

/** The same, as one glob for a file watcher or a workspace search. */
export const CONFIG_GLOB = `**/{${NAMES.join(",")}}{${EXTENSIONS.join(",")}}`;

// `import x from "…"`, `import "…"`, `export … from "…"`, `import("…")`, `require("…")`
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

// a comment, or a string that may hold what looks like one (`"http://…"`), which is kept
const COMMENT_OR_STRING =
  /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

// a commented-out import is not an import: the plugin it names is not loaded
export const specifiersIn = (source: string) =>
  [
    ...source
      .replace(COMMENT_OR_STRING, (_, string?: string) => string ?? "")
      .matchAll(SPECIFIER),
  ].flatMap((match) => match[1] ?? []);

const realpath = (file: string) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
};

const resolve = (config: string, specifier: string): string | null => {
  if (specifier.startsWith(".") || path.isAbsolute(specifier))
    return realpath(path.resolve(path.dirname(config), specifier));
  try {
    return realpath(createRequire(config).resolve(specifier));
  } catch {
    return null;
  }
};

/** The library a resolved import lands in: the nearest directory above it that is one. */
const libraryAbove = (target: string): string | null => {
  for (let dir = path.dirname(target); ; dir = path.dirname(dir)) {
    if (isLibrary(dir)) return dir;
    if (path.dirname(dir) === dir) return null;
  }
};

/** The library a Vite config imports from, if it imports this one at all. */
export function libraryImportedBy(config: string): Library | null {
  let source: string;
  try {
    source = fs.readFileSync(config, "utf8");
  } catch {
    return null;
  }
  for (const specifier of specifiersIn(source)) {
    const target = resolve(config, specifier);
    const root = target && libraryAbove(target);
    if (root) return libraryAt(root);
  }
  return null;
}

const projects = new Map<string, Project | null>();

/** The project a directory itself is, if one of its configs imports the library. */
export function projectAt(dir: string): Project | null {
  if (!projects.has(dir)) {
    let project: Project | null = null;
    for (const name of CONFIG_FILES) {
      const library = libraryImportedBy(path.join(dir, name));
      if (library) {
        project = { root: dir, library };
        break;
      }
    }
    projects.set(dir, project);
  }
  return projects.get(dir) ?? null;
}

/**
 * The project a file belongs to: the nearest directory above it, up to and
 * including `boundary` (the workspace folder), whose Vite or Vitest config
 * imports the library. Null when there is none, and the caller falls back.
 */
export function projectOf(file: string, boundary: string): Project | null {
  const stop = path.resolve(boundary);
  for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
    const project = projectAt(dir);
    if (project) return project;
    if (dir === stop || path.dirname(dir) === dir || !dir.startsWith(stop))
      return null;
  }
}

/** Forget what was found, after a config changes. */
export const forgetProjects = () => projects.clear();

/** The `vitest` a project runs, found as Node would from its directory (a workspace hoists it). */
export function vitestEntryFrom(dir: string): string | null {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    const entry = path.join(at, "node_modules", "vitest", "vitest.mjs");
    if (fs.existsSync(entry)) return entry;
    if (path.dirname(at) === at) return null;
  }
}
