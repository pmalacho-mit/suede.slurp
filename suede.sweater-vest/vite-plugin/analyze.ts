import path from "node:path";
import { parse, type AST } from "svelte/compiler";

/**
 * What the plugin reads out of a component: its test snippets, their
 * parameters, and the imports they can reach. Everything here comes from the
 * Svelte parser's AST (with TypeScript annotations), never from the text.
 */

// a specifier may leave off the extension
export const DSL_FILE = "dsl.import.meta.vitest.ts";

export const isDslModule = (specifier: string): boolean => {
  const base = specifier.slice(specifier.lastIndexOf("/") + 1);
  return base === DSL_FILE || `${base}.ts` === DSL_FILE;
};

/** The marker Vitest keys on; a component without it is never looked at. */
export const MARKER = "import.meta.vitest";

/** Something the plugin cannot do with a snippet; an `error` stops the run, since the test would otherwise be silently skipped. */
export type Warning = {
  line: number;
  column: number;
  length: number;
  message: string;
  severity: "error" | "warning";
};

export type ImportBinding =
  | { kind: "default"; local: string; typeOnly: boolean }
  | { kind: "named"; local: string; imported: string; typeOnly: boolean }
  | { kind: "namespace"; local: string; typeOnly: boolean };

export type Import = {
  specifier: string;
  /** `import type … from` */
  typeOnly: boolean;
  bindings: ImportBinding[];
  start: number;
  end: number;
};

export type Param =
  /** `Component: typeof Self` — the component under test, always first */
  | { kind: "subject"; name: string }
  /** `test: Test` — the DSL's `Test` */
  | { kind: "test"; name: string }
  /** `pocket: { … }` — a bare object type, handed in as a reactive pocket */
  | { kind: "pocket"; name: string; typeText: string }
  /** `data: typeof fakeData` — an import, handed in as the value it names */
  | { kind: "value"; name: string; local: string; typeText: string }
  /** `Status: typeof Sweater.Status` — one of the library's components, from the DSL's namespace */
  | { kind: "sweater"; name: string; member: string; typeText: string }
  | { kind: "unsupported"; name: string; typeText: string };

export type TestSnippet = {
  name: string;
  /** 1-based line of the `{#snippet}` */
  line: number;
  start: number;
  end: number;
  params: Param[];
  /** names the snippet reads from the component's script, which a generated test cannot reach */
  unreachable: string[];
};

export type Script = {
  /** the `lang` attribute, if any */
  lang: string | null;
  start: number;
  end: number;
  /** where the script's code begins and ends, inside the tags */
  contentStart: number;
  contentEnd: number;
};

export type Analysis = {
  file: string;
  source: string;
  /** the local name of `import type Self from "./This.svelte"`, if written */
  self: string | null;
  snippets: TestSnippet[];
  imports: Import[];
  module: Script | null;
  instance: Script | null;
  /** the component's `<style>`, which its snippets were written under */
  css: { start: number; end: number } | null;
  warnings: Warning[];
};

type Node = { type: string; start?: number; end?: number } & Record<
  string,
  unknown
>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Node).type === "string";

const SKIPPED_KEYS = new Set([
  "loc",
  "metadata",
  "leadingComments",
  "trailingComments",
]);

// a type is not a reference to anything at run time
const isType = (node: Node) => node.type.startsWith("TS");

/** Every run-time node under `node`, depth first, with the key it hangs from in its parent. */
function* walk(
  node: Node,
  parent: Node | null = null,
  key = "",
): Generator<[Node, Node | null, string]> {
  if (isType(node)) return;
  yield [node, parent, key];
  for (const [k, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(k)) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) yield* walk(item, node, k);
    } else if (isNode(value)) yield* walk(value, node, k);
  }
}

// a property name is not a reference to a binding of the same name
const isReference = (node: Node, parent: Node | null, key: string) =>
  node.type === "Identifier" &&
  !(
    parent?.type === "MemberExpression" &&
    key === "property" &&
    !parent.computed
  ) &&
  !(parent?.type === "Property" && key === "key" && !parent.computed);

const lineIndex = (source: string) => {
  const starts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") starts.push(i + 1);
  return {
    lineOf: (offset: number) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    columnOf: (offset: number, line: number) => offset - starts[line]!,
  };
};

