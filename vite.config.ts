/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sweaterVest from "./suede.sweater-vest/vite-plugin/plugin.ts";
import namespaceTests from "./suede.nests/vite-plugin/plugin.mts";

const libraries = ["suede.*/**"];

export default defineConfig({
  plugins: [
    svelte(),
    sweaterVest({
      tsconfig: "tsconfig.app.json",
      exclude: libraries,
      external: process.env.DESOLATE_EXTERNAL_5713
        ? `http://localhost:${process.env.DESOLATE_EXTERNAL_5713}`
        : undefined,
    }),
  ],
  test: {
    expect: { requireAssertions: true },
    projects: [
      sweaterVest.project(),
      {
        extends: true,
        // Svelte's client build, so that release/ files run under jsdom
        // (`// @vitest-environment jsdom`) can run effects.
        resolve: { conditions: ["browser"] },
        plugins: [
          namespaceTests({ tsconfig: "tsconfig.app.json", exclude: libraries }),
        ],
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
    ],
  },
});
