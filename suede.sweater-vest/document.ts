import path from "node:path";
import MagicString from "magic-string";
import ts from "@typescript/typescript6";
import { parse } from "svelte/compiler";

import {
  type Analysis,
  type Import,
  type TestSnippet,
  hasTest,
  isDslModule,
} from "./vite-plugin/analyze.ts";
import { importPath, stemOf } from "./vite-plugin/names.ts";

/**
 * A snippet, as documentation: the usage a reader would write — a component
 * with the snippet's markup and plain `$state` where the pocket was — and,
 * under "Verified by", the body of its test. Every rewrite is on the AST; the
 * result is as small as the snippet allows, with only the imports it reaches.
 */

/** A pocket's members with the values its type gave them, printed. */
export type PocketMembers = Map<string, [member: string, value: string][]>;

export type DocumentOptions = {
  /** Absolute path of the components index, for `typeof Sweater.<Component>` parameters. */
  components: string;
  /** Printed initial values by pocket parameter name, each member on its own. */
  pockets: PocketMembers;
};

export type Documented = {
  name: string;
  snippet: string;
  /** the comment just above the snippet */
  description: string | null;
  /** a Svelte component: the usage */
  usage: string;
  /** the test body, when the snippet has a test */
  verifiedBy: string | null;
};

type Node = { type: string; start?: number; end?: number } & Record<
  string,
  unknown
>;

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && typeof (v as Node).type === "string";

const SKIP = new Set([
  "loc",
  "metadata",
  "leadingComments",
  "trailingComments",
]);

// TypeScript nodes that wrap a run-time expression — `x as T`, `x!`, `<T>x`, `x satisfies T`,
// `f<T>`: the expression is code, only the type beside it (itself a TS node) is not
const TS_EXPRESSIONS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

const isType = (node: Node) =>
  node.type.startsWith("TS") && !TS_EXPRESSIONS.has(node.type);

// every node under `node`, depth first; `types` says whether to descend into TypeScript types,
// `skip` holds subtrees that are not part of the result and so count for nothing
function* walk(
  node: Node,
  parent: Node | null = null,
  key = "",
  types = false,
  skip: Set<Node> = new Set(),
): Generator<[Node, Node | null, string]> {
  if (skip.has(node) || (!types && isType(node))) return;
  yield [node, parent, key];
  for (const [k, value] of Object.entries(node)) {
    if (SKIP.has(k)) continue;
    if (Array.isArray(value)) {
      for (const item of value)
        if (isNode(item)) yield* walk(item, node, k, types, skip);
    } else if (isNode(value)) yield* walk(value, node, k, types, skip);
  }
}

const isReference = (node: Node, parent: Node | null, key: string) =>
  node.type === "Identifier" &&
  !(
    parent?.type === "MemberExpression" &&
    key === "property" &&
    !parent.computed
  ) &&
  !(parent?.type === "Property" && key === "key" && !parent.computed);

const refers = (node: Node, name: string) => {
  for (const [n, parent, key] of walk(node))
    if (isReference(n, parent, key) && n.name === name) return true;
  return false;
};

// a component is used by name: `<Status />` carries it as a string, not an identifier
const uses = (body: Node[], name: string, skip: Set<Node>) => {
  for (const node of body)
    for (const [n] of walk(node, null, "", false, skip))
      if (
        n.type === "Component" &&
        (n.name === name || (n.name as string).startsWith(`${name}.`))
      )
        return true;
  return false;
};

// the names a type text refers to: what a pocket member's type needs imported
const namesInType = (typeText: string, into: Set<string>) => {
  const sf = ts.createSourceFile(
    "t.ts",
    `type T = ${typeText};`,
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (n: ts.Node) => {
    if (ts.isTypeReferenceNode(n))
      into.add(
        ts.isIdentifier(n.typeName)
          ? n.typeName.text
          : n.typeName.getText(sf).split(".")[0]!,
      );
    if (ts.isTypeQueryNode(n)) into.add(n.exprName.getText(sf).split(".")[0]!);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return into;
};

/** The names a tree refers to, types included: what an import has to answer for. */
const namesIn = (node: Node, skip: Set<Node>, into = new Set<string>()) => {
  for (const [n, parent, key] of walk(node, null, "", true, skip))
    if (n.type === "Identifier" && isReference(n, parent, key))
      into.add(n.name as string);
    // a component tag names its root too
    else if (n.type === "Component")
      into.add((n.name as string).split(".")[0]!);
  return into;
};

const snippetNode = (source: string, snippet: TestSnippet): Node => {
  const ast = parse(source, { modern: true }) as unknown as {
    fragment: { nodes: Node[] };
  };
  const node = ast.fragment.nodes.find(
    (n) => n.type === "SnippetBlock" && n.start === snippet.start,
  );
  if (!node) throw new Error(`no snippet at ${snippet.start}`);
  return node;
};

const dedent = (text: string) => {
  const lines = text
    .replace(/^\s*\n/, "")
    .replace(/\s+$/, "")
    .split("\n");
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length),
  );
  return lines.map((l) => l.slice(indent)).join("\n");
};

