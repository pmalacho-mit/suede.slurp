<script lang="ts">
  /*
   * A stress test: a code playground with many kinds of controls, and every
   * bit of its state (three multi-kilobyte files included) in the URL. Its
   * tests change everything, then rebuild the whole app from the URL alone.
   */
  import { untrack } from "svelte";
  import type { URLPart } from "../../release/handlers";
  import type Self from "./Workbench.svelte";
  import type {
    Test,
    Widen,
  } from "../../suede.sweater-vest/dsl.import.meta.vitest";
  import {
    Editor,
    Project,
    createFlags,
    flagNames,
    fonts,
    languages,
    lintRules,
    panels,
    themes,
  } from "./workbench.svelte";
  import { visit } from "./support";

  let { code = "query" }: { code?: URLPart } = $props();

  const project = new Project(untrack(() => code));
  const editor = new Editor();
  const { flags } = createFlags();

  /** Everything the app shows, as plain data. */
  export const snapshot = () =>
    $state.snapshot({
      project: {
        name: project.name,
        description: project.description,
        rating: project.rating,
        due: project.due,
        accent: project.accent,
        tags: project.tags,
        rules: project.rules,
        files: project.files,
        active: project.active,
        panel: project.panel,
        grid: project.grid,
        todos: project.todos,
      },
      editor: {
        fontSize: editor.fontSize,
        tabSize: editor.tabSize,
        wordWrap: editor.wordWrap,
        lineNumbers: editor.lineNumbers,
        minimap: editor.minimap,
        theme: editor.theme,
        font: editor.font,
      },
      flags,
    });

  const file = $derived(project.files[project.active]);
  let draft = $state("");
  let length = $state({ query: 0, hash: 0 });
  $effect(() => {
    const measure = () =>
      (length = { query: location.search.length, hash: location.hash.length });
    measure();
    const timer = setInterval(measure, 250);
    return () => clearInterval(timer);
  });
</script>

