/// <reference types="node" />
import { createHash } from "node:crypto";
import type {
  Call,
  Expect,
  Invoke,
  Table,
} from "../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";

export {
  EXTRACTED_SUFFIX as SUFFIX,
  extractedFile as tempPathFor,
} from "./vite-plugin/names.ts";

const withOneTrailingNewline = (body: string) => body.replace(/\s*$/, "\n");

const fingerprint = (body: string) =>
  createHash("sha256")
    .update(withOneTrailingNewline(body))
    .digest("hex")
    .slice(0, 12);

// The header is written by `headerLines` and read by `HEADER`: keep them together.
const MARK = "sweater-vest:";

const headerLines = (source: string, snippet: string, body: string) => [
  `<!-- ${MARK} ${source} > ${JSON.stringify(snippet)} [${fingerprint(body)}] -->`,
  `<!-- Yours to run and edit. Delete it when you are done. -->`,
];

const HEADER = new RegExp(
  `^<!-- ${MARK} (.+?) > ("(?:[^"\\\\]|\\\\.)*") \\[([0-9a-f]+)\\] -->$`,
);

const parseHeader = (line: string | undefined) => {
  const match = HEADER.exec(line ?? "");
  if (!match) return null;
  const [source = "", quoted = '""', written = ""] = match.slice(1);
  return {
    source,
    snippet: JSON.parse(quoted) as string,
    fingerprint: written,
  };
};

const bodyOf = (text: string) => {
  const lines = text.split("\n");
  return lines.slice(lines.indexOf("") + 1).join("\n");
};

/** An extracted test: a header that says where it came from, then the generated component. */
export const extract = (source: string, snippet: string, body: string) =>
  [
    ...headerLines(source, snippet, body),
    "",
    withOneTrailingNewline(body),
  ].join("\n");

/** What an extracted file says about itself, or null for any other file. */
export function extracted(text: string) {
  const header = parseHeader(text.split("\n")[0]);
  if (!header) return null;
  return {
    source: header.source,
    snippet: header.snippet,
    edited: fingerprint(bodyOf(text)) !== header.fingerprint,
  };
}

declare namespace extracted {
  type Body = "<div>x</div>";
  type File = Invoke<typeof extract, ["src/Button.svelte", "simple", Body]>;

  /** an extracted file knows the component and the snippet it came from */
  export type Origin = Expect<
    Invoke<typeof extracted, [File]>,
    "matches",
    { source: "src/Button.svelte"; snippet: "simple"; edited: false }
  >;

  type Worked = Call<File, "replace", [Body, "<div>y</div>"]>;

  /** a body that no longer matches its fingerprint is one someone worked on */
  export type Edited = Expect<
    Invoke<typeof extracted, [Worked]>,
    "matches",
    { edited: true }
  >;

  /** anything else is just a file */
  export type NotOurs = Expect<
    Invoke<typeof extracted, ["<div>x</div>"]>,
    "is",
    null
  >;
}

declare namespace extract {
  /** the header comes first, then a blank line, then the body as given */
  export type Shape = Table<
    typeof extract,
    [
      [
        args: ["src/A.svelte", "s", "<b/>"],
        condition: "startsWith",
        expected: '<!-- sweater-vest: src/A.svelte > "s" [',
      ],
      [
        args: ["src/A.svelte", "s", "<b/>"],
        condition: "endsWith",
        expected: "-->\n\n<b/>\n",
      ],
    ]
  >;
}