// the test call `{test(async (payload) => { … })}`: the tag, and the body inside the braces
function testCall(
  body: Node[],
  test: string,
): { tag: Node; body: { start: number; end: number } } | null {
  for (const tag of body) {
    if (tag.type !== "ExpressionTag") continue;
    const call = tag.expression as Node;
    if (call.type !== "CallExpression" || (call.callee as Node).name !== test)
      continue;
    const fn = (call.arguments as Node[])[0];
    if (!fn) continue;
    const fnBody = fn.body as Node;
    const inner =
      fnBody.type === "BlockStatement"
        ? { start: fnBody.start! + 1, end: fnBody.end! - 1 }
        : { start: fnBody.start!, end: fnBody.end! };
    return { tag, body: inner };
  }
  return null;
}

// a node that is there to show the test — an element given `test`, a tag reading it — is not usage
function* testDisplay(
  body: Node[],
  test: string,
  subject: string,
): Generator<Node> {
  for (const node of body) {
    if (
      node.type === "ExpressionTag" ||
      node.type === "IfBlock" ||
      node.type === "EachBlock"
    ) {
      if (refers(node, test)) yield node;
      continue;
    }
    const attributes = (node.attributes as Node[] | undefined) ?? [];
    // the subject given `test` is usage itself
    if (node.name !== subject && attributes.some((a) => refers(a, test))) {
      yield node;
      continue;
    }
    const children =
      (node.fragment as { nodes?: Node[] } | undefined)?.nodes ?? [];
    const shown = children.filter(
      (c) => c.type !== "Text" || (c.data as string).trim(),
    );
    if (
      shown.length &&
      shown.every(
        (c) =>
          c.type !== "Text" &&
          refers(c, test) &&
          !uses([c], subject, new Set()),
      )
    )
      yield node;
    else yield* testDisplay(children, test, subject);
  }
}

// the members of a pocket's type, as written: name, type text, optional
const membersOf = (typeText: string) => {
  const sf = ts.createSourceFile(
    "p.ts",
    `type P = ${typeText};`,
    ts.ScriptTarget.Latest,
    true,
  );
  const alias = sf.statements[0] as ts.TypeAliasDeclaration;
  if (!ts.isTypeLiteralNode(alias.type)) return [];
  return alias.type.members.flatMap((m) =>
    ts.isPropertySignature(m) && m.type
      ? [
          {
            name: m.name.getText(sf),
            type: m.type.getText(sf),
            optional: !!m.questionToken,
          },
        ]
      : [],
  );
};

const classesIn = (snippet: Node) => {
  const names = new Set<string>();
  for (const [n] of walk(snippet)) {
    if (n.type === "ClassDirective") names.add(n.name as string);
    if (n.type === "Attribute" && n.name === "class" && Array.isArray(n.value))
      for (const part of n.value as Node[])
        if (part.type === "Text")
          (part.data as string).split(/\s+/).forEach((c) => c && names.add(c));
  }
  return names;
};

const classesStyled = (source: string): Set<string> => {
  const ast = parse(source, { modern: true }) as unknown as {
    css: Node | null;
  };
  const names = new Set<string>();
  if (ast.css)
    for (const [n] of walk(ast.css))
      if (n.type === "ClassSelector") names.add(n.name as string);
  return names;
};

const quote = (s: string) => JSON.stringify(s);

