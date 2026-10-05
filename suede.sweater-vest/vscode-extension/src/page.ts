import path from "node:path";
import * as vscode from "vscode";

import { pageKey } from "./discovery.ts";
import { ID, folderOf } from "./editor.ts";

const setting = <T>(key: string, fallback: T) =>
  vscode.workspace.getConfiguration(ID).get<T>(key, fallback);

type Server = { url: string; external: boolean };

// what the plugin was configured with, asked of the running server: see `external` in its options
const CONFIG_ENDPOINT = "/__sweater-vest/config.json";

const configuredExternal = async (local: string): Promise<string | null> => {
  try {
    const response = await fetch(`${local}${CONFIG_ENDPOINT}`, {
      signal: AbortSignal.timeout(1500),
    });
    const { external } = (await response.json()) as {
      external?: string | null;
    };
    return typeof external === "string" ? external : null;
  } catch {
    return null;
  }
};

/**
 * Where to open the dev server: the address it says a browser outside reaches
 * it at (the plugin's `external` option — a container's published port), used
 * as is; else its own port on the extension host, to be tunnelled.
 */
const devServer = async (): Promise<Server> => {
  const local = setting("devServer", "http://localhost:5173").replace(
    /\/$/,
    "",
  );
  const external = await configuredExternal(local);
  return external
    ? { url: external, external: true }
    : { url: local, external: false };
};

/** The dev server's page for a snippet, and whether its address is already reachable from outside. */
export async function pageUrl(
  uri: vscode.Uri,
  snippet: string,
): Promise<{ url: URL; external: boolean }> {
  const folder = folderOf(uri);
  const server = await devServer();
  const route = setting("pagesRoute", "/vests").replace(/\/$/, "");
  const base = server.url.replace(/\/$/, "");
  return {
    url: new URL(
      `${base}${route}/${pageKey(path.relative(folder, uri.fsPath), snippet)}`,
    ),
    external: server.external,
  };
}

const panels = new Map<string, vscode.WebviewPanel>();

const html = (url: URL) => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${url.origin}; style-src 'unsafe-inline';" />
    <style>html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; }</style>
  </head>
  <body><iframe src="${url.href}" allow="clipboard-read; clipboard-write"></iframe></body>