const scriptOf = (script: AST.Script | null): Script | null => {
  if (!script) return null;
  const lang = script.attributes.find((a) => a.name === "lang");
  const value = lang && Array.isArray(lang.value) ? lang.value[0] : null;
  const content = script.content as unknown as Node;
  return {
    lang: value && value.type === "Text" ? value.data : null,
    start: script.start,
    end: script.end,
    contentStart: content.start!,
    contentEnd: content.end!,
  };
};

const importsOf = (program: AST.Script["content"] | undefined): Import[] => {
  if (!program) return [];
  const imports: Import[] = [];
  for (const statement of program.body as unknown as Node[]) {
    if (statement.type !== "ImportDeclaration") continue;
    const typeOnly = statement.importKind === "type";
    const bindings: ImportBinding[] = [];
    for (const s of statement.specifiers as Node[]) {
      const local = (s.local as Node).name as string;
      if (s.type === "ImportDefaultSpecifier")
        bindings.push({ kind: "default", local, typeOnly });
      else if (s.type === "ImportNamespaceSpecifier")
        bindings.push({ kind: "namespace", local, typeOnly });
      else {
        const imported = s.imported as Node;
        const name = (
          imported.type === "Identifier" ? imported.name : imported.value
        ) as string;
        bindings.push({
          kind: "named",
          local,
          imported: name,
          typeOnly: typeOnly || s.importKind === "type",
        });
      }
    }
    imports.push({
      specifier: (statement.source as Node).value as string,
      typeOnly,
      bindings,
      start: statement.start!,
      end: statement.end!,
    });
  }
  return imports;
};

const resolvesToSelf = (file: string, specifier: string) =>
  specifier.startsWith(".") &&
  path.resolve(path.dirname(file), specifier) === file;

/** `import type Self from "./This.svelte"`: the component's own type, under the name it chose. */
export const selfImport = (file: string, imports: Import[]): string | null => {
  for (const i of imports)
    if (resolvesToSelf(file, i.specifier))
      for (const b of i.bindings)
        if (
          b.typeOnly &&
          (b.kind === "default" ||
            (b.kind === "named" && b.imported === "default"))
        )
          return b.local;
  return null;
};

const dslLocals = (imports: Import[], exported: string) =>
  new Set(
    imports
      .filter((i) => isDslModule(i.specifier))
      .flatMap((i) => i.bindings)
      .filter((b) => b.kind === "named" && b.imported === exported)
      .map((b) => b.local),
  );

const importLocals = (imports: Import[]) =>
  new Set(imports.flatMap((i) => i.bindings).map((b) => b.local));

const typeOf = (param: Node): Node | null => {
  const annotation = param.typeAnnotation as Node | undefined;
  return annotation && isNode(annotation.typeAnnotation)
    ? annotation.typeAnnotation
    : null;
};

const queried = (type: Node): string | null => {
  const name = type.exprName as Node | undefined;
  return type.type === "TSTypeQuery" && name?.type === "Identifier"
    ? (name.name as string)
    : null;
};

// `typeof A.B`: the namespace and the member
const queriedMember = (type: Node): { root: string; member: string } | null => {
  const name = type.exprName as Node | undefined;
  if (type.type !== "TSTypeQuery" || name?.type !== "TSQualifiedName")
    return null;
  const left = name.left as Node;
  const right = name.right as Node;
  return left.type === "Identifier" && right.type === "Identifier"
    ? { root: left.name as string, member: right.name as string }
    : null;
};

const referenced = (type: Node): string | null => {
  const name = type.typeName as Node | undefined;
  return type.type === "TSTypeReference" &&
    name?.type === "Identifier" &&
    !type.typeArguments
    ? (name.name as string)
    : null;
};

function classify(
  param: Node,
  source: string,
  self: string,
  tests: Set<string>,
  sweaters: Set<string>,
  locals: Set<string>,
): Param {
  const name =
    param.type === "Identifier"
      ? (param.name as string)
      : source.slice(param.start, param.end);
  const type = typeOf(param);
  const typeText = type ? source.slice(type.start, type.end) : "";
  if (!type || param.type !== "Identifier")
    return { kind: "unsupported", name, typeText };
  const query = queried(type);
  if (query === self) return { kind: "subject", name };
  if (query && locals.has(query))
    return { kind: "value", name, local: query, typeText };
  const member = queriedMember(type);
  if (member && sweaters.has(member.root))
    return { kind: "sweater", name, member: member.member, typeText };
  const reference = referenced(type);
  if (reference && tests.has(reference)) return { kind: "test", name };
  if (type.type === "TSTypeLiteral") return { kind: "pocket", name, typeText };
  return { kind: "unsupported", name, typeText };
}