const printImport = (
  i: Import,
  keep: Set<string>,
  asValue: Map<string, string>,
): string | null => {
  // a value parameter's binding is imported under the parameter's name
  const name = (b: { local: string }) => asValue.get(b.local) ?? b.local;
  const def = i.bindings.find((b) => b.kind === "default" && keep.has(name(b)));
  const named = i.bindings.filter(
    (b) => b.kind === "named" && keep.has(name(b)),
  );
  const ns = i.bindings.find(
    (b) => b.kind === "namespace" && keep.has(name(b)),
  );
  if (!def && !named.length && !ns) return null;
  const typeOnly = [def, ...named, ns]
    .filter(Boolean)
    .every((b) => b!.typeOnly && !asValue.has(b!.local));
  const parts = [
    def && name(def),
    ns ? `* as ${name(ns)}` : null,
    named.length
      ? `{ ${named.map((b) => (!typeOnly && b.typeOnly && !asValue.has(b.local) ? "type " : "") + (b.kind === "named" && b.imported !== name(b) ? `${b.imported} as ${name(b)}` : name(b))).join(", ")} }`
      : null,
  ].filter(Boolean);
  return `import ${typeOnly ? "type " : ""}${parts.join(", ")} from ${quote(i.specifier)};`;
};

/** One snippet as documentation. */
export function document(
  analysis: Analysis,
  snippet: TestSnippet,
  options: DocumentOptions,
): Documented {
  const { file, source } = analysis;
  const node = snippetNode(source, snippet);
  // the comment just above the snippet describes it, unless it is a directive
  const above = source.slice(0, snippet.start).trimEnd();
  const comment = above.endsWith("-->")
    ? above.slice(above.lastIndexOf("<!--") + 4, -3).trim()
    : "";
  const description =
    comment && !comment.startsWith("svelte-ignore") ? comment : null;
  const body = (node.body as { nodes: Node[] }).nodes;
  const subject = snippet.params.find((p) => p.kind === "subject")!;
  const test = snippet.params.find((p) => p.kind === "test")?.name ?? null;
  const pockets = snippet.params.filter((p) => p.kind === "pocket");
  const s = new MagicString(source);
  const fragment = { type: "Fragment", nodes: body } as Node;

  // the test, and what only shows it, leave the usage: nothing in them counts
  const call = test ? testCall(body, test) : null;
  const removed = new Set<Node>(
    test ? testDisplay(body, test, subject.name) : [],
  );
  if (call) removed.add(call.tag);

  // what the usage keeps: everything the markup reads, and what the pockets' types name
  const referenced = namesIn(fragment, removed);
  for (const p of pockets)
    if (p.kind === "pocket") namesInType(p.typeText, referenced);

  // `pocket.member` becomes `member`, unless the pocket is also handed around whole,
  // or a member would take a name the snippet already gives something else
  const named = new Set<string>();
  for (const [n, parent, key] of walk(node))
    if (isReference(n, parent, key)) named.add(n.name as string);
  const whole = new Set<string>();
  for (const p of pockets) {
    if (
      p.kind === "pocket" &&
      membersOf(p.typeText).some((m) => named.has(m.name))
    )
      whole.add(p.name);
    for (const [n, parent, key] of walk(fragment))
      if (
        isReference(n, parent, key) &&
        n.name === p.name &&
        !(parent?.type === "MemberExpression" && key === "object")
      )
        whole.add(p.name);
    if (whole.has(p.name)) continue;
    for (const [n] of walk(node))
      if (
        n.type === "MemberExpression" &&
        !n.computed &&
        (n.object as Node).name === p.name &&
        (n.object as Node).type === "Identifier"
      )
        s.overwrite(n.start!, n.end!, (n.property as Node).name as string);
  }

  const verifiedBy = call
    ? dedent(s.slice(call.body.start, call.body.end))
    : null;
  for (const shown of removed) s.remove(shown.start!, shown.end!);

  // a top-level `{@const}` is only valid in a block: it moves to the script, derived when it reads the test, a pocket or a derived const
  const hoisted: string[] = [];
  const derived = [test, ...pockets.map((p) => p.name)];
  for (const c of body.filter((n) => n.type === "ConstTag")) {
    const d = c.declaration as Node;
    const init = (d.declarations as Node[])[0]!.init as Node;
    const value = s.slice(init.start!, init.end!);
    const reads = derived.some((n) => n && refers(init, n));
    if (reads)
      derived.push(((d.declarations as Node[])[0]!.id as Node).name as string);
    hoisted.push(
      `${s.slice(d.start!, init.start!)}${reads ? `$derived(${value})` : value};`,
    );
    s.remove(c.start!, c.end!);
  }

  const first = body[0]!.start!;
  const last = body[body.length - 1]!.end!;
  const markup = dedent(s.slice(first, last));

  // the script: imports the usage reaches, then the pocket as state
  const asValue = new Map<string, string>([[subject.name, subject.name]]);
  const keep = new Set<string>([...referenced]);
  keep.delete(analysis.self!);
  const lines: string[] = [
    `import ${subject.name} from ${quote(`./${path.basename(file)}`)};`,
  ];
  for (const p of snippet.params)
    if (p.kind === "value") asValue.set(p.local, p.name);
  // the subject still given the test: the usage is handed it too
  const dsl =
    test && keep.has(test)
      ? analysis.imports.find((i) => isDslModule(i.specifier))
      : undefined;
  if (dsl) lines.push(`import type { Test } from ${quote(dsl.specifier)};`);
  for (const i of analysis.imports) {
    // the DSL names nothing a reader writes, and the component's own type import is now the component
    if (
      isDslModule(i.specifier) ||
      i.bindings.some((b) => b.local === analysis.self)
    )
      continue;
    const printed = printImport(i, keep, asValue);
    if (printed) lines.push(printed);
  }
  const sweaters = snippet.params.filter(
    (p) => p.kind === "sweater" && uses(body, p.name, removed),
  );
  if (sweaters.length) {
    // the index's directory when there is one to name; beside it, the index itself
    const index = importPath(file, options.components);
    const dir = path.posix.dirname(index);
    const spec =
      path.posix.basename(index) === "index.ts" && dir !== "." ? dir : index;
    lines.push(
      `import { ${sweaters.map((p) => (p.kind === "sweater" ? (p.member === p.name ? p.name : `${p.member} as ${p.name}`) : "")).join(", ")} } from ${quote(spec)};`,
    );
  }
  const state: string[] = dsl
    ? [`let { ${test} }: { ${test}: Test } = $props();`]
    : [];
  for (const p of pockets) {
    if (p.kind !== "pocket") continue;
    const values = new Map(options.pockets.get(p.name) ?? []);
    const members = membersOf(p.typeText).map((m) => ({
      ...m,
      type: m.type.replace(
        new RegExp(`\\b${analysis.self}\\b`, "g"),
        subject.name,
      ),
    }));
    if (whole.has(p.name)) {
      // a member with no value to print keeps its type, as an empty start
      const entries = [
        ...members.map((m) =>
          values.has(m.name)
            ? `${m.name}: ${values.get(m.name)}`
            : `${m.name}: undefined as ${m.type} | undefined`,
        ),
        ...[...values]
          .filter(([k]) => !members.some((m) => m.name === k))
          .map(([k, v]) => `${k}: ${v}`),
      ];
      state.push(`let ${p.name} = $state({ ${entries.join(", ")} });`);
      continue;
    }
    for (const m of members) {
      const value = values.get(m.name);
      if (value !== undefined) state.push(`let ${m.name} = $state(${value});`);
      else state.push(`let ${m.name} = $state<${m.type}>();`);
    }
  }
  state.push(...hoisted);
  const styled = classesStyled(source);
  const css =
    analysis.css && [...classesIn(node)].some((c) => styled.has(c))
      ? `\n\n${source.slice(analysis.css.start, analysis.css.end)}`
      : "";
  const lang = analysis.instance?.lang ?? "ts";
  const script = [...lines, ...(state.length ? ["", ...state] : [])].join("\n");
  const usage = `<script lang="${lang}">\n${script.replace(/^(?!$)/gm, "  ")}\n</script>\n\n${markup}${css}\n`;

  return {
    name: `${stemOf(file)} > ${snippet.name}`,
    snippet: snippet.name,
    description,
    usage,
    verifiedBy: hasTest(snippet) ? verifiedBy : null,
  };
}

