// Every requirement in REQUIREMENTS.md cites at least one test, and every test
// it cites exists: a namespace test, a snippet test, or a Vitest test.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const root = new URL("../", import.meta.url);
/** A file, by its path from the repository's root. */
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const requirements = read("REQUIREMENTS.md")
  .split(/\n(?=- \*\*R\d+\.)/)
  .filter((block) => /^- \*\*R\d+\./.test(block))
  .map((block) => ({
    id: block.match(/^- \*\*(R\d+)\./)![1],
    cites: [...block.matchAll(/`([^`]+?) › ([^`]+)`/g)].map(
      ([, file, name]) => ({
        file,
        name,
      }),
    ),
  }));

const exists = (file: string, name: string) => {
  const source = read(file);
  return [`export type ${name} =`, `{#snippet ${name}(`, `test("${name}`].some(
    (form) => source.includes(form),
  );
};

test("requirements are numbered in order", () => {
  expect(requirements.map(({ id }) => id)).toEqual(
    requirements.map((_, index) => `R${index + 1}`),
  );
});

test("every requirement cites a test", () => {
  expect(
    requirements.filter(({ cites }) => cites.length === 0).map(({ id }) => id),
  ).toEqual([]);
});

test("every cited test exists", () => {
  const missing = requirements.flatMap(({ id, cites }) =>
    cites
      .filter(({ file, name }) => !exists(file, name))
      .map(({ file, name }) => `${id}: ${file} › ${name}`),
  );
  expect(missing).toEqual([]);
});
