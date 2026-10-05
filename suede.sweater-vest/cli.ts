#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { cli, main } from "./vendored/typescript-cli-suede/index.ts";
import {
  analyze,
  hasTest,
  isGeneratable,
  type Analysis,
} from "./vite-plugin/analyze.ts";
import { generate } from "./vite-plugin/generate.ts";
import { scrub } from "./vite-plugin/scrub.ts";
import {
  collectorFor,
  componentsFile,
  runtimeFile,
} from "./vite-plugin/plugin.ts";
import { generatedId, posix, testName } from "./vite-plugin/names.ts";
import { SUFFIX, extract, extracted, tempPathFor } from "./extract.ts";
import { document, markdownForComponent, markdownOf } from "./document.ts";

import type {
  Expect,
  Invoke,
  Table,
} from "../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";

const DESCRIPTION = [
  "Print a component's test snippet as a standalone test component.",
  "",
  "  cli.ts <component> <snippet>       the generated test component, as it would be extracted",
  "  cli.ts <component> <snippet> --extract   write it beside the component, as <Component>.<snippet>.temp.svelte",
  "  cli.ts <component> --list          the component's test snippets, as JSON",
  "  cli.ts <component> --collector     the component as Vitest is handed it",
  "  cli.ts --clean-extracted [dir]     delete extracted tests under dir (default: the working directory)",
  "  cli.ts <component|dir> [snippet] --markdown [--header-level N]   the snippets as documentation, for a README",
].join("\n");

/** What was asked for, read off an argv; kept apart from acting on it so it can be tested without a process. */
const parse = (argv: string[]) => {
  const args = main(argv, DESCRIPTION, [
    cli.flag(
      "list",
      "Print the component's test snippets as JSON, instead of one test.",
      false,
    ),
    cli.flag(
      "collector",
      "Print the component as Vitest is handed it: scrubbed, with the collector.",
      false,
    ),
    cli.flag(
      "extract",
      "Write the generated test beside the component instead of printing it, and print its path.",
      false,
    ),
    cli.flag(
      "markdown",
      "Print the snippets as documentation: the usage, then what verifies it. A directory documents every component under it.",
      false,
    ),
    cli.flag(
      ["header-level", "h"],
      "The heading level of a component in the Markdown; its snippets sit one below.",
      2,
    ),
    cli.flag(
      "tsconfig",
      "The tsconfig file name, found upward from the working directory.",
    ),
    cli.flag(
      "clean-extracted",
      "Delete extracted tests, searched for recursively from the positional directory argument (default: the current working directory). One edited since it was extracted is kept, unless --force.",
      false,
    ),
    cli.flag(
      "force",
      "With --clean-extracted, delete edited extracts too.",
      false,
    ),
  ]);
  return {
    file: args[0],
    snippet: args[1],
    mode: args.list
      ? "list"
      : args.collector
        ? "collector"
        : args["clean-extracted"]
          ? "clean"
          : args.extract
            ? "extract"
            : args.markdown
              ? "markdown"
              : "test",
    tsconfig: args.tsconfig ?? "tsconfig.json",
    headerLevel: args["header-level"],
    force: args.force,
    help: args.help,
  } as const;
};

type Parsed = ReturnType<typeof parse>;

declare namespace parse {
  /** a component and a snippet: the test, as it would be extracted */
  export type Test = Expect<
    Invoke<typeof parse, [argv: ["src/A.svelte", "simple"]]>,
    "matches",
    { file: "src/A.svelte"; snippet: "simple"; mode: "test" }
  >;

  /** the listing and the collector need no snippet named */
  export type Modes = Table<
    typeof parse,
    [
      [
        args: [["src/A.svelte", "--list"]],
        condition: "matches",
        expected: { file: "src/A.svelte"; mode: "list" },
      ],
      [
        args: [["--collector", "src/A.svelte"]],
        condition: "matches",
        expected: { file: "src/A.svelte"; mode: "collector" },
      ],
      [
        args: [["--clean-extracted"]],
        condition: "matches",
        expected: { file: undefined; mode: "clean"; force: false },
      ],
      [
        args: [["--clean-extracted", "src", "--force"]],
        condition: "matches",
        expected: { file: "src"; mode: "clean"; force: true },
      ],
      [
        args: [["src/A.svelte", "s", "--extract"]],
        condition: "matches",
        expected: { snippet: "s"; mode: "extract" },
      ],
    ]
  >;
}

const SKIPPED = new Set(["node_modules", "dist", "build", "coverage"]);

function* extractsUnder(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !SKIPPED.has(entry.name)
    )
      yield* extractsUnder(at);
    else if (entry.isFile() && entry.name.endsWith(SUFFIX)) yield at;
  }
}

type Verdict = "delete" | "keep" | "ignore";

const verdict = (file: { edited: boolean } | null, force: boolean): Verdict =>
  !file ? "ignore" : file.edited && !force ? "keep" : "delete";

declare namespace verdict {
  export type Rules = Table<
    typeof verdict,
    [
      [args: [file: null, force: true], expected: "ignore"],
      [args: [file: { edited: false }, force: false], expected: "delete"],
      [args: [file: { edited: true }, force: false], expected: "keep"],
      [args: [file: { edited: true }, force: true], expected: "delete"],
    ]
  >;
}

const shown = (file: string) => path.relative(process.cwd(), file);