const fence = (lang: string, code: string) =>
  `\`\`\`${lang}\n${code.replace(/\n$/, "")}\n\`\`\``;

/** A snippet's section: its usage, then what verifies it. */
export const markdownOf = (doc: Documented, level: number): string =>
  [
    `${"#".repeat(level)} ${doc.snippet}`,
    "",
    ...(doc.description ? [doc.description, ""] : []),
    fence("svelte", doc.usage),
    ...(doc.verifiedBy
      ? ["", "Verified by:", "", fence("ts", doc.verifiedBy)]
      : []),
    "",
  ].join("\n");

/** A component's section: a heading, then every snippet one level below. */
export const markdownForComponent = (
  analysis: Analysis,
  docs: Documented[],
  level: number,
): string =>
  [
    `${"#".repeat(level)} ${stemOf(analysis.file)}`,
    "",
    ...docs.map((d) => markdownOf(d, level + 1)),
  ].join("\n");

import type {
  Expect,
  Invoke,
} from "../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";
import type {
  markdownFor,
  usageAmongComponentsOf,
  usageOf,
  verifiedByOf,
} from "./_internal/harness.ts";

declare namespace document {
  type Counter = `
{#snippet binds(Counter: typeof Self, Status: typeof Sweater.Status, pocket: { count: Widen<5>; el: HTMLDivElement }, test: Test)}
  <Status {test} />
  <p>{test.name}: {test.state}</p>
  <div bind:this={pocket.el}>
    <Counter bind:count={pocket.count} step={2} />
  </div>
  {test(async ({ expect, user }) => {
    pocket.count = 7;
    expect(pocket.el.textContent).toContain("7");
  })}
{/snippet}
`;

