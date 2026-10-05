# Sweater Vest

Snippet tests in the editor.

Every test snippet of a component that imports the DSL shows up as a test: in
the Test Explorer, in the gutter, and as a lens above the line you wrote it on.
Running one runs exactly that one. An example snippet (no `Test` parameter)
runs too: its test is that it mounts.

Install it from this folder with `npm run install-extension`: it builds,
packages and installs it into VS Code, VSCodium or Cursor, whichever is on your
path. It parses with your project's own Svelte compiler and runs the library's
`cli.ts` with Node 24.

- **Run** — a single snippet, through Vitest, reported back at its own line. A
  component runs when you open it in a tab or save it there, and the lens shows
  where each stands. One another extension loads without a tab — a formatter
  saving a batch, say — is listed, but not run.
- **Open page** — the snippet on your dev server, under `sweater-vest.pagesRoute`
  (default `/vests`), in a panel beside the editor. The extension reaches the
  server at `sweater-vest.devServer` (default `localhost:5173`) and asks it
  where a browser should open pages: the plugin's `external` option when set
  (a container's published port), else that address through the editor's
  tunnel to the extension host. `sweater-vest.openIn: "browser"` opens the
  system browser instead.
- **What Vitest sees** — at the top of a component with tests: your file diffed
  against the module Vitest is handed, which is your component without its test
  snippets plus the block that imports one generated test per snippet.
- **Open all pages** — beside it: every snippet of the component on its page,
  laid out as you pick: a *gallery* (one tab, each page in a frame of its own,
  since a page's test reads the whole document) or *tabs* (a new tab group, a
  tab per page), either one in a new window where the editor can open one
  (desktop builds). The last pick is offered first;
  `sweater-vest.openAllLayout` stops the asking. Every page runs its test as it
  loads, so this is also the component's tests in a real browser.
- **Documentation** — beside it: every snippet of the component as
  documentation (the `--markdown` of the command line), opened as Markdown
  with its preview in front.
- **Extract** — writes the test out as a real file beside the component
  (`Counter.counts.vest.temp.svelte`) and opens it in the same tab group.
- **Run · Debug · Markdown · Delete** — at the top of an extracted file.
  *Markdown* opens the snippet as documentation beside it: the usage a reader
  would write, then "Verified by" with the test's body. *Debug* launches
  Vitest under the Node debugger on that one file, in a single process, with no
  test timeout.
- **Failures** — clicking a failed lens opens the output with Vitest's message
  and the frames from your own code.
- **Errors** — a parameter the plugin cannot hand in, or a snippet reaching a
  variable of the component's script, reported where you wrote it; the lens
  above such a snippet says what is wrong, and a click shows the whole of it.

The extension bundles the library's analyser at build time. After updating the
library, run `npm run install-extension` again, or its lenses may disagree
with what the plugin does.

## An app in a subdirectory

A component's project is the nearest directory above it whose Vite or Vitest
config imports the plugin, not necessarily the workspace folder. So an app in
a subdirectory of a repository — a workspace package such as `app/` beside the
library it demonstrates — needs nothing configured: Vitest runs from `app/`,
pages are keyed relative to it (as its dev server keys them), and the command
line is the one that config imports. Where no config above a component imports
the plugin, the workspace folder is used, as before. Editing a config is picked
up as you save it.

## About extracted files

They are yours. Edit them freely — nothing regenerates them behind your back,
and *Delete* asks first if what is in the file is no longer what was written
out. Extracting again over a file you have edited asks before overwriting.

They end in `.vest.temp.svelte`, which the plugin adds to Vitest's `include` so they
run like any other test file. Add `*.vest.temp.svelte` to your `.gitignore`.
