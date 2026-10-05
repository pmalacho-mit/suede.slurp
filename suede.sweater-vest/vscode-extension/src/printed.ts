import path from "node:path";
import * as vscode from "vscode";

import { ID, folderOf, libraryOf } from "./editor.ts";
import { exec } from "./process.ts";

const configuredCommand = () =>
  vscode.workspace.getConfiguration(ID).get<string>("cliCommand", "");

type Command = [command: string, args: string[]];

function commandFor(uri: vscode.Uri, cwd: string, rest: string[]): Command {
  const file = path.relative(cwd, uri.fsPath);
  const configured = configuredCommand();
  if (configured) {
    const [command = "", ...args] = configured.split(" ");
    return [command, [...args, file, ...rest]];
  }
  const library = libraryOf(uri);
  if (!library)
    throw new Error(
      `Could not find sweater-vest's cli.ts in this workspace; set ${ID}.cliCommand`,
    );
  return ["node", [library.cli, file, ...rest]];
}

async function ask(
  uri: vscode.Uri,
  rest: string[],
  output: vscode.OutputChannel,
): Promise<string> {
  const cwd = folderOf(uri);
  const [command, args] = commandFor(uri, cwd, rest);
  const result = await exec(command, args, cwd);
  if (result.stdout.trim()) return result.stdout;
  output.appendLine(`${command} ${args.join(" ")}`);
  output.appendLine(result.stderr || "(no output)");
  throw new Error(`No generated source for ${rest.join(" ")}`);
}

export const printed = {
  test: (uri: vscode.Uri, snippet: string, output: vscode.OutputChannel) =>
    ask(uri, [snippet], output),
  /** Writes the test beside its component and gives back the path. */
  extract: async (
    uri: vscode.Uri,
    snippet: string,
    output: vscode.OutputChannel,
  ) =>
    path.resolve(
      folderOf(uri),
      (await ask(uri, [snippet, "--extract"], output)).trim(),
    ),
  collector: (uri: vscode.Uri, output: vscode.OutputChannel) =>
    ask(uri, ["--collector"], output),
  /** The snippet as documentation: its usage, then what verifies it. */
  markdown: (uri: vscode.Uri, snippet: string, output: vscode.OutputChannel) =>
    ask(uri, [snippet, "--markdown", "--header-level", "2"], output),
  /** Every snippet of the component as documentation, under the component's heading. */
  documentation: (uri: vscode.Uri, output: vscode.OutputChannel) =>
    ask(uri, ["--markdown", "--header-level", "1"], output),
};
