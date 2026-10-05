import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { diagnosticAt, type Span } from "./editor.ts";
import { findLibrary } from "./library.ts";
import { CONFIG_GLOB, projectAt } from "./project.ts";

type Warning = Span & { message: string; severity?: "error" | "warning" };

// null while it is being written: the watcher fires again once it has been
const warningsIn = (file: string): Record<string, Warning[]> | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/**
 * Each library's diagnostics file: the one a project's Vite config imports (an
 * app in a subdirectory, say), else the one in a workspace folder.
 */
async function diagnosticsFiles(): Promise<Set<string>> {
  const files = new Set<string>();
  const add = (derived: string) =>
    files.add(path.join(derived, "diagnostics.json"));
  for (const config of await vscode.workspace.findFiles(
    CONFIG_GLOB,
    "**/node_modules/**",
  )) {
    const project = projectAt(path.dirname(config.fsPath));
    if (project) add(project.library.derived);
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const library = findLibrary(folder.uri.fsPath);
    if (library) add(library.derived);
  }
  return files;
}

// the plugin writes absolute paths; one from before it did is relative to the workspace folder
const publish = (diagnostics: vscode.DiagnosticCollection, file: string) => {
  const base =
    vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath ??
    "";
  for (const [warned, warnings] of Object.entries(warningsIn(file) ?? {}))
    diagnostics.set(
      vscode.Uri.file(path.resolve(base, warned)),
      warnings.map((w) =>
        diagnosticAt(
          w,
          w.message,
          w.severity === "warning"
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Error,
        ),
      ),
    );
};

/** Diagnostics from every library's file, followed as they are written; `rescan` after a config changes. */
export function pluginWarnings(diagnostics: vscode.DiagnosticCollection) {
  const watchers = new Map<string, vscode.Disposable>();
  const rescan = () =>
    void diagnosticsFiles().then((files) => {
      for (const file of files) {
        if (watchers.has(file)) continue;
        publish(diagnostics, file);
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(
            vscode.Uri.file(path.dirname(file)),
            path.basename(file),
          ),
        );
        const refresh = () => publish(diagnostics, file);
        watcher.onDidChange(refresh);
        watcher.onDidCreate(refresh);
        watchers.set(file, watcher);
      }
    });
  rescan();
  return Object.assign(
    new vscode.Disposable(() => {
      for (const watcher of watchers.values()) watcher.dispose();
    }),
    { rescan },
  );
}