const report = {
  delete: (file: string) => console.log(`deleted  ${shown(file)}`),
  keep: (file: string) =>
    console.log(
      `kept     ${shown(file)} — edited since it was extracted (--force to delete it too)`,
    ),
  ignore: () => {},
};

function cleanExtracted(dir: string, force: boolean) {
  for (const file of extractsUnder(dir)) {
    const decided = verdict(extracted(fs.readFileSync(file, "utf8")), force);
    if (decided === "delete") fs.rmSync(file);
    report[decided](file);
  }
}

const loaded = (file: string): Analysis => {
  const abs = path.resolve(file);
  return analyze(abs, fs.readFileSync(abs, "utf8"));
};

/** What the editor wants to know about each snippet. */
export const listing = (analysis: Analysis) =>
  analysis.snippets.map((s) => ({
    name: testName(analysis.file, s.name),
    snippet: s.name,
    line: s.line,
    test: hasTest(s),
    generatable: isGeneratable(s),
    key: `${posix(path.relative(process.cwd(), analysis.file)).replace(/\.svelte$/, "")}/${s.name}`,
    params: s.params,
  }));

async function printTest(
  analysis: Analysis,
  name: string,
  tsconfig: string,
  at?: string,
) {
  const snippet = analysis.snippets.find((s) => s.name === name);
  if (!snippet)
    throw new Error(`no test snippet named ${name} in ${shown(analysis.file)}`);
  if (!isGeneratable(snippet))
    throw new Error(
      `${name} has a parameter the plugin cannot hand in; see its warning`,
    );
  // the type checker is only loaded when a pocket needs its initial value read
  const { pocketValues } = await import("./vite-plugin/pocket-values.ts");
  const pockets = pocketValues(process.cwd(), tsconfig).forSnippet(
    analysis,
    snippet,
  );
  return generate(analysis, snippet, {
    runtime: runtimeFile,
    components: componentsFile,
    pockets,
    ...(at ? { at } : {}),
  }).code;
}

async function writeExtracted(
  analysis: Analysis,
  name: string,
  tsconfig: string,
) {
  const target = tempPathFor(analysis.file, name);
  const body = await printTest(analysis, name, tsconfig, target);
  fs.writeFileSync(target, extract(shown(analysis.file), name, body));
  return `${shown(target)}\n`;
}

async function printMarkdown(
  target: string,
  snippet: string | undefined,
  level: number,
  tsconfig: string,
) {
  const { pocketValues } = await import("./vite-plugin/pocket-values.ts");
  const values = pocketValues(process.cwd(), tsconfig);
  const root = path.resolve(target);
  const components = fs.statSync(root).isDirectory()
    ? [...componentsUnder(root)]
    : [root];
  const sections: string[] = [];
  for (const file of components) {
    const analysis = analyze(file, fs.readFileSync(file, "utf8"));
    const snippets = analysis.snippets.filter(
      (s) => isGeneratable(s) && (!snippet || s.name === snippet),
    );
    if (snippet && !snippets.length)
      throw new Error(`no test snippet named ${snippet} in ${shown(file)}`);
    const docs = snippets.map((s) => {
      const pockets = new Map(
        [...values.forSnippet(analysis, s)].map(([name, value]) => [
          name,
          value.members,
        ]),
      );
      return document(analysis, s, { components: componentsFile, pockets });
    });
    if (!docs.length) continue;
    sections.push(
      snippet
        ? markdownOf(docs[0]!, level)
        : markdownForComponent(analysis, docs, level),
    );
  }
  return `${sections.join("\n")}`;
}

// every component with snippets under a directory
function* componentsUnder(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !SKIPPED.has(entry.name)
    )
      yield* componentsUnder(at);
    else if (
      entry.isFile() &&
      entry.name.endsWith(".svelte") &&
      !entry.name.endsWith(".vest.svelte") &&
      !entry.name.endsWith(SUFFIX)
    )
      if (fs.readFileSync(at, "utf8").includes("import.meta.vitest")) yield at;
  }
}

const printCollector = (analysis: Analysis) => {
  const ids = analysis.snippets
    .filter(isGeneratable)
    .map((s) => generatedId(analysis.file, s.name));
  return scrub(analysis, ids.length ? collectorFor(analysis.file, ids) : null)
    .code;
};

async function run({
  file,
  snippet,
  mode,
  tsconfig,
  force,
  help,
  headerLevel,
}: Parsed) {
  if (mode === "clean") return cleanExtracted(path.resolve(file ?? "."), force);
  if (mode === "markdown" && file)
    return void process.stdout.write(
      await printMarkdown(file, snippet, headerLevel, tsconfig),
    );
  if (!file || ((mode === "test" || mode === "extract") && !snippet)) {
    console.error(help());
    process.exit(2);
  }
  const analysis = loaded(file);
  for (const w of analysis.warnings)
    console.error(
      `${shown(analysis.file)}:${w.line + 1}:${w.column + 1} ${w.severity}: ${w.message}`,
    );
  const text =
    mode === "list"
      ? `${JSON.stringify(listing(analysis), null, 2)}\n`
      : mode === "collector"
        ? printCollector(analysis)
        : mode === "extract"
          ? await writeExtracted(analysis, snippet!, tsconfig)
          : await printTest(analysis, snippet!, tsconfig);
  process.stdout.write(text);
}

if (cli.entry(import.meta.url)) await run(parse(process.argv.slice(2)));
