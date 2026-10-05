// The state of the Workbench example (./Workbench.svelte): a code playground
// with many kinds of controls, every one of them kept in the URL.
import { onDestroy } from "svelte";
import { URLParameterize } from "../../release";
import type { URLPart } from "../../release/handlers";
import { count, flag, text } from "./support";

export type Language = "ts" | "svelte" | "css";
export type CodeFile = { name: string; language: Language; code: string };
export type Todo = { text: string; done: boolean };
export type Panel = "code" | "grid" | "todos";
export type Theme = "light" | "dark" | "solarized";

export const languages: Language[] = ["ts", "svelte", "css"];
export const panels: Panel[] = ["code", "grid", "todos"];
export const themes: Theme[] = ["light", "dark", "solarized"];
export const fonts = ["JetBrains Mono", "Fira Code", "IBM Plex Mono", "Menlo"];
export const lintRules = [
  "no-unused-vars",
  "no-console",
  "eqeqeq",
  "prefer-const",
  "no-var",
  "curly",
  "no-shadow",
  "max-depth",
];
export const flagNames = Array.from(
  { length: 40 },
  (_, index) => `feature${String(index + 1).padStart(2, "0")}`,
);

const store = `import { writable, derived, type Readable } from "svelte/store";

export type Todo = { id: number; text: string; done: boolean; tags: string[] };
export type Filter = "all" | "active" | "done";

let nextId = 1;

/** A todo list with filtering, undo, and persistence to localStorage. */
export function createTodos(initial: Todo[] = []) {
  const todos = writable<Todo[]>(initial);
  const filter = writable<Filter>("all");
  const history: Todo[][] = [];

  const visible: Readable<Todo[]> = derived([todos, filter], ([$todos, $filter]) =>
    $filter === "all"
      ? $todos
      : $todos.filter((todo) => ($filter === "done" ? todo.done : !todo.done)),
  );

  const remaining = derived(todos, ($todos) => $todos.filter((t) => !t.done).length);

  function update(change: (todos: Todo[]) => Todo[]) {
    todos.update((current) => {
      history.push(current);
      if (history.length > 50) history.shift();
      return change(current);
    });
  }

  return {
    subscribe: visible.subscribe,
    filter,
    remaining,
    add(text: string, tags: string[] = []) {
      const trimmed = text.trim();
      if (!trimmed) return;
      update((all) => [...all, { id: nextId++, text: trimmed, done: false, tags }]);
    },
    toggle(id: number) {
      update((all) => all.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    },
    remove(id: number) {
      update((all) => all.filter((t) => t.id !== id));
    },
    clearDone() {
      update((all) => all.filter((t) => !t.done));
    },
    undo() {
      const previous = history.pop();
      if (previous) todos.set(previous);
    },
    persist(key = "todos") {
      return todos.subscribe((all) => localStorage.setItem(key, JSON.stringify(all)));
    },
  };
}
`;

const component = `<script lang="ts">
  import { createTodos, type Filter } from "./store";

  const todos = createTodos();
  const { filter, remaining } = todos;
  let draft = $state("");
  const filters: Filter[] = ["all", "active", "done"];

  function submit(event: SubmitEvent) {
    event.preventDefault();
    todos.add(draft, draft.match(/#\\w+/g) ?? []);
    draft = "";
  }
</script>

<main>
  <header>
    <h1>Todos <small>{$remaining} left</small></h1>
    <form onsubmit={submit}>
      <input bind:value={draft} placeholder="What needs doing? (#tags work)" />
      <button disabled={!draft.trim()}>Add</button>
    </form>
  </header>

  <nav>
    {#each filters as option}
      <button class:active={$filter === option} onclick={() => filter.set(option)}>
        {option}
      </button>
    {/each}
    <button onclick={todos.undo}>Undo</button>
    <button onclick={todos.clearDone}>Clear done</button>
  </nav>

  <ul>
    {#each $todos as todo (todo.id)}
      <li class:done={todo.done}>
        <input type="checkbox" checked={todo.done} onchange={() => todos.toggle(todo.id)} />
        <span>{todo.text}</span>
        {#each todo.tags as tag}<em>{tag}</em>{/each}
        <button aria-label="Remove" onclick={() => todos.remove(todo.id)}>×</button>
      </li>
    {:else}
      <li class="empty">Nothing here.</li>
    {/each}
  </ul>
</main>
`;

const stylesheet = `:root {
  --bg: #f6f7f9;
  --fg: #1d2127;
  --muted: #69707a;
  --accent: #3f6ad8;
  --danger: #c2412d;
  --radius: 6px;
  --gap: 0.75rem;
  font-family: "Inter", system-ui, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15181c;
    --fg: #e4e7eb;
    --muted: #8f97a1;
    --accent: #7b9cf0;
  }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
}

main {
  max-width: 40rem;
  margin: 3rem auto;
  padding-inline: 1rem;
  display: grid;
  gap: var(--gap);
}

form {
  display: flex;
  gap: var(--gap);
}

input:not([type="checkbox"]) {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--muted) 40%, transparent);
  border-radius: var(--radius);
}

button {
  padding: 0.5rem 0.9rem;
  border-radius: var(--radius);
  border: 0;
  background: var(--accent);
  color: white;
  cursor: pointer;
}

button.active {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

li.done span {
  text-decoration: line-through;
  color: var(--muted);
}

li.empty {
  color: var(--muted);
  font-style: italic;
}
`;