// every identifier a pattern binds: `a`, `{ a, b: c }`, `[a, ...rest]`, `a = 1`
function* bound(pattern: Node | null | undefined): Generator<string> {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      return void (yield pattern.name as string);
    case "ObjectPattern":
      for (const p of pattern.properties as Node[])
        yield* bound(
          p.type === "RestElement" ? (p.argument as Node) : (p.value as Node),
        );
      return;
    case "ArrayPattern":
      for (const e of pattern.elements as (Node | null)[]) yield* bound(e);
      return;
    case "RestElement":
      return yield* bound(pattern.argument as Node);
    case "AssignmentPattern":
      return yield* bound(pattern.left as Node);
  }
}

// what the scripts declare at their top level, other than imports
function* declaredIn(
  program: AST.Script["content"] | undefined,
): Generator<string> {
  if (!program) return;
  for (const statement of program.body as unknown as Node[]) {
    if (statement.type === "VariableDeclaration")
      for (const d of statement.declarations as Node[])
        yield* bound(d.id as Node);
    else if (
      statement.type === "FunctionDeclaration" ||
      statement.type === "ClassDeclaration"
    )
      yield* bound(statement.id as Node);
    else if (
      statement.type === "ExportNamedDeclaration" &&
      isNode(statement.declaration)
    )
      yield* declaredIn({
        body: [statement.declaration],
      } as unknown as AST.Script["content"]);
  }
}

// what a snippet binds for itself, anywhere inside it: those names are its own, not the script's
function* boundInside(snippet: Node): Generator<string> {
  for (const [node] of walk(snippet)) {
    switch (node.type) {
      case "SnippetBlock":
        yield* bound(node.expression as Node);
        for (const p of node.parameters as Node[]) yield* bound(p);
        break;
      case "ConstTag":
        for (const d of (node.declaration as Node).declarations as Node[])
          yield* bound(d.id as Node);
        break;
      case "EachBlock":
        yield* bound(node.context as Node);
        if (node.index) yield node.index as string;
        break;
      case "AwaitBlock":
        yield* bound(node.value as Node);
        yield* bound(node.error as Node);
        break;
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
        for (const p of node.params as Node[]) yield* bound(p);
        if (node.id) yield* bound(node.id as Node);
        break;
      case "VariableDeclarator":
        yield* bound(node.id as Node);
        break;
      case "CatchClause":
        yield* bound(node.param as Node);
        break;
    }
  }
}

/** The script-declared names a snippet reads without binding them itself. */
function unreachableIn(snippet: Node, declared: Set<string>): string[] {
  const own = new Set(boundInside(snippet));
  const found = new Set<string>();
  for (const [node, parent, key] of walk(snippet))
    if (
      isReference(node, parent, key) &&
      declared.has(node.name as string) &&
      !own.has(node.name as string)
    )
      found.add(node.name as string);
  return [...found];
}

