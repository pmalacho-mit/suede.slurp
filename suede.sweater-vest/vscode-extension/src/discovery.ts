import {
  analyze,
  hasTest,
  isGeneratable,
  MARKER,
  type TestSnippet,
} from "../../vite-plugin/analyze.ts";
import { testName } from "../../vite-plugin/names.ts";

export const hasTests = (text: string) => text.includes(MARKER);

export type Range = { line: number; column: number; length: number };

export type DiscoveredTest = Range & {
  /** `Component > snippet` */
  name: string;
  snippet: string;
  /** false for a render-only example */
  test: boolean;
  generatable: boolean;
  /** why it cannot be generated, when it cannot: the plugin's errors at this snippet */
  problems: string[];
};

// where the snippet's name is written: `{#snippet name(`
const nameRange = (text: string, snippet: TestSnippet): Range => {
  const head = text.slice(snippet.start, snippet.end);
  const column = head.indexOf(snippet.name);
  const before = text.slice(0, snippet.start);
  const lineStart = before.lastIndexOf("\n") + 1;
  return {
    line: snippet.line - 1,
    column: snippet.start - lineStart + Math.max(column, 0),
    length: snippet.name.length,
  };
};

const lineAt = (text: string, offset: number) =>
  text.slice(0, offset).split("\n").length - 1;

export function discover(fileName: string, text: string): DiscoveredTest[] {
  if (!hasTests(text)) return [];
  const analysis = analyze(fileName, text);
  return analysis.snippets.map((s) => {
    const first = s.line - 1;
    const last = lineAt(text, s.end);
    return {
      ...nameRange(text, s),
      name: testName(fileName, s.name),
      snippet: s.name,
      test: hasTest(s),
      generatable: isGeneratable(s),
      problems: analysis.warnings
        .filter(
          (w) => w.severity === "error" && w.line >= first && w.line <= last,
        )
        .map((w) => w.message),
    };
  });
}

/** The page path for a snippet: the component relative to the folder, without `.svelte`, then the snippet. */
export const pageKey = (relativeFile: string, snippet: string) =>
  `${relativeFile.replace(/\\/g, "/").replace(/\.svelte$/, "")}/${snippet}`;