</html>`;

/**
 * The page inside the editor. An address that is already reachable from
 * outside is used as is; otherwise the webview's `localhost:<port>` is
 * tunnelled by the editor to the extension host's.
 */
function showInWebview(
  name: string,
  url: URL,
  external: boolean,
  content = html(url),
  column = vscode.ViewColumn.Beside,
) {
  const existing = panels.get(name);
  if (existing) {
    existing.webview.html = content; // reloads it
    existing.reveal(column, true);
    return existing;
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const panel = vscode.window.createWebviewPanel(
    `${ID}.page`,
    name,
    { viewColumn: column, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      ...(external
        ? {}
        : { portMapping: [{ webviewPort: port, extensionHostPort: port }] }),
    },
  );
  panel.webview.html = content;
  panel.onDidDispose(() => panels.delete(name));
  panels.set(name, panel);
  return panel;
}

export async function openPage(uri: vscode.Uri, snippet: string, name: string) {
  const { url, external } = await pageUrl(uri, snippet);
  if (setting<"webview" | "browser">("openIn", "webview") === "browser") {
    const target = vscode.Uri.parse(url.href);
    return vscode.env.openExternal(
      external ? target : await vscode.env.asExternalUri(target),
    );
  }
  showInWebview(name, url, external);
}

// ── every page of a component at once ────────────────────────────────────────

type Page = { name: string; url: URL };
type Layout = { layout: "gallery" | "tabs"; window: boolean };

const LAYOUTS: Record<string, vscode.QuickPickItem & Layout> = {
  gallery: {
    label: "$(list-flat) Gallery",
    detail: "One tab, every page stacked in its own frame",
    layout: "gallery",
    window: false,
  },
  tabs: {
    label: "$(files) Tabs",
    detail: "A new tab group beside the editor, a tab per page",
    layout: "tabs",
    window: false,
  },
  galleryWindow: {
    label: "$(window) Gallery in a new window",
    detail: "The gallery, in a window of its own",
    layout: "gallery",
    window: true,
  },
  tabsWindow: {
    label: "$(multiple-windows) Tabs in a new window",
    detail: "The tab group, in a window of its own",
    layout: "tabs",
    window: true,
  },
};

// asked each time unless a layout is set; the last one picked is offered first
let lastPicked = "gallery";

async function chooseLayout(): Promise<Layout | null> {
  const set = setting("openAllLayout", "ask");
  if (LAYOUTS[set]) return LAYOUTS[set];
  const keys = [
    lastPicked,
    ...Object.keys(LAYOUTS).filter((key) => key !== lastPicked),
  ];
  const picked = await vscode.window.showQuickPick(
    keys.map((key) => ({ ...LAYOUTS[key]!, key })),
    {
      title: "Open all pages",
      placeHolder: `How to lay them out (set ${ID}.openAllLayout to stop asking)`,
    },
  );
  if (!picked) return null;
  lastPicked = picked.key;
  return picked;
}

const escaped = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

// a frame per page: a page runs its test against the whole document, so two never share one
const galleryHtml = (pages: Page[]) => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${[...new Set(pages.map((p) => p.url.origin))].join(" ")}; style-src 'unsafe-inline';" />
    <style>
      body { margin: 0; padding: 0 1rem 2rem; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
      h2 { margin: 1.2rem 0 0.4rem; font-size: 13px; font-weight: 600; }
      .page { height: 320px; resize: vertical; overflow: hidden; border: 1px solid var(--vscode-panel-border); }
      iframe { width: 100%; height: 100%; border: 0; background: white; }
    </style>
  </head>
  <body>
${pages.map((p) => `    <h2>${escaped(p.name)}</h2>\n    <div class="page"><iframe src="${p.url.href}" allow="clipboard-read; clipboard-write"></iframe></div>`).join("\n")}
  </body>
</html>`;

// the editor's own command moves whatever is focused; a web build has none, so say so
async function intoNewWindow(command: string) {
  try {
    await vscode.commands.executeCommand(command);
  } catch {
    void vscode.window.showWarningMessage(
      "This editor cannot open a new window; the pages stay where they are.",
    );
  }
}

/** Every snippet of a component on its page, laid out as the user picks. */
export async function openAllPages(
  uri: vscode.Uri,
  snippets: { snippet: string; name: string }[],
) {
  if (!snippets.length) return;
  const resolved = await Promise.all(
    snippets.map((s) => pageUrl(uri, s.snippet)),
  );
  const external = resolved[0]!.external;
  const pages: Page[] = snippets.map((s, i) => ({
    name: s.name,
    url: resolved[i]!.url,
  }));
  if (setting<"webview" | "browser">("openIn", "webview") === "browser") {
    for (const { url } of pages) {
      const target = vscode.Uri.parse(url.href);
      await vscode.env.openExternal(
        external ? target : await vscode.env.asExternalUri(target),
      );
    }
    return;
  }
  const layout = await chooseLayout();
  if (!layout) return;
  if (layout.layout === "gallery") {
    const name = `${path.basename(uri.fsPath, ".svelte")} · all pages`;
    const panel = showInWebview(
      name,
      pages[0]!.url,
      external,
      galleryHtml(pages),
    );
    if (!layout.window) return;
    panel.reveal(panel.viewColumn, false);
    return intoNewWindow("workbench.action.moveEditorToNewWindow");
  }
  // a group of their own, so a new window takes the pages and nothing else
  await vscode.commands.executeCommand("workbench.action.newGroupRight");
  const opened = pages.map((p) =>
    showInWebview(
      p.name,
      p.url,
      external,
      html(p.url),
      vscode.ViewColumn.Active,
    ),
  );
  opened[0]!.reveal(vscode.ViewColumn.Active, !layout.window);
  if (layout.window)
    await intoNewWindow("workbench.action.moveEditorGroupToNewWindow");
}
