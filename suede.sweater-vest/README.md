# sweater-vest-suede

> [!NOTE]
> This is a [suede](https://github.com/pmalacho-mit/suede) dependency.

Svelte component tests written as snippets, beside the component they test,
run by Vitest — and erased from every build, because a Vite plugin takes them
out before the compiler sees them.

```svelte
<!-- src/lib/Counter.svelte -->
<script lang="ts">
  import type Self from "./Counter.svelte";
  import type { Test, Widen } from "<path>/sweater-vest-suede/dsl.import.meta.vitest";

  let { count = 0 }: { count?: number } = $props();
</script>

<p>{count}</p>

<<!-- BEGIN SWEATER VEST TEST -->
{#snippet counts(
  Counter: typeof Self,
  pocket: { count: Widen<2>; el: HTMLDivElement },
  test: Test,
)}
  <p>{test.name}: {test.state}</p>
  <div bind:this={pocket.el}>
    <Counter count={pocket.count} />
  </div>
  {test(async ({ expect, flushSync }) => {
    expect(pocket.el.textContent).toContain("2");
    pocket.count = 3;
    flushSync();
    expect(pocket.el.textContent).toContain("3");
  })}
{/snippet}

```

The snippet is never rendered by the component, so the type checker reads it as
you write it — a prop of the wrong type is an error — and the plugin prints it as
a test component of its own, which Vitest runs under jsdom and your dev server
renders on a page of its own.

## Setup

Add the plugin to your Vite config, and its project to Vitest's:

```ts
// vite.config.ts
import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import sweaterVest from "<path>/sweater-vest-suede/vite-plugin/plugin.ts";

export default defineConfig({
  plugins: [sveltekit(), sweaterVest()],
  test: {
    projects: [
      sweaterVest.project(),
      // your other projects, as they were
    ],
  },
});
```

`sweaterVest.project()` is the project snippet tests run in, typed as exactly
what it returns:

```ts
{ extends: true; resolve: { conditions: ["browser"] }; test: { name: "sweater-vest"; environment: "jsdom"; include: [] } }
```

Every part is needed: `extends: true` inherits your config and the plugin with
it, the `browser` condition gives Svelte its client build, and `include: []`
because the plugin collects components itself. What may vary is an option:

```ts
sweaterVest.project({
  name: "dom",                          // then also sweaterVest({ project: "dom" })
  environment: "happy-dom",             // default "jsdom"
  test: { setupFiles: ["./setup.ts"] }, // anything else for this project's `test`
});
```

Without `projects` at all, the plugin collects in your one config; give it
`environment: "jsdom"` and `resolve: { conditions: ["browser"] }` yourself.

Installing with suede adds the packages the library needs to your
`package.json` (see [package.json](./package.json)): among them
`@typescript/typescript6`, the TypeScript the printer reads pocket types with,
installed under its own name so it never displaces yours, and `playwright`,
which the report drives. `jsdom` and `vitest` are yours to provide. Node 24
runs the library's TypeScript directly, so nothing is compiled first.

The options, all optional:

| Option      | What it does                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `project`   | The Vitest project name(s) that collect components. Every project without it.                                                |
| `exclude`   | Globs discovery skips, relative to the project root. `node_modules` and dot-directories are always skipped.                  |
| `extracted` | The glob for extracted tests, added to Vitest's `include`; `false` leaves them out. Default `**/*.vest.temp.svelte`.         |
| `tsconfig`  | The tsconfig file name, found upward from the working directory. Default `tsconfig.json`.                                    |
| `scan`      | Discover components with tests by scanning the working directory. Default `true`.                                            |
| `external`  | Where a browser outside this machine reaches the dev server (a container's published port), for the editor to open pages at. |
| `routes`    | SvelteKit's routes directory. Default `src/routes`.                                                                          |

For pages on your dev server, copy a route from [templates](./templates/README.md).

## Importing the DSL (_the path matters_)

Import the DSL from [dsl.import.meta.vitest.ts](./dsl.import.meta.vitest.ts) in
**every** component you write tests in, always as a type:

```svelte
<script lang="ts">
  import type Self from "./Counter.svelte";
  import type { Test } from "<path>/sweater-vest-suede/dsl.import.meta.vitest";
</script>
```

The module is named so that importing it puts the string `import.meta.vitest`
in your component. Vitest decides which files hold tests by keeping the ones
whose text contains that string (its
[in-source testing](https://vitest.dev/guide/in-source.html)), so importing the
DSL is what makes your tests findable. Re-exporting it from a barrel of your own
hides them; `import type` it directly.

## What counts as a test snippet

A snippet is the library's when it is **never rendered** and its **first
parameter is `typeof Self`**, where `Self` is the component's own type,
imported as a type from the file itself. An unused reference to its own source
is what marks in-source testing; nothing is read into a snippet's name or
position.

- With a parameter typed `Test`, it is a test: one Vitest test, named `Counter > counts`.
- Without one, it is an **example**: a page on the dev server, and a Vitest
  test that it mounts without throwing — so documentation stays valid.

Every parameter is handed in by what its type says:

| Parameter     | Written as                                 | Handed                                                      |
| ------------- | ------------------------------------------ | ----------------------------------------------------------- |
| the component | `Counter: typeof Self`                     | the component, as a value — always first                    |
| a pocket      | `pocket: { count: 2; el: HTMLDivElement }` | a reactive object, see below                                |
| a value       | `data: typeof fakeData`                    | the import `fakeData`, imported as a value if it was a type |
| the test      | `test: Test`                               | the function the body is handed to                          |

Anything else is an error where it is written, and the run stops.

### Components for tests

The DSL also exports `Sweater`, a namespace of components for writing and
showing tests. A snippet takes one as `typeof Sweater.<Name>`, and the
generated test imports the real component; the namespace itself is types, so
nothing of it reaches a build:

```svelte
<script lang="ts">
  import type Self from "./Counter.svelte";
  import type { Test, Sweater } from "<path>/sweater-vest-suede/dsl.import.meta.vitest";
</script>

{#snippet shown(Counter: typeof Self, Status: typeof Sweater.Status, Frame: typeof Sweater.Frame, test: Test)}
  <Status {test} />
  <Frame><Counter /></Frame>
  {test(async ({ expect }) => { … })}
{/snippet}
```

| Component       | What it is for                                                                        |
| --------------- | ------------------------------------------------------------------------------------- |
| `Status`        | the test's name, state, notes and failure: `<Status {test} />`                        |
| `Inspect`       | a live JSON view of a value, a pocket say: `<Inspect value={pocket} />`               |
| `Labeled`       | a caption over a variant: `<Labeled label="tone=good">…</Labeled>`                    |
| `Frame`         | a box sized to its content, with `bind:element` for a `capture` of just the component |
| `Stage`         | a viewport of a known size, `scroll` and `checkered` optional                         |
| `Row`, `Column` | variants side by side, or stacked, with `gap` and `align`                             |
| `Grid`          | a matrix of variants: `<Grid columns={3}>`                                            |
| `Theme`         | content under `scheme="light"` or `"dark"` (`color-scheme` and `data-theme`)          |

They live in [components/](./components), and each carries snippets of its
own that test it and show how it is used (`node <path>/cli.ts
<path>/components --markdown` prints them). Vendoring the library does not add
those tests to your suite: discovery skips the library's own folder.

### Pockets

A bare object type is a pocket: a `$state` object the snippet and the body
share. Members written as literal types are its initial value — `count: 2`
starts at `2` — and the rest start undefined, which is what an element or a
component instance is until the snippet binds it in:

```svelte
{#snippet counts(Counter: typeof Self, pocket: { count: Widen<2>; el: HTMLDivElement; counter: Self }, test: Test)}
  <div bind:this={pocket.el}>
    <Counter bind:this={pocket.counter} count={pocket.count} />
  </div>
```

`count: 2` is the type `2`, so the body could never assign `3` to it:
`Widen<2>` is `number` to the checker and `2` to the pocket. `typeof` an import
works as a member too (`data: typeof seed` starts as `seed`), and so do nested
objects, tuples and template literals.

Non-reactive values the markup shares are an `{@const}` inside the snippet.

### The test

Call `test` exactly once, in the snippet's markup, with the body. The body runs
once the markup is mounted (every `bind:this` is set) and is handed:

| Member                                     | What it is                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `expect`                                   | Vitest's                                                                                                                       |
| `user`                                     | a `@testing-library/user-event` session                                                                                        |
| `screen`, `within`, `fireEvent`, `waitFor` | Testing Library's                                                                                                              |
| `flushSync`, `tick`                        | Svelte's                                                                                                                       |
| `note(text)`                               | an annotation, kept with the outcome (a Vitest annotation too)                                                                 |
| `capture(el?, name?)`                      | a PNG of `el` (the page by default), kept with the outcome; a real screenshot, so only under the report — `null` anywhere else |
| `context`, `vi`                            | Vitest's, when running under Vitest                                                                                            |

A snippet that never calls `test`, or calls it twice, fails saying so.

`test` also carries the test's name and, reactively, where it stands, so the
snippet decides what a page shows and how — the library adds no markup of its
own around a snippet:

```svelte
<p>{test.name}: {test.state}{#if test.error}, {test.error}{/if}</p>
```

| Member       | What it is                                     |
| ------------ | ---------------------------------------------- |
| `test.name`  | `Counter > counts`                             |
| `test.state` | `"running"`, then `"passed"` or `"failed"`     |
| `test.error` | the failure's message, once it has failed      |
| `test.notes` | every `note` the body wrote so far, reactively |

## What works, and where the seams are

The library is exercised against the patterns component tests are actually
written with — Testing Library's own examples, the Svelte docs' testing page,
and the shapes real component libraries take — each as an example component
with snippet tests in the repository's `src/lib/examples`:

| Pattern                                                                     | Example       |
| --------------------------------------------------------------------------- | ------------- |
| a prop, a click, what appears                                               | `Greeter`     |
| a bindable prop, written back through the binding; keyboard activation      | `Counter`     |
| `bind:value` into a pocket; a callback prop                                 | `TextInput`   |
| a form: typing, selecting, checking, submitting, validation messages        | `Form`        |
| children and a snippet prop, declared inside the test snippet               | `Card`        |
| a keyed list driven by a pocket array                                       | `List`        |
| `{#await}` with an injected loader settled by the test; `waitFor`, `findBy` | `Async`       |
| an effect with a timer, waited for in real time                             | `Clock`       |
| context, through a provider component imported as a type                    | `Themed`      |
| a transition in and out                                                     | `Fade`        |
| a dialog: focus on open, `svelte:window` Escape to close                    | `Modal`       |
| ARIA roles and arrow-key navigation                                         | `Tabs`        |
| a component's exported functions, through the instance in the pocket        | `Stopwatch`   |
| shared runes state from a `.svelte.ts` module                               | `CartSummary` |
| a component's own `<style>`, kept under the snippet                         | `Card`        |
| examples only, no body: a page, and a test that they mount                  | `Badge`       |

Every one runs under Vitest and on its page, and a production build of an app
that uses all of those components (`src/routes/examples`) holds none of their
tests: no pocket, no harness module, no DSL, no type-only import.

The seams, so they are not surprises:

- **A snippet reaches its parameters, its own `{@const}`s, and imports.** Not
  the component's script: `let count = $state(0)` in the script is the
  component's, not a generated test's. Reading one is an error, reported where
  the snippet is, and it stops the run (Vitest, the dev server and a build
  alike) rather than skip the test quietly. Put shared values in a module and
  `import type` it. A parameter the plugin cannot hand in is an error the same way.
- **A snippet is a declaration.** Its name cannot be a script variable's.
- **jsdom has no Web Animations API.** Under Vitest the runtime makes every
  animation finish on the next tick, so a transition's element leaves when it
  should. Observers (`IntersectionObserver`, `ResizeObserver`) and `matchMedia`
  are not provided; a component that needs them wants a page, or a stub in a
  harness module.
- **`vi` is Vitest's.** On a page `payload.vi` is undefined. Fake timers are
  rarely what you want here anyway: the markup is mounted before the body
  runs, so a timer the component started already runs on real time; wait for
  it. Mocking a module needs `vi.mock` at the top of a module, which a snippet
  is not; prefer injecting what the component depends on (`Async`).
- **A style only a snippet uses leaves the build, with a word.** The snippet's
  markup is written under the component's `<style>`, and the generated test
  keeps the whole block, so a class the snippet adds for itself works there.
  In a build the snippet is gone, so to Svelte that selector is unused: it is
  dropped from the CSS and named in the build log as an unused selector. The
  library does not trim CSS; that warning is the signal that a selector is
  test-only, and the way to quiet it is to move such styles into the snippet's
  own markup or a harness component.
- **The pages route is left out of builds.** A route that imports the library
  is renamed out of SvelteKit's sight for the length of a build and restored
  after. Nothing of the page runner or its dependencies reaches a build.

## How a test is run

Nothing is written to disk. For a component with tests, the plugin removes the
test snippets and appends a collector to its module script:

```svelte
<script lang="ts" module>
  if (import.meta.vitest) {
    await import("./Counter.counts.vest.svelte");
  }
</script>
```

and serves each of those ids from memory: a component that imports yours as a
value, holds the snippet as written, and renders it with the component, a pocket
and the harness's `test`. Its module script registers it as one Vitest test.
Failures point at the line of the component you wrote.

In a build, the snippets are removed and nothing is appended.

## Pages

With a route from [templates](./templates/README.md), the dev server lists
every snippet at `/vests` and renders one at `/vests/<component>/<snippet>`
(`src/lib/Counter.svelte` > `counts` is `src/lib/Counter/counts`). A test runs
there too, live in the browser; the page shows exactly what the snippet wrote,
and `test.state` is how it says whether it passed. The page asks the dev
server for the list (`/__sweater-vest/tests.json`, which only the dev server
answers) and imports each generated component from it.

The route is the dev server's alone. In a build, a route whose `+page` or
`+layout` files import from the library is left out: for the length of the
build its `+` files are renamed so SvelteKit does not see them, and they are
put back when the build ends, however it ends. So a static adapter, which
refuses a dynamic route, builds clean, and no adapter ships a page that could
show nothing. One thing to keep in mind: a link to that route elsewhere in your
app is a link to nothing in a build, which a static adapter's crawler reports.

## The report

With the dev server running, the report opens every test snippet's page in a
real browser, waits for each to settle, and writes a Markdown report with every
failure's message, and the notes and captures each test made:

```sh
npm run dev          # terminal 1
npm run report       # terminal 2 → fashion-show.md, captures beside it in fashion-show.assets/
```

It exits non-zero when a test failed. Browsers come from `playwright`
(`npx playwright install chromium` once); Docker is not involved.

| Flag                  | Short | What it does                                      | Default                 |
| --------------------- | ----- | ------------------------------------------------- | ----------------------- |
| `--server <url>`      | `-s`  | where the dev server is                           | `http://localhost:5173` |
| `--route <path>`      | `-r`  | the route that renders a snippet on a page        | `/vests`                |
| `--browser <name>`    | `-b`  | `chromium`, `firefox` or `webkit`; repeatable     | `chromium`              |
| `--output <path>`     | `-o`  | the Markdown report; `""` writes nothing          | `./fashion-show.md`     |
| `--test <pattern>`    | `-t`  | only tests whose name matches, case-insensitively | all                     |
| `--timeout <seconds>` | `-w`  | how long one page may take to settle              | `60`                    |
| `--headed`            |       | show the browser                                  | off                     |

The same from code: `generateReport(options)` in [report/index.ts](./report/index.ts)
returns the runs and the counts.

## Extracting a test

A test can be written out as a real file beside its component:

```
src/lib/Counter.svelte  >  counts
src/lib/Counter.counts.vest.temp.svelte
```

It is the same module the plugin serves from memory as `Counter.counts.vest.svelte`
— the one both Vitest and the page load — made real, so everything that works
on a test file works on it: run it, put a breakpoint in it, edit it, delete it.
Only two things differ: the self-import names the real file, and the header.
The plugin adds `**/*.vest.temp.svelte` to Vitest's `include`; add `*.vest.temp.svelte`
to your `.gitignore`.

```
node <path>/cli.ts src/lib/Counter.svelte counts            # print it
node <path>/cli.ts src/lib/Counter.svelte counts --extract  # write it beside the component
node <path>/cli.ts src/lib/Counter.svelte --list            # the component's snippets, as JSON
node <path>/cli.ts src/lib/Counter.svelte --collector       # the component as Vitest sees it
node <path>/cli.ts --clean-extracted [dir]                  # delete extracted tests (edited ones kept, unless --force)
```

The [editor extension](./vscode-extension/README.md) extracts on a click and
puts Run, Debug and Delete at the top of the file it wrote.

## Snippets as documentation

A snippet is already how a reader would use the component, with a test
attached. The command line prints it that way, for a README:

```
node <path>/cli.ts src/lib/Counter.svelte --markdown                 # every snippet of the component
node <path>/cli.ts src/lib/Counter.svelte counts --markdown          # one snippet
node <path>/cli.ts src/lib --markdown --header-level 3 > docs.md     # every component under a directory
```

Each snippet becomes a heading, the usage as a Svelte component, and — for a
test — "Verified by" with the body of its test. A comment just above the
snippet becomes a line between the heading and the usage:

````markdown
### counts

```svelte
<script lang="ts">
  import Counter from "./Counter.svelte";

  let count = $state(2);
  let el = $state<HTMLDivElement>();
</script>

<div bind:this={el}>
  <Counter count={count} />
</div>
```

Verified by:

```ts
expect(el.textContent).toContain("2");
count = 3;
flushSync();
expect(el.textContent).toContain("3");
```
````

What is rewritten, all on the AST: the component's own type import becomes an
import under the name the snippet gave it; a pocket becomes `$state` locals
(`pocket.count` reads `count` throughout) unless the snippet also hands the
pocket around whole, in which case it stays an object; `typeof` imports and
`Sweater` components become real imports; `{test(…)}` and markup that only
shows the test (`<Status {test} />`, `{test.state}`) leave the usage, but the component
itself given `test` stays and the usage takes `test` as a prop; a top-level
`{@const}` moves into the script, `$derived` when it reads the test or the pocket; the
component's `<style>` comes along only if the markup uses a class from it;
and every import nothing refers to is dropped, the DSL's first. An example
(no `Test`) gets the usage alone. `--header-level` sets a component's heading;
its snippets sit one level below. The editor extension shows the same for an
extracted file.

## Where things are written

`.derived/` inside this folder holds `diagnostics.json`: what the plugin could
not hand in, by each component's absolute path, which the editor reads. It
ignores itself in git; delete it freely.

When the dev server runs in a container whose port is published somewhere
else, tell the plugin where, so the editor opens pages at the published
address:

```ts
sweaterVest({ external: `http://localhost:${process.env.SWEATER_VEST_PORT}` });
```

The editor asks the running server for it, so nothing but `vite.config.ts`
needs to know. The report runs beside the server and reaches it at
`localhost:5173` unless told otherwise with `--server`.

## Scripts

Run from `vscode-extension/`:

| Script                      | What it does                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `npm run install-extension` | builds, packages and installs the editor extension into VS Code (or VSCodium, Cursor) |
| `npm run build`             | only builds it                                                                        |
