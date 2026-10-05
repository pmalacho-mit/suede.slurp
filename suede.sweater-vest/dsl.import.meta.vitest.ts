// This module is named so that importing it puts the string `import.meta.vitest`
// in your component. Vitest collects a file whose text holds that string (its
// in-source testing), so importing the DSL is what makes a component's test
// snippets findable. Always `import type` it: the file is erased from builds.
export type {
  Test,
  TestState,
  Payload,
  Body,
} from "./runtimes/common.svelte.ts";

// `Widen<2>` is `number` to the type checker and `2` to the pocket's initial
// value: write it for a member the body will assign to.
export type { Widen } from "../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";

// Components for writing and showing tests, as a type-only namespace: a snippet
// takes one as `Status: typeof Sweater.Status`, and the generated test imports it.
export type * as Sweater from "./components/index.ts";
