import path from "node:path";

/** The in-memory id a snippet's test is served as, beside its component. */
export const GENERATED_SUFFIX = ".vest.svelte";

/** The file an extracted test is written to, beside its component: the in-memory one, made real. */
export const EXTRACTED_SUFFIX = ".vest.temp.svelte";

export const stemOf = (file: string) =>
  path.basename(file).replace(/\.svelte$/, "");

export const perSnippetFile = (file: string, snippet: string, suffix: string) =>
  path.join(path.dirname(file), `${stemOf(file)}.${snippet}${suffix}`);

export const generatedId = (file: string, snippet: string) =>
  perSnippetFile(file, snippet, GENERATED_SUFFIX);

export const extractedFile = (file: string, snippet: string) =>
  perSnippetFile(file, snippet, EXTRACTED_SUFFIX);

/** `Component > snippet` */
export const testName = (file: string, snippet: string) =>
  `${stemOf(file)} > ${snippet}`;

const generatedPattern = /^(.+)\.([^./]+)\.vest\.svelte$/;

/** The component and snippet a generated id stands for, or null for any other id. */
export const parseGeneratedId = (
  id: string,
): { file: string; snippet: string } | null => {
  const match = generatedPattern.exec(id);
  return match ? { file: `${match[1]}.svelte`, snippet: match[2]! } : null;
};

export const posix = (file: string) => file.split(path.sep).join("/");

export const importPath = (importer: string, file: string) => {
  const rel = posix(path.relative(path.dirname(importer), file));
  return rel.startsWith(".") ? rel : `./${rel}`;
};

import type {
  Expect,
  Invoke,
  Table,
} from "../../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";

declare namespace generatedId {
  /** beside the component, named for the component and the snippet */
  export type Names = Table<
    typeof generatedId,
    [
      [
        args: ["src/Button.svelte", "simple"],
        expected: "src/Button.simple.vest.svelte",
      ],
      [
        args: ["/abs/lib/Example.svelte", "big"],
        expected: "/abs/lib/Example.big.vest.svelte",
      ],
    ]
  >;
}

declare namespace parseGeneratedId {
  /** a generated id gives back the component and the snippet; any other id gives nothing */
  export type RoundTrip = Table<
    typeof parseGeneratedId,
    [
      [
        args: ["src/Button.simple.vest.svelte"],
        expected: { file: "src/Button.svelte"; snippet: "simple" },
      ],
      [args: ["src/Button.svelte"], expected: null],
      [args: ["src/Button.simple.vest.temp.svelte"], expected: null],
    ]
  >;
}

declare namespace testName {
  export type Named = Expect<
    Invoke<typeof testName, ["src/lib/Button.svelte", "clicks"]>,
    "=",
    "Button > clicks"
  >;
}

declare namespace importPath {
  export type Relative = Table<
    typeof importPath,
    [
      [
        args: ["/p/src/A.svelte", "/p/src/A.s.vest.svelte"],
        expected: "./A.s.vest.svelte",
      ],
      [
        args: ["/p/src/lib/A.svelte", "/p/release/runtimes/common.svelte.ts"],
        expected: "../../release/runtimes/common.svelte.ts",
      ],
    ]
  >;
}
