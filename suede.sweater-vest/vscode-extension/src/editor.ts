import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { findLibrary } from "./library.ts";
import { projectOf } from "./project.ts";

export const ID = "sweater-vest";

export type Span = { line: number; column: number; length: number };

export const rangeOf = ({ line, column, length }: Span) =>
  new vscode.Range(line, column, line, column + length);

export const diagnosticAt = (
  span: Span,
  message: string,
  severity: vscode.DiagnosticSeverity,
) => {
  const diagnostic = new vscode.Diagnostic(rangeOf(span), message, severity);
  diagnostic.source = ID;
  return diagnostic;
};

export const workspaceFolderOf = (uri: vscode.Uri) =>
  vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ??
  path.dirname(uri.fsPath);

/**
 * The directory a component's project runs from: where Vitest is started, the
 * command line runs, and page keys are relative to. The nearest directory above
 * the file whose Vite config imports the library's plugin (an app in a
 * subdirectory of the workspace), else the workspace folder.
 */
export const folderOf = (uri: vscode.Uri) => {
  const workspace = workspaceFolderOf(uri);
  return projectOf(uri.fsPath, workspace)?.root ?? workspace;
};

/** The library a component's project uses: the one its Vite config imports, else the first in the workspace. */
export const libraryOf = (uri: vscode.Uri) => {
  const workspace = workspaceFolderOf(uri);
  return projectOf(uri.fsPath, workspace)?.library ?? findLibrary(workspace);
};

// an open editor's unsaved text is the truth, not what was last written
export const contentsOf = (uri: vscode.Uri) => {
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.fsPath === uri.fsPath,
  );
  if (open) return open.getText();
  try {
    return fs.readFileSync(uri.fsPath, "utf8");
  } catch {
    return "";
  }
};

// in the active group, as a tab of its own: an extract is worked on, not glanced at
export const openHere = async (file: string) => {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(file),
  );
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Active,
    preview: false,
  });
};

const shows = (tab: vscode.Tab, uri: vscode.Uri) =>
  tab.input instanceof vscode.TabInputText &&
  tab.input.uri.fsPath === uri.fsPath;

const closeTab = async (
  group: vscode.TabGroup,
  tab: vscode.Tab,
  uri: vscode.Uri,
) => {
  if (!tab.isDirty) return void (await vscode.window.tabGroups.close(tab));
  // reverting is what closes a tab with unsaved changes without asking to save them
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    viewColumn: group.viewColumn,
    preview: false,
  });
  await vscode.commands.executeCommand(
    "workbench.action.revertAndCloseActiveEditor",
  );
};

export const closeEditorsFor = async (uri: vscode.Uri) => {
  for (const group of vscode.window.tabGroups.all)
    for (const tab of group.tabs)
      if (shows(tab, uri)) await closeTab(group, tab, uri);
};

export const quoteArg = (value: string) =>
  /^[\w./-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;

export async function orComplain<T>(
  work: Promise<T>,
  output: vscode.OutputChannel,
  message: string,
): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    output.appendLine(String(error));
    output.show(true);
    void vscode.window.showErrorMessage(
      `${message} See the Sweater Vest output.`,
    );
    return null;
  }
}
