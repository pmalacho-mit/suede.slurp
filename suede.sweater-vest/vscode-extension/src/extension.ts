import path from "node:path";
import * as vscode from "vscode";

import { hasTests } from "./discovery.ts";
import { ID, orComplain } from "./editor.ts";
import {
  debugExtracted,
  deleteExtracted,
  extractTest,
  markdownOfExtracted,
  runExtracted,
} from "./extracted.ts";
import { generatedViews } from "./generated.ts";
import { extractedFileLenses, testFileLenses } from "./lenses.ts";
import { forgetLibrary } from "./library.ts";
import { openAllPages, openPage } from "./page.ts";
import { printed } from "./printed.ts";
import { CONFIG_GLOB, forgetProjects } from "./project.ts";
import { testRunner, type TestRunner } from "./runner.ts";
import { childrenOf, everyItem, testTree, type TestTree } from "./tree.ts";
import { pluginWarnings } from "./warnings.ts";

type Parts = {
  output: vscode.OutputChannel;
  tree: TestTree;
  runner: TestRunner;
  showAgainst: ReturnType<typeof generatedViews>[1];
};

const command = (name: string, run: (...args: any[]) => unknown) =>
  vscode.commands.registerCommand(`${ID}.${name}`, run);

function testCommands({ output, tree, runner }: Parts) {
  return [
    command("runTest", async (id: string) => {
      const item = tree.itemFrom(id);
      if (item) await runner.run(item.uri, item);
    }),
    command("showProblem", (text: string) => {
      output.clear();
      output.appendLine(text);
      output.show(true);
    }),
    command("showFailure", (id: string) => {
      const outcome = runner.outcomeOf(id);
      if (outcome?.state !== "failed") return;
      output.clear();
      output.appendLine(outcome.message);
      output.show(true);
    }),
    command("extract", async (from?: vscode.TestItem | string) => {
      const item = tree.itemFrom(from);
      const test = item && tree.testOf(item);
      if (item && test) await extractTest(item, test.snippet, output);
    }),
    command("openPage", async (from?: vscode.TestItem | string) => {
      const item = tree.itemFrom(from);
      const test = item && tree.testOf(item);
      if (item && test) await openPage(item.uri, test.snippet, test.name);
    }),
    command(
      "openAllPages",
      async (uri: vscode.Uri | undefined = activeComponent()) => {
        if (!uri) return;
        tree.load(uri);
        const tests = tree
          .itemsOf(uri)
          .flatMap((item) => tree.testOf(item) ?? []);
        await openAllPages(
          uri,
          tests.filter((test) => test.generatable),
        );
      },
    ),
  ];
}

const activeComponent = () => vscode.window.activeTextEditor?.document.uri;

function generatedCommands({ output, showAgainst }: Parts) {
  return [
    command("showCollector", async (uri: vscode.Uri) => {
      const text = await orComplain(
        printed.collector(uri, output),
        output,
        `Could not read what Vitest sees for ${path.basename(uri.fsPath)}.`,
      );
      if (text !== null) await showAgainst(uri, text, "what Vitest sees");
    }),
    command(
      "showDocumentation",
      async (uri: vscode.Uri | undefined = activeComponent()) => {
        if (!uri) return;
        const text = await orComplain(
          printed.documentation(uri, output),
          output,
          `Could not document ${path.basename(uri.fsPath)}.`,
        );
        if (text === null) return;
        // the markdown to copy from, and beside it in the same group, how it reads
        const document = await vscode.workspace.openTextDocument({
          language: "markdown",
          content: text,
        });
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
        await vscode.commands.executeCommand(
          "markdown.showPreview",
          document.uri,
        );
      },
    ),
    command("runExtracted", runExtracted),
    command("markdownExtracted", (uri: vscode.Uri) =>
      markdownOfExtracted(uri, output),
    ),
    command("debugExtracted", debugExtracted),
    command("deleteExtracted", deleteExtracted),
  ];
}

const runProfile = (controller: vscode.TestController, runner: TestRunner) =>
  controller.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    async (request) => {
      const included = request.include ?? childrenOf(controller.items);
      const files = new Set(
        [...everyItem(included)]
          .filter((item) => !item.children.size && item.uri)
          .map((item) => item.uri!.toString()),
      );
      for (const file of files) await runner.run(vscode.Uri.parse(file));
    },
    true,
  );

