# Templates

Copies to make in your project so that every test snippet gets a page on your
dev server. The pages ask the running dev server for the list of snippets and
import each generated component from it; only the dev server answers, so a
page that stays in a production build shows nothing and ships no test.

## SvelteKit

Copy `sveltekit/vests/` into `src/routes/` and replace `<path>` in `+page.svelte`.
Then `/vests` lists every snippet and `/vests/<component>/<snippet>` renders one,
running its test live.

## Vite

Copy `vite/vests.html` to your project root and `vite/vests.ts` into `src/`,
replacing `<path>`. Then `/vests.html` lists every snippet and
`/vests.html#<component>/<snippet>` renders one.

In both, `<component>` is the component's path from the project root without
`.svelte`: `src/lib/Button.svelte` > `clicks` is at `src/lib/Button/clicks`.

