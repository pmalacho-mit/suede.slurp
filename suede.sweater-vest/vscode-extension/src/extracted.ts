import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { extracted, tempPathFor } from "../../extract.ts";
import {
  closeEditorsFor,
  contentsOf,
  folderOf,
  openHere,
  orComplain,
  quoteArg,
} from "./editor.ts";
import { printed } from "./printed.ts";
import { vitestEntryFrom } from "./project.ts";

import type { LocatedItem } from "./tree.ts";

const TERMINAL = "Sweater Vest";

const isHandEdited = (text: string) => {
  const mine = extracted(text);
  return !mine || mine.edited;
};

const mayOverwrite = async (target: string) => {
  if (
    !fs.existsSync(target) ||
    !isHandEdited(contentsOf(vscode.Uri.file(target)))
  )
    return true;
  const answer = await vscode.window.showWarningMessage(
    `${path.basename(target)} has changes that were not generated.`,
    { modal: true },
    "Open it",
    "Overwrite",
  );
  if (answer === "Open it") await openHere(target);
  return answer === "Overwrite";
};

const mayDelete = async (uri: vscode.Uri) =>
  !isHandEdited(contentsOf(uri)) ||
  (await vscode.window.showWarningMessage(
    `${path.basename(uri.fsPath)} has changes that were not generated. Delete it?`,
    { modal: true },
    "Delete",
  )) === "Delete";

export async function extractTest(
  item: LocatedItem,
  snippet: string,
  output: vscode.OutputChannel,
) {
  const target = tempPathFor(item.uri.fsPath, snippet);
  if (!(await mayOverwrite(target))) return;
  const written = await orComplain(
    printed.extract(item.uri, snippet, output),
    output,
    `Could not extract ${item.label}.`,
  );
  if (written !== null) await openHere(written);
}

export function runExtracted(uri: vscode.Uri) {
  const cwd = folderOf(uri);
  const terminal =
    vscode.window.terminals.find((t) => t.name === TERMINAL) ??
    vscode.window.createTerminal({ name: TERMINAL, cwd });
  terminal.show(true);
  terminal.sendText(
    `npx vitest run ${quoteArg(path.relative(cwd, uri.fsPath))} --reporter=verbose`,
  );
}

const debugConfiguration = (
  cwd: string,
  relative: string,
): vscode.DebugConfiguration => ({
  type: "node",
  request: "launch",
  name: `Debug ${path.basename(relative)}`,
  cwd,
  program:
    vitestEntryFrom(cwd) ??
    path.join(cwd, "node_modules", "vitest", "vitest.mjs"),
  // one process, no timeout: a breakpoint that is sat on is not a failure
  args: ["run", relative, "--no-file-parallelism", "--testTimeout=0"],
  autoAttachChildProcesses: true,
  console: "integratedTerminal",
  smartStep: true,
  skipFiles: ["<node_internals>/**"],
});

export async function debugExtracted(uri: vscode.Uri) {
  const cwd = folderOf(uri);
  const relative = path.relative(cwd, uri.fsPath);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (
    !(await vscode.debug.startDebugging(
      folder,
      debugConfiguration(cwd, relative),
    ))
  )
    void vscode.window.showErrorMessage(
      `Could not start a debug session for ${path.basename(relative)}.`,
    );
}

/** The extract's snippet as Markdown, in an editor beside it. */
export async function markdownOfExtracted(
  uri: vscode.Uri,
  output: vscode.OutputChannel,
) {
  const origin = extracted(contentsOf(uri));
  if (!origin) return;
  const source = vscode.Uri.file(path.resolve(folderOf(uri), origin.source));
  const text = await orComplain(
    printed.markdown(source, origin.snippet, output),
    output,
    `Could not document ${origin.snippet}.`,
  );
  if (text === null) return;
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: text,
  });
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
  });
}

export async function deleteExtracted(uri: vscode.Uri) {
  if (!(await mayDelete(uri))) return;
  // closed first, or its tab is left showing a file that is gone
  await closeEditorsFor(uri);
  await vscode.workspace.fs.delete(uri);
}
