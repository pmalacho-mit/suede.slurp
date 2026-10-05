import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as vscode from "vscode";

import { folderOf } from "./editor.ts";
import { exec } from "./process.ts";

export type Assertion = {
  title: string;
  fullName?: string;
  status: string;
  failureMessages?: string[];
};

export type Report = { assertions: Assertion[] };

const assertionsIn = (file: string): Assertion[] => {
  const report = JSON.parse(fs.readFileSync(file, "utf8")) as {
    testResults?: { assertionResults?: Assertion[] }[];
  };
  return (report.testResults ?? []).flatMap((f) => f.assertionResults ?? []);
};

const temporaryReport = () =>
  path.join(
    os.tmpdir(),
    `sweater-vest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `-t` takes a pattern: the name, as a pattern that matches only it */
export const testFilter = (name: string) => `^${escapeRegExp(name)}$`;

export async function vitest(
  uri: vscode.Uri,
  only: string | undefined,
  output: vscode.OutputChannel,
): Promise<Report> {
  const cwd = folderOf(uri);
  const outputFile = temporaryReport();
  const args = [
    "vitest",
    "run",
    path.relative(cwd, uri.fsPath),
    "--reporter=json",
    `--outputFile=${outputFile}`,
    ...(only ? ["-t", testFilter(only)] : []),
  ];
  const result = await exec("npx", args, cwd);
  if (!fs.existsSync(outputFile)) {
    output.appendLine(`npx ${args.join(" ")}`);
    output.appendLine(result.stderr || result.stdout);
    throw new Error("Vitest produced no report");
  }
  try {
    return { assertions: assertionsIn(outputFile) };
  } finally {
    fs.rmSync(outputFile, { force: true });
  }
}
