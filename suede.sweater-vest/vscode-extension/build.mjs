import { build } from "esbuild";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  // parse with the workspace's own Svelte compiler, the one the plugin runs
  alias: { "svelte/compiler": "./src/svelte.ts" },
  sourcemap: true,
  minify: process.argv.includes("--minify"),
  logLevel: "info",
});