export function analyze(file: string, source: string): Analysis {
  const ast = parse(source, { modern: true, filename: file });
  const imports = [
    ...importsOf(ast.module?.content),
    ...importsOf(ast.instance?.content),
  ];
  const self = selfImport(file, imports);
  const { lineOf, columnOf } = lineIndex(source);
  const warnings: Warning[] = [];
  const snippets: TestSnippet[] = [];

  const warn = (
    node: Node,
    message: string,
    severity: Warning["severity"] = "error",
  ) => {
    const line = lineOf(node.start!);
    warnings.push({
      line,
      column: columnOf(node.start!, line),
      length: node.end! - node.start!,
      message,
      severity,
    });
  };

  if (self) {
    const tests = dslLocals(imports, "Test");
    const sweaters = dslLocals(imports, "Sweater");
    const locals = importLocals(imports);
    const declared = new Set([
      ...declaredIn(ast.module?.content),
      ...declaredIn(ast.instance?.content),
    ]);
    const nodes = ast.fragment.nodes as unknown as Node[];
    const root = ast as unknown as Node;

    const usedOutside = (snippet: Node, name: string) => {
      for (const [node, parent, key] of walk(root)) {
        if (node === snippet) continue;
        if (
          isReference(node, parent, key) &&
          node.name === name &&
          !within(snippet, node)
        )
          return true;
      }
      return false;
    };

    for (const node of nodes) {
      if (node.type !== "SnippetBlock") continue;
      const name = (node.expression as Node).name as string;
      const params = node.parameters as Node[];
      const first = params[0];
      if (!first || queried(typeOf(first) ?? { type: "" }) !== self) continue;
      if (usedOutside(node, name)) continue;

      const classified = params.map((p) =>
        classify(p, source, self, tests, sweaters, locals),
      );
      for (const [i, p] of classified.entries()) {
        if (p.kind !== "unsupported") continue;
        warn(
          params[i]!,
          `\`${p.name}: ${p.typeText}\` is not something a test snippet can be handed: ` +
            "write a bare object type for a pocket, `typeof` an import for a value, `typeof Sweater.<Component>`, or `Test`",
        );
      }
      const unreachable = unreachableIn(node, declared);
      for (const reached of unreachable)
        warn(
          node,
          `\`${reached}\` is the component's own (declared in its script), which a test snippet cannot reach: ` +
            "a generated test has the snippet, its imports and its parameters, and nothing of the script — " +
            "move it to a module and `import type` it, or declare it with `{@const}` inside the snippet",
        );
      snippets.push({
        name,
        line: lineOf(node.start!) + 1,
        start: node.start!,
        end: node.end!,
        params: classified,
        unreachable,
      });
    }
  }

  return {
    file,
    source,
    self,
    snippets,
    imports,
    module: scriptOf(ast.module ?? null),
    instance: scriptOf(ast.instance ?? null),
    css: ast.css ? { start: ast.css.start, end: ast.css.end } : null,
    warnings,
  };
}

const within = (outer: Node, node: Node) =>
  node.start !== undefined &&
  outer.start !== undefined &&
  node.start >= outer.start &&
  node.end! <= outer.end!;

/** A snippet the plugin can generate a test from: every parameter is understood, and nothing reaches into the script. */
export const isGeneratable = (snippet: TestSnippet) =>
  snippet.params.every((p) => p.kind !== "unsupported") &&
  snippet.params.filter((p) => p.kind === "subject").length === 1 &&
  !snippet.unreachable.length;

export const hasTest = (snippet: TestSnippet) =>
  snippet.params.some((p) => p.kind === "test");

import type {
  Expect,
  Invoke,
  Table,
} from "../../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";
import type {
  errorsOf,
  lineOf,
  paramsOf,
  snippetNames,
  warningsOf,
} from "../_internal/harness.ts";

declare namespace analyze {
  type Markup = `
{#snippet tested(C: typeof Self, pocket: { n: 2 }, test: Test)}
  <C />
  {test(async () => {})}
{/snippet}

{#snippet example(C: typeof Self)}
  <C />
{/snippet}

{#snippet used(C: typeof Self, test: Test)}
  <C />
{/snippet}

{#snippet ordinary(label: string)}
  <b>{label}</b>
{/snippet}

{@render used(Self, () => {})}
{@render ordinary("x")}
`;

  /** a snippet is the library's when it is unused and takes the component's own type first */
  export type Found = Expect<
    Invoke<typeof snippetNames, [Markup]>,
    "=",
    ["tested", "example"]
  >;

  /** each parameter is read for what it is */
  export type Params = Table<
    typeof paramsOf,
    [
      [args: [Markup, "tested"], expected: ["subject", "pocket", "test"]],
      [args: [Markup, "example"], expected: ["subject"]],
    ]
  >;

  /** lines are 1-based, counted from the top of the file: the prelude's four lines, a blank, then this */
  export type Line = Expect<Invoke<typeof lineOf, [Markup, "tested"]>, "=", 6>;

  type ValueScript = `
import type { fakeData } from "./harness.ts";
import { helper } from "./helper.ts";
`;

  type Value = `
{#snippet withValues(C: typeof Self, data: typeof fakeData, h: typeof helper, test: Test)}
  <C />
  {test(async () => {})}
{/snippet}
`;