const autoRunEnabled = () =>
  vscode.workspace.getConfiguration(ID).get<boolean>("autoRun", true);

const isComponent = (document: vscode.TextDocument) =>
  document.uri.scheme === "file" && document.languageId === "svelte";

/** Every component open in an editor tab, as URI strings. */
const componentsInTabs = () =>
  new Set(
    vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.flatMap(({ input }) =>
        input instanceof vscode.TabInputText &&
        input.uri.scheme === "file" &&
        input.uri.fsPath.endsWith(".svelte")
          ? [input.uri.toString()]
          : [],
      ),
    ),
  );

function followDocuments(
  { tree, runner }: Parts,
  lensesChanged: vscode.EventEmitter<void>,
  rescanWarnings: () => void,
) {
  const autoRun = (uri: vscode.Uri, text?: string) => {
    const tests = tree.load(uri, text);
    if (tests.length && autoRunEnabled()) void runner.run(uri);
  };
  const load = (document: vscode.TextDocument) => {
    if (isComponent(document)) tree.load(document.uri, document.getText());
  };

  // runs are for components in a tab, the ones the user is looking at: one an extension loads
  // without showing it (a formatter saving a batch, say) is listed, but not run
  let shown = componentsInTabs();
  for (const document of vscode.workspace.textDocuments) load(document);
  for (const uri of shown) autoRun(vscode.Uri.parse(uri));
  return [
    // a component that gains a tab; moving one, or a second tab of it, is not a new one
    vscode.window.tabGroups.onDidChangeTabs(() => {
      const now = componentsInTabs();
      for (const uri of now)
        if (!shown.has(uri)) autoRun(vscode.Uri.parse(uri));
      shown = now;
    }),
    vscode.workspace.onDidOpenTextDocument(load),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!isComponent(document)) return;
      if (shown.has(document.uri.toString()))
        autoRun(document.uri, document.getText());
      else load(document);
    }),
    // an edit moves the tests, but does not change what they last did
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (!isComponent(document)) return;
      tree.load(document.uri, document.getText());
      lensesChanged.fire();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(
      () => (forgetLibrary(), forgetProjects()),
    ),
    ...followConfigs(tree, lensesChanged, rescanWarnings),
  ];
}

// a Vite config that gains or loses the plugin moves which project its components belong to,
// and may bring a library whose diagnostics were not followed yet
function followConfigs(
  tree: TestTree,
  lensesChanged: vscode.EventEmitter<void>,
  rescanWarnings: () => void,
) {
  const watcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB);
  const changed = () => {
    forgetProjects();
    for (const document of vscode.workspace.textDocuments)
      if (isComponent(document)) tree.load(document.uri);
    lensesChanged.fire();
    rescanWarnings();
  };
  watcher.onDidChange(changed);
  watcher.onDidCreate(changed);
  watcher.onDidDelete(changed);
  return [watcher];
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = vscode.tests.createTestController(ID, "Sweater Vest");
  const warnings = vscode.languages.createDiagnosticCollection(ID);
  const output = vscode.window.createOutputChannel("Sweater Vest");
  const lensesChanged = new vscode.EventEmitter<void>();
  const [views, showAgainst] = generatedViews();
  context.subscriptions.push(
    controller,
    warnings,
    output,
    lensesChanged,
    views,
  );

  const tree = testTree(controller, output);
  const runner = testRunner({ controller, output, tree, lensesChanged });
  const parts: Parts = { output, tree, runner, showAgainst };

  controller.resolveHandler = async (item) => {
    if (item?.uri) return void tree.load(item.uri);
    for (const uri of await vscode.workspace.findFiles(
      "**/*.svelte",
      "**/node_modules/**",
    ))
      if (
        hasTests(
          await vscode.workspace.fs
            .readFile(uri)
            .then((b) => Buffer.from(b).toString("utf8")),
        )
      )
        tree.load(uri);
  };

  const plugin = pluginWarnings(warnings);
  context.subscriptions.push(
    runProfile(controller, runner),
    testFileLenses(tree, runner, lensesChanged),
    extractedFileLenses(),
    ...testCommands(parts),
    ...generatedCommands(parts),
    plugin,
  );
  void controller.resolveHandler(undefined);
  context.subscriptions.push(
    ...followDocuments(parts, lensesChanged, plugin.rescan),
  );
}

export function deactivate(): void {}
