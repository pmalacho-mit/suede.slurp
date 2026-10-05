# Examples

Each component here shows one way to use `URLParameterize` (from `release/`),
and carries [sweater-vest](../../suede.sweater-vest/README.md) snippet tests
that prove it does what it says. Read them in this order:

| Example                             | What it shows                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Pagination](./Pagination.svelte)   | The basics: a class with a `$state` property kept in the URL (`?page=2`), a `resolve` that turns whatever is in the URL into a valid value, `onDestroy` for cleanup, and the back button.    |
| [SortedTable](./SortedTable.svelte) | Verbose handlers: a custom `key` (`?sort=`), plain-text values (`serialize: (column) => column`), a union-typed property, and `history: "replace"` for changes that are not navigations.     |
| [Filters](./Filters.svelte)         | A plain `$state` object instead of a class, an array stored as repeated entries (`entries: "multiple"`, `?lang=js&lang=ts`), and `url.key`, typed to the tracked properties.                 |
| [SearchBox](./SearchBox.svelte)     | Debouncing writes while typing, removing the parameter when the value is empty (`serialize` returning `undefined`), and `previousKeys` to keep old links (`?query=`) working after a rename. |
| [Tabs](./Tabs.svelte)               | State in the hash (`in: "hash"`, `#tab=details`), plain `#…` links that change it, and listening for `hashchange` in your own code.                                                          |
| [Counters](./Counters.svelte)       | Several instances of one model under their own prefixes (`?left_count=2&right_count=1`), a prefix getter that moves a parameter when it changes, and `url.key` following it.                 |

For every configuration, one at a time, see the
[configuration reference](./CONFIGURATION.md): each option written out as you
would write it, with a test of its effect (generated from
[Configuration.svelte](./Configuration.svelte)).

[Workbench](./Workbench.svelte) is a stress test: a code playground with
three multi-kilobyte files, forty feature flags, sliders, selects, radios,
dates, colors, a spreadsheet grid and a todo list, every bit of it in the URL
(its state is in [workbench.svelte.ts](./workbench.svelte.ts)). Its tests change
every kind of control and rebuild the app from nothing but the URL, and show
how long the URL gets with the files in the query, and in the hash.
[stress.test.ts](./stress.test.ts) checks that the library's costs stay in step
with the browser's own as the number of parameters grows.

[`../App.svelte`](../App.svelte) and [`../Child.svelte`](../Child.svelte) are
the original demo, and test the same behaviors through it.

To see them in a browser, run `npm run dev` and open the dev server: its
front page lists every snippet, and each is a page of its own
(`/vests/src/examples/Pagination/pages`), running its test live. To run them
all, `npx vitest run --project sweater-vest`.
