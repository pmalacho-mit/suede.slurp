/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sweaterVest from "./suede.sweater-vest/vite-plugin/plugin.ts";
import namespaceTests from "./suede.nests/vite-plugin/plugin.mts";

const libraries = ["suede.*/**"];

export default defineConfig({
  plugins: [svelte(), sweaterVest({ tsconfig: "tsconfig.app.json", exclude: libraries })],
  test: {
    expect: { requireAssertions: true },
    projects: [
      sweaterVest.project(),
      {
        extends: true,
        plugins: [namespaceTests({ tsconfig: "tsconfig.app.json", exclude: libraries })],
        test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"] },
      },
    ],
  },
});
