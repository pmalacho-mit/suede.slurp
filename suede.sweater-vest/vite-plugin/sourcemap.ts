import { encode, type SourceMapSegment } from "@jridgewell/sourcemap-codec";

const lineOf = (text: string, offset: number) => {
  let line = 0;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line += 1;
  return line;
};

/**
 * A map from a generated file to the component it came from: the lines copied
 * verbatim (the snippet) map to where they were written, column for column;
 * every other line is the generator's and maps nowhere.
 */
export function generatedSourceMap(
  generatedId: string,
  code: string,
  source: { file: string; text: string },
  copied: { generatedLine: number; sourceStart: number; sourceEnd: number },
) {
  const firstSourceLine = lineOf(source.text, copied.sourceStart);
  const lastSourceLine = lineOf(source.text, copied.sourceEnd);
  const count = lastSourceLine - firstSourceLine + 1;
  const lines: SourceMapSegment[][] = code.split("\n").map((_, line) => {
    const offset = line - copied.generatedLine;
    return offset >= 0 && offset < count
      ? [[0, 0, firstSourceLine + offset, 0]]
      : [];
  });
  return {
    version: 3 as const,
    file: generatedId,
    sources: [source.file],
    sourcesContent: [source.text],
    names: [],
    mappings: encode(lines),
  };
}