<div class="workbench" style:--accent={project.accent}>
  <aside>
    <label>Project <input bind:value={project.name} /></label>
    <label>
      Description
      <textarea rows="3" bind:value={project.description}></textarea>
    </label>
    <fieldset>
      <legend>Rating</legend>
      {#each [1, 2, 3, 4, 5] as stars}
        <label>
          <input type="radio" value={stars} bind:group={project.rating} />
          {stars} stars
        </label>
      {/each}
    </fieldset>
    <label>Due <input type="date" bind:value={project.due} /></label>
    <label>Accent <input type="color" bind:value={project.accent} /></label>
    <label>
      Tags
      <input
        value={project.tags.join(", ")}
        onchange={(e) =>
          (project.tags = e.currentTarget.value
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean))}
      />
    </label>
    <fieldset>
      <legend>Lint rules</legend>
      {#each lintRules as rule}
        <label>
          <input type="checkbox" value={rule} bind:group={project.rules} />
          {rule}
        </label>
      {/each}
    </fieldset>
    <fieldset class="flags">
      <legend>Feature flags</legend>
      {#each flagNames as name}
        <label>
          <input type="checkbox" bind:checked={flags[name]} />
          {name}
        </label>
      {/each}
    </fieldset>
  </aside>

  <main>
    <nav aria-label="Panels">
      {#each panels as panel}
        <button
          aria-pressed={project.panel === panel}
          onclick={() => (project.panel = panel)}>{panel}</button
        >
      {/each}
    </nav>

    {#if project.panel === "code"}
      <div role="tablist" aria-label="Files">
        {#each project.files as each, index}
          <button
            role="tab"
            aria-selected={project.active === index}
            onclick={() => (project.active = index)}>{each.name}</button
          >
        {/each}
        <button
          onclick={() => {
            project.files.push({
              name: `file${project.files.length + 1}.ts`,
              language: "ts",
              code: "",
            });
            project.active = project.files.length - 1;
          }}>New file</button
        >
      </div>
      {#if file}
        <label>File name <input bind:value={file.name} /></label>
        <label>
          Language
          <select bind:value={file.language}>
            {#each languages as language}<option>{language}</option>{/each}
          </select>
        </label>
        <textarea
          aria-label="Code"
          class="code"
          spellcheck="false"
          rows="20"
          bind:value={file.code}
          style:font-size="{editor.fontSize}px"
          style:font-family={editor.font}
          style:tab-size={editor.tabSize}
          style:white-space={editor.wordWrap ? "pre-wrap" : "pre"}
        ></textarea>
      {/if}
    {:else if project.panel === "grid"}
      <table>
        <tbody>
          {#each project.grid as row, r}
            <tr>
              {#each row as _, c}
                <td>
                  <input
                    type="number"
                    aria-label="Cell {r + 1},{c + 1}"
                    bind:value={project.grid[r][c]}
                  />
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      <p>Total: {project.grid.flat().reduce((sum, cell) => sum + cell, 0)}</p>
    {:else}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) project.todos.push({ text: draft, done: false });
          draft = "";
        }}
      >
        <input aria-label="New todo" bind:value={draft} />
        <button>Add todo</button>
      </form>
      <ul>
        {#each project.todos as todo}
          <li>
            <label>
              <input type="checkbox" bind:checked={todo.done} />
              {todo.text}
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </main>

  <section aria-label="Editor settings">
    <label>
      Font size
      <input type="range" min="8" max="32" bind:value={editor.fontSize} />
    </label>
    <label>
      Tab size
      <select bind:value={editor.tabSize}>
        {#each [2, 4, 8] as size}<option value={size}>{size}</option>{/each}
      </select>
    </label>
    <label
      ><input type="checkbox" bind:checked={editor.wordWrap} /> Word wrap</label
    >
    <label>
      <input type="checkbox" bind:checked={editor.lineNumbers} /> Line numbers
    </label>
    <label
      ><input type="checkbox" bind:checked={editor.minimap} /> Minimap</label
    >
    <fieldset>
      <legend>Theme</legend>
      {#each themes as theme}
        <label>
          <input type="radio" value={theme} bind:group={editor.theme} />
          {theme}
        </label>
      {/each}
    </fieldset>
    <label>
      Font
      <select bind:value={editor.font}>
        {#each fonts as font}<option>{font}</option>{/each}
      </select>
    </label>
  </section>

  <footer>
    URL: {length.query} characters of query, {length.hash} of hash
  </footer>
</div>

<!-- Change every kind of control, then rebuild the app from nothing but the URL: everything comes back. -->
{#snippet tracksEverything(
  Workbench: typeof Self,
  pocket: { shown: Widen<true>; bench: Self },
  test: Test,
)}
  {#if pocket.shown}<Workbench bind:this={pocket.bench} />{/if}
  {test(async ({ expect, user, screen, fireEvent, flushSync }) => {
    const field = (name: string) =>
      screen.getByLabelText<HTMLInputElement>(name);
    await user.clear(field("Project"));
    await user.type(field("Project"), "stress-app");
    await user.type(field("Description"), " Now with more.");
    await user.click(screen.getByLabelText("2 stars"));
    await fireEvent.input(field("Due"), { target: { value: "2027-01-15" } });
    await fireEvent.input(field("Accent"), { target: { value: "#ff8800" } });
    await fireEvent.change(field("Tags"), { target: { value: "a, b, c" } });
    await user.click(screen.getByLabelText("curly"));
    await user.click(screen.getByLabelText("feature02"));
    await user.click(screen.getByLabelText("feature05"));
    await fireEvent.input(field("Font size"), { target: { value: "18" } });
    await user.selectOptions(field("Tab size"), "4");
    await user.click(screen.getByLabelText("solarized"));
    await user.click(screen.getByLabelText("Minimap"));
    await user.selectOptions(field("Font"), "Menlo");

    await user.click(screen.getByRole("tab", { name: "App.svelte" }));
    await user.type(field("Code"), "<!-- edited -->");
    await user.click(screen.getByRole("button", { name: "New file" }));
    await user.type(field("Code"), "export const answer = 42;");
    await user.clear(field("File name"));
    await user.type(field("File name"), "answer.ts");

    await user.click(screen.getByRole("button", { name: "grid" }));
    await user.clear(field("Cell 3,4"));
    await user.type(field("Cell 3,4"), "99");
    await user.click(screen.getByRole("button", { name: "todos" }));
    await user.type(field("New todo"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Add todo" }));
    await user.click(screen.getByLabelText("Add undo"));

    // let the debounced parameters (description, files) be written
    await new Promise((resolve) => setTimeout(resolve, 600));
    const before = pocket.bench.snapshot();
    expect(before.project.files).toHaveLength(4);
    expect(before.project.grid[2][3]).toBe(99);
    const href = location.href;

    pocket.shown = false;
    flushSync();
    expect(location.search).toBe("");
    visit(href);
    pocket.shown = true;
    flushSync();
    expect(pocket.bench.snapshot()).toEqual(before);
  })}
{/snippet}

<!-- One click that adds a file and opens it is one history entry: back undoes all of it. An edit still waiting to be written when back is pressed is dropped. -->
{#snippet backUndoesOneAction(
  Workbench: typeof Self,
  pocket: { bench: Self },
  test: Test,
)}
  <Workbench bind:this={pocket.bench} />
  {test(async ({ expect, user, screen }) => {
    const seen = () => {
      const { active, files, description } = pocket.bench.snapshot().project;
      return { active, files: files.length, description };
    };
    const go = (direction: "back" | "forward") => {
      const popped = new Promise((resolve) =>
        addEventListener("popstate", resolve, { once: true }),
      );
      history[direction]();
      return popped;
    };
    const { description } = seen();
    const entries = history.length;

    await user.click(screen.getByRole("button", { name: "New file" }));
    expect(history.length).toBe(entries + 1);
    expect(seen()).toEqual({ active: 3, files: 4, description });
    await go("back");
    expect(seen()).toEqual({ active: 0, files: 3, description });
    await go("forward");
    expect(seen()).toEqual({ active: 3, files: 4, description });

    await user.type(screen.getByLabelText("Description"), " Edited.");
    await go("back");
    expect(seen()).toEqual({ active: 0, files: 3, description });
    // past the description's debounce: the dropped edit is never written
    await new Promise((resolve) => setTimeout(resolve, 600));
    await go("forward");
    expect(seen()).toEqual({ active: 3, files: 4, description });
  })}
{/snippet}

<!-- With the files in the query, the URL is long: past what many servers accept in a request line. -->
{#snippet longQuery(Workbench: typeof Self, test: Test)}
  <Workbench />
  {test(async ({ expect }) => {
    expect(location.search.length).toBeGreaterThan(8_000);
  })}
{/snippet}

<!-- With code: "hash", the files go in the hash, which is never sent to a server, and the query stays short. -->
{#snippet filesInHash(Workbench: typeof Self, test: Test)}
  <Workbench code="hash" />
  {test(async ({ expect }) => {
    expect(location.search.length).toBeLessThan(2_000);
    expect(location.hash.length).toBeGreaterThan(6_000);
  })}
{/snippet}

<style>
  .workbench {
    display: grid;
    grid-template-columns: 16rem 1fr 14rem;
    gap: 1rem;
    font-family: system-ui, sans-serif;
  }
  .flags {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    font-size: 0.8rem;
  }
  .code {
    width: 100%;
  }
  footer {
    grid-column: 1 / -1;
    color: var(--accent);
  }
  table input {
    width: 4rem;
  }
</style>