  type Usage = Invoke<
    typeof usageOf,
    [Counter, "binds", { pocket: { count: "5" } }]
  >;

  /** the component imported as the snippet named it; the DSL, the test, and what only shows it, gone */
  export type Reads = [
    Expect<
      Usage,
      "startsWith",
      '<script lang="ts">\n  import Counter from "./Probe.svelte";\n\n  let count = $state(5);\n  let el = $state<HTMLDivElement>();\n</script>'
    >,
    Expect<Usage, "includes", "<Counter bind:count={count} step={2} />">,
    Expect<Usage, "excludes", "dsl.import.meta.vitest">,
    Expect<Usage, "excludes", "Status">,
    Expect<Usage, "excludes", "test">,
  ];

  /** the body, with the pocket flattened like the markup */
  export type Verified = Expect<
    Invoke<typeof verifiedByOf, [Counter, "binds", { pocket: { count: "5" } }]>,
    "=",
    'count = 7;\nexpect(el.textContent).toContain("7");'
  >;

  type Example = `
{#snippet big(C: typeof Self, Grid: typeof Sweater.Grid, test: Test)}
  <Grid columns={2}><C /></Grid>
{/snippet}
`;

  type Only = `
{#snippet only(C: typeof Self)}
  <C />
{/snippet}
`;

  /** a library component is imported from the components index (by name, beside it); an example has no "Verified by" */
  export type Helpers = [
    Expect<
      Invoke<typeof usageOf, [Example, "big"]>,
      "includes",
      'import { Grid } from "../lib/components";'
    >,
    Expect<
      Invoke<typeof usageAmongComponentsOf, [Example, "big"]>,
      "includes",
      'import { Grid } from "./index.ts";'
    >,
    Expect<Invoke<typeof verifiedByOf, [Only, "only"]>, "is", null>,
    Expect<
      Invoke<typeof markdownFor, [Only, "only", 3]>,
      "startsWith",
      "### only\n\n```svelte\n"
    >,
    Expect<
      Invoke<typeof markdownFor, [Only, "only", 3]>,
      "excludes",
      "Verified by"
    >,
  ];

  type Whole = `
{#snippet whole(C: typeof Self, Inspect: typeof Sweater.Inspect, pocket: { n: 1 }, test: Test)}
  <C n={pocket.n} />
  <Inspect value={pocket} />
  {test(async () => {})}
{/snippet}
`;

  /** a pocket handed around whole stays an object */
  export type Kept = Expect<
    Invoke<typeof usageOf, [Whole, "whole", { pocket: { n: "1" } }]>,
    "includes",
    "let pocket = $state({ n: 1 });\n</script>\n\n<C n={pocket.n} />\n<Inspect value={pocket} />"
  >;

  type Cast = `
{#snippet cast(C: typeof Self, pocket: { el: HTMLDivElement; n: Widen<1> }, test: Test)}
  <div bind:this={pocket.el}><C n={pocket.n!} /></div>
  {test(async ({ expect }) => {
    const first = pocket.el.firstElementChild as HTMLElement;
    const shown = <HTMLElement>pocket.el;
    expect(first).toBe(shown.firstElementChild satisfies Element | null);
    expect(pocket.n!).toBe(1);
  })}
{/snippet}
`;

