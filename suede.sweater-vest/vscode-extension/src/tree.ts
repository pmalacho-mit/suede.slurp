import fs from "node:fs";
import * as vscode from "vscode";

import { discover, hasTests, type DiscoveredTest } from "./discovery.ts";
import { folderOf, libraryOf, rangeOf } from "./editor.ts";
import type { Library } from "./library.ts";
import { parseWithCompilerOf } from "./svelte.ts";

export type LocatedItem = vscode.TestItem & { uri: vscode.Uri };

export const testId = (uri: vscode.Uri, name: string) =>
  `${uri.toString()}::${name}`;

export const childrenOf = (collection: vscode.TestItemCollection) => {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => {
    items.push(item);
  });
  return items;
};

export function* everyItem(
  items: readonly vscode.TestItem[],
): Generator<vscode.TestItem> {
  for (const item of items) {
    yield item;
    yield* everyItem(childrenOf(item.children));
  }
}

const unparsableBecause = (folder: string, library: Library | null) =>
  library
    ? `${folder}: found the library, but no Svelte compiler beside it to parse with — is svelte installed?`
    : `${folder}: no sweater-vest library found, so its tests cannot be discovered.`;

const textOf = (uri: vscode.Uri) => {
  try {
    return fs.readFileSync(uri.fsPath, "utf8");
  } catch {
    return null;
  }
};

export function testTree(
  controller: vscode.TestController,
  output: vscode.OutputChannel,
) {
  const toldUnparsable = new Set<string>();
  const discovered = new Map<string, DiscoveredTest>();

  const parsable = (uri: vscode.Uri) => {
    const folder = folderOf(uri);
    const library = libraryOf(uri);
    if (library && parseWithCompilerOf(folder)) return true;
    if (!toldUnparsable.has(folder)) {
      toldUnparsable.add(folder);
      output.appendLine(unparsableBecause(folder, library));
    }
    return false;
  };

  const fileItem = (uri: vscode.Uri) => {
    const file =
      controller.items.get(uri.toString()) ??
      controller.createTestItem(
        uri.toString(),
        vscode.workspace.asRelativePath(uri),
        uri,
      );
    controller.items.add(file);
    return file;
  };

  const testItem = (uri: vscode.Uri, test: DiscoveredTest) => {
    const id = testId(uri, test.name);
    const item = controller.createTestItem(id, test.name, uri);
    item.range = rangeOf(test);
    if (!test.test) item.description = "example";
    discovered.set(id, test);
    return item;
  };

  const load = (uri: vscode.Uri, text = textOf(uri)): DiscoveredTest[] => {
    if (text === null) return [];
    if (!hasTests(text) || !parsable(uri)) {
      controller.items.delete(uri.toString());
      return [];
    }
    let tests: DiscoveredTest[];
    try {
      tests = discover(uri.fsPath, text);
    } catch {
      return []; // mid-edit, the file may not parse: what was last loaded stands
    }
    fileItem(uri).children.replace(tests.map((test) => testItem(uri, test)));
    return tests;
  };

  const itemsOf = (uri: vscode.Uri) => {
    const file = controller.items.get(uri.toString());
    return file ? childrenOf(file.children) : [];
  };

  const itemFrom = (from?: vscode.TestItem | string): LocatedItem | null => {
    const item =
      typeof from === "string"
        ? [...everyItem(childrenOf(controller.items))].find(
            ({ id }) => id === from,
          )
        : from;
    return item?.uri ? (item as LocatedItem) : null;
  };

  const testOf = (item: vscode.TestItem) => discovered.get(item.id) ?? null;

  return { parsable, load, itemsOf, itemFrom, testOf };
}

export type TestTree = ReturnType<typeof testTree>;
