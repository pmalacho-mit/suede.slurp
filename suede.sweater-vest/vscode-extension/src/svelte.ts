// Stands in for "svelte/compiler" in the bundle: see the alias in build.mjs.
// The workspace's own compiler is what the plugin parses with, so it is what the editor parses with.
import { createRequire } from "node:module";
import path from "node:path";

import type * as Compiler from "svelte/compiler";

const resolveFrom = (dir: string): typeof Compiler | null => {
  try {
    const require = createRequire(path.join(dir, "noop.js"));
    return require(require.resolve("svelte/compiler")) as typeof Compiler;
  } catch {
    return null;
  }
};

const loaded = new Map<string, typeof Compiler | null>();

export const compilerOf = (dir: string) => {
  if (!loaded.has(dir)) loaded.set(dir, resolveFrom(dir));
  return loaded.get(dir) ?? null;
};

let from = process.cwd();

export function parseWithCompilerOf(dir: string): boolean {
  from = dir;
  return compilerOf(dir) !== null;
}

export const parse = ((...args: unknown[]) => {
  const compiler = compilerOf(from);
  if (!compiler)
    throw new Error(
      `sweater-vest: no Svelte compiler to parse with from ${from}`,
    );
  return (compiler.parse as (...a: unknown[]) => unknown)(...args);
}) as typeof Compiler.parse;