  /** a pocket member reached through `as`, `!`, `<T>` or `satisfies` flattens too; the type beside it is no reference */
  export type Wrapped = [
    Expect<
      Invoke<typeof verifiedByOf, [Cast, "cast", { pocket: { n: "1" } }]>,
      "=",
      "const first = el.firstElementChild as HTMLElement;\nconst shown = <HTMLElement>el;\nexpect(first).toBe(shown.firstElementChild satisfies Element | null);\nexpect(n!).toBe(1);"
    >,
    Expect<
      Invoke<typeof usageOf, [Cast, "cast", { pocket: { n: "1" } }]>,
      "includes",
      "let el = $state<HTMLDivElement>();\n  let n = $state(1);\n</script>\n\n<div bind:this={el}><C n={n!} /></div>"
    >,
  ];

  type Taken = `
{#snippet taken(C: typeof Self, pocket: { grid: HTMLDivElement }, test: Test)}
  <div bind:this={pocket.grid}><C /></div>
  {test(async ({ expect }) => {
    const grid = pocket.grid.firstElementChild as HTMLElement;
    expect(grid).toBeTruthy();
  })}
{/snippet}
`;

  /** a member whose name the snippet already gives something else leaves the pocket whole, typed */
  export type Collides = [
    Expect<
      Invoke<typeof verifiedByOf, [Taken, "taken"]>,
      "=",
      "const grid = pocket.grid.firstElementChild as HTMLElement;\nexpect(grid).toBeTruthy();"
    >,
    Expect<
      Invoke<typeof usageOf, [Taken, "taken"]>,
      "includes",
      "let pocket = $state({ grid: undefined as HTMLDivElement | undefined });\n</script>\n\n<div bind:this={pocket.grid}><C /></div>"
    >,
  ];

  type Aliased = `
{#snippet aliased(C: typeof Self, make: typeof createThing, Box: typeof Frame, test: Test)}
  <Box><C thing={make({} as Thing)} /></Box>
  {test(async () => {})}
{/snippet}
`;

  /** a value parameter is imported as a value, under the snippet's name for it; a type beside it stays a type */
  export type Renamed = Expect<
    Invoke<
      typeof usageOf,
      [
        Aliased,
        "aliased",
        {},
        'import type { createThing, Thing } from "./thing.ts";\nimport type Frame from "./Frame.svelte";',
      ]
    >,
    "startsWith",
    '<script lang="ts">\n  import C from "./Probe.svelte";\n  import { createThing as make, type Thing } from "./thing.ts";\n  import Box from "./Frame.svelte";\n</script>'
  >;

  type Hoist = `
{#snippet hoist(C: typeof Self, pocket: { n: Widen<1> }, test: Test)}
  {@const twice = pocket.n * 2}
  {@const four = twice * 2}
  {@const label = "n"}
  <C n={four} {label} />
  {test(async () => {})}
{/snippet}
`;

  /** a top-level `{@const}` moves to the script, after the state, derived when it reads the pocket or a derived const */
  export type Hoisted = Expect<
    Invoke<typeof usageOf, [Hoist, "hoist", { pocket: { n: "1" } }]>,
    "includes",
    'let n = $state(1);\n  const twice = $derived(n * 2);\n  const four = $derived(twice * 2);\n  const label = "n";\n</script>\n\n<C n={four} {label} />'
  >;

  type Given = `
{#snippet given(C: typeof Self, test: Test)}
  <div><C {test} /></div>
  {test(async () => {})}
{/snippet}
`;

  /** the subject given the test stays, wrapped or not, and the usage is handed the test */
  export type Subject = Expect<
    Invoke<typeof usageOf, [Given, "given"]>,
    "=",
    `<script lang="ts">
  import C from "./Probe.svelte";
  import type { Test } from "../lib/dsl.import.meta.vitest";

  let { test }: { test: Test } = $props();
</script>

<div><C {test} /></div>
`
  >;

  type Described = `
<!-- C, described -->
{#snippet described(C: typeof Self)}
  <C />
  <!-- inside, not the next one's -->
{/snippet}
<!-- svelte-ignore a11y_missing_attribute -->
{#snippet bare(C: typeof Self)}
  <C />
{/snippet}
`;

  /** the comment just above a snippet is its description; one inside the previous snippet, or a directive, is not */
  export type Describes = [
    Expect<
      Invoke<typeof markdownFor, [Described, "described", 3]>,
      "startsWith",
      "### described\n\nC, described\n\n```svelte\n"
    >,
    Expect<
      Invoke<typeof markdownFor, [Described, "bare", 3]>,
      "startsWith",
      "### bare\n\n```svelte\n"
    >,
  ];
}