  /** `typeof` an import — type-only or not — hands the import in as a value */
  export type Values = Expect<
    Invoke<typeof paramsOf, [Value, "withValues", ValueScript]>,
    "=",
    ["subject", "value:fakeData", "value:helper", "test"]
  >;

  type Helped = `
{#snippet helped(C: typeof Self, Status: typeof Sweater.Status, Frame: typeof Sweater.Frame, test: Test)}
  <Frame><C /></Frame>
  <Status {test} />
  {test(async () => {})}
{/snippet}
`;

  /** `typeof Sweater.X` — the DSL's components namespace — hands in that component */
  export type Helpers = Expect<
    Invoke<typeof paramsOf, [Helped, "helped"]>,
    "=",
    ["subject", "sweater:Status", "sweater:Frame", "test"]
  >;

  type Odd = `
{#snippet odd(C: typeof Self, n: number, test: Test)}
  <C />
{/snippet}
`;

  /** a parameter the plugin cannot hand in is an error, said where it is */
  export type Unsupported = Expect<
    Invoke<typeof errorsOf, [Odd]>[0],
    "includes",
    "`n: number` is not something a test snippet can be handed"
  >;

  type Shadowed = `
{#snippet one(C: typeof Self, test: Test)}
  <C />
  {test(async () => { const { one } = {} as any; })}
{/snippet}
`;

  /** a reference inside the snippet's own body does not make it used */
  export type OwnBody = Expect<
    Invoke<typeof snippetNames, [Shadowed]>,
    "=",
    ["one"]
  >;

  type Property = `
{#snippet two(C: typeof Self, test: Test)}
  <C />
{/snippet}
<p>{({ two: 1 }).two}</p>
`;

  /** nor does a property that happens to share its name */
  export type PropertyName = Expect<
    Invoke<typeof snippetNames, [Property]>,
    "=",
    ["two"]
  >;

  type Passed = `
{#snippet three(C: typeof Self, test: Test)}
  <C />
{/snippet}
<Other children={three} />
`;

  /** handed to a component, it is used */
  export type Passed_ = Expect<Invoke<typeof snippetNames, [Passed]>, "=", []>;
}

declare namespace isDslModule {
  export type Names = Table<
    typeof isDslModule,
    [
      [args: ["$release/dsl.import.meta.vitest"], expected: true],
      [args: ["../../release/dsl.import.meta.vitest.ts"], expected: true],
      [args: ["./my-dsl.import.meta.vitest.ts"], expected: false],
    ]
  >;
}

declare namespace unreachableIn {
  type Script = `
let count = $state(0);
const limit = 10;
function helper() {}
`;

  type Reaches = `
{#snippet reaches(C: typeof Self, test: Test)}
  <C {limit} />
  {test(async () => { helper(); })}
{/snippet}
`;

  type Reported_ = Invoke<typeof errorsOf, [Reaches, Script]>;

  /** a script's names are not a generated test's: each is an error, said where the snippet is, and the snippet is left out */
  export type Reported = [
    Expect<Reported_["length"], "=", 2>,
    Expect<Reported_[0], "includes", "`limit` is the component's own">,
    Expect<Reported_[1], "includes", "`helper` is the component's own">,
    Expect<Invoke<typeof snippetNames, [Reaches, Script]>, "=", []>,
  ];

  type OwnNames = `
{#snippet own(C: typeof Self, pocket: { count: 1 }, test: Test)}
  {@const limit = 3}
  {#each [1, 2] as helper (helper)}
    <C {helper} />
  {/each}
  {test(async ({ expect }) => { const count = pocket.count; expect(count + limit).toBe(4); })}
{/snippet}
`;

  /** what the snippet binds for itself — a parameter, a const, an each context, a local — shadows the script */
  export type Shadowed = Expect<
    Invoke<typeof warningsOf, [OwnNames, Script]>,
    "=",
    []
  >;

  type TypesAndNested = `
{#snippet typed(C: typeof Self, pocket: { count: Widen<1>; limit?: { helper: string } }, test: Test)}
  {#snippet helper()}<i />{/snippet}
  <C {helper} count={pocket.count} />
  {test(async () => {})}
{/snippet}
`;

  /** a name in a type annotation is not a reference, and a nested snippet's name is its own */
  export type NotReferences = Expect<
    Invoke<typeof warningsOf, [TypesAndNested, Script]>,
    "=",
    []
  >;
}