export const sampleFiles: CodeFile[] = [
  { name: "store.ts", language: "ts", code: store },
  { name: "App.svelte", language: "svelte", code: component },
  { name: "theme.css", language: "css", code: stylesheet },
];

// Resolvers: whatever is in the URL, a value of the right shape.
const oneOf =
  <T extends string>(options: readonly T[], fallback: T) =>
  (query: unknown): T =>
    options.includes(query as T) ? (query as T) : fallback;

const between =
  (min: number, max: number, fallback: number) => (query: unknown) =>
    typeof query === "number" && query >= min && query <= max
      ? query
      : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const codeFile = (query: unknown): CodeFile =>
  isRecord(query)
    ? {
        name: text(query.name) || "untitled.ts",
        language: oneOf(languages, "ts")(query.language),
        code: text(query.code),
      }
    : { name: "untitled.ts", language: "ts", code: "" };

const todo = (query: unknown): Todo =>
  isRecord(query)
    ? { text: text(query.text), done: flag(query.done) }
    : { text: "", done: false };

const grid = (query: unknown): number[][] =>
  Array.isArray(query)
    ? query.map((row) =>
        Array.isArray(row) ? row.map((cell) => count(cell)) : [],
      )
    : emptyGrid();

const emptyGrid = () =>
  Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 6 }, (_, column) => (row + 1) * (column + 1)),
  );

const plain = {
  serialize: (value: string) => value,
  deserialize: (value: string) => value,
};

/** The project: its files, notes and lists. */
export class Project {
  name = $state("todo-app");
  description = $state(
    "A todo list with filters, tags and undo, built to try out stores.",
  );
  rating = $state(4);
  due = $state("2026-11-01");
  accent = $state("#3f6ad8");
  tags = $state<string[]>(["svelte", "stores"]);
  rules = $state<string[]>(["no-unused-vars", "eqeqeq", "prefer-const"]);
  files = $state<CodeFile[]>(structuredClone(sampleFiles));
  active = $state(0);
  panel = $state<Panel>("code");
  grid = $state<number[][]>(emptyGrid());
  todos = $state<Todo[]>([
    { text: "Write the store", done: true },
    { text: "Add undo", done: false },
  ]);

  readonly url;

  /** `code` is where the files are kept: the query, or the hash. */
  constructor(code: URLPart = "query") {
    this.url = URLParameterize<Project>(
      this,
      {
        name: { ...plain, resolve: text },
        description: {
          ...plain,
          resolve: text,
          debounce: { idleMs: 300, maxWaitMs: 1500 },
        },
        rating: between(1, 5, 3),
        due: {
          ...plain,
          resolve: (query) =>
            typeof query === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query)
              ? query
              : "",
        },
        accent: {
          ...plain,
          resolve: (query) =>
            typeof query === "string" && /^#[0-9a-f]{6}$/i.test(query)
              ? query
              : "#3f6ad8",
        },
        tags: { ...plain, entries: "multiple", resolve: text },
        rules: {
          ...plain,
          entries: "multiple",
          resolve: oneOf(lintRules, lintRules[0]),
        },
        files: {
          entries: "multiple",
          resolve: codeFile,
          in: code,
          debounce: { idleMs: 400, maxWaitMs: 2000 },
        },
        active: { resolve: between(0, 99, 0), in: "hash" },
        panel: { ...plain, resolve: oneOf(panels, "code"), in: "hash" },
        grid,
        todos: { entries: "multiple", resolve: todo },
      },
      { onDestroy },
    );
  }
}

/** How the editor looks: settings, not navigation, so they replace history. */
export class Editor {
  fontSize = $state(14);
  tabSize = $state(2);
  wordWrap = $state(true);
  lineNumbers = $state(true);
  minimap = $state(false);
  theme = $state<Theme>("dark");
  font = $state(fonts[0]);

  readonly url = URLParameterize<Editor>(
    this,
    {
      fontSize: between(8, 32, 14),
      tabSize: between(1, 8, 2),
      wordWrap: flag,
      lineNumbers: flag,
      minimap: flag,
      theme: { ...plain, resolve: oneOf(themes, "dark") },
      font: { ...plain, resolve: oneOf(fonts, fonts[0]) },
    },
    { prefix: "editor_", history: "replace", onDestroy },
  );
}

/** Feature flags: forty separate parameters. */
export const createFlags = () => {
  const flags = $state<Record<string, boolean>>(
    Object.fromEntries(flagNames.map((name, index) => [name, index % 3 === 0])),
  );
  const url = URLParameterize(
    flags,
    Object.fromEntries(flagNames.map((name) => [name, flag])),
    { prefix: "flag_", history: "replace", onDestroy },
  );
  return { flags, url };
};
