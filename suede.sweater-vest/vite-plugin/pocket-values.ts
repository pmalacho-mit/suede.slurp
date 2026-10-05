import fs from "node:fs";
import ts from "@typescript/typescript6";
import {
  createEmitContext,
  lowerExpr,
  printExpr,
  some,
} from "../../suede.nests.sweater-vest/vite-plugin/emit/index.mts";
import { literalOfType } from "../../suede.nests.sweater-vest/vite-plugin/emit/model.mts";
import { configFor } from "../../suede.nests.sweater-vest/vite-plugin/minimal.mts";

import type {
  EmitContext,
  Expr,
} from "../../suede.nests.sweater-vest/vite-plugin/emit/index.mts";
import type { Analysis, TestSnippet } from "./analyze.ts";
import type { PocketValue } from "./generate.ts";
import type {
  Expect,
  Invoke,
} from "../../suede.nests.sweater-vest/dsl.import.meta.vitest.ts";

/**
 * A pocket's initial value is read off its type: `{ count: 2; el: HTMLDivElement }`
 * starts as `{ count: 2 }`. Members written as literal types (and `typeof` an
 * import) are values; everything else — an element, a component instance — is
 * what the snippet binds in, so it starts undefined.
 *
 * The lowering is the namespace-tests printer's, over a TypeScript view of the
 * component: its imports, and one alias per pocket type.
 */

type Versioned = { version: number; snapshot: ts.IScriptSnapshot };

const textOf = (snapshot: ts.IScriptSnapshot) =>
  snapshot.getText(0, snapshot.getLength());

function languageService(cwd: string, tsconfig: string) {
  const config = configFor(tsconfig, cwd);
  const roots = new Set<string>(config.fileNames);
  const versions = new Map<string, number>();
  const snapshots = new Map<string, Versioned>();
  const versionOf = (file: string) => versions.get(file) ?? 0;

  const store = (file: string, text: string) => {
    const snapshot = ts.ScriptSnapshot.fromString(text);
    snapshots.set(file, { version: versionOf(file), snapshot });
    return snapshot;
  };

  const snapshotOf = (file: string) => {
    const cached = snapshots.get(file);
    if (cached?.version === versionOf(file)) return cached.snapshot;
    if (!fs.existsSync(file)) return undefined;
    return store(file, fs.readFileSync(file, "utf8"));
  };

  const service = ts.createLanguageService(
    {
      getScriptFileNames: () => [...roots],
      getScriptVersion: (file) => String(versionOf(file)),
      getScriptSnapshot: snapshotOf,
      getCurrentDirectory: () => cwd,
      getCompilationSettings: () => config.options,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists: (file) => snapshots.has(file) || ts.sys.fileExists(file),
      readFile: (file) => {
        const held = snapshots.get(file);
        return held ? textOf(held.snapshot) : ts.sys.readFile(file);
      },
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      ...(ts.sys.realpath ? { realpath: ts.sys.realpath } : {}),
    },
    ts.createDocumentRegistry(),
  );

  return {
    changed(file: string) {
      versions.set(file, versionOf(file) + 1);
    },
    inputAsWritten(file: string, code: string) {
      roots.add(file);
      const current = snapshots.get(file);
      if (!current || textOf(current.snapshot) !== code) {
        this.changed(file);
        store(file, code);
      }
      const program = service.getProgram();
      const source = program?.getSourceFile(file);
      return program && source ? { program, source } : null;
    },
  };
}

const aliasName = (snippet: string, param: string) => `__${snippet}__${param}`;

/** The TypeScript module that stands in for the component: its imports, then an alias per pocket. */
export function viewOf(analysis: Analysis): string {
  const imports = analysis.imports.map((i) =>
    analysis.source.slice(i.start, i.end),
  );
  const aliases = analysis.snippets.flatMap((s) =>
    s.params.flatMap((p) =>
      p.kind === "pocket"
        ? [`type ${aliasName(s.name, p.name)} = ${p.typeText};`]
        : [],
    ),
  );
  return [...imports, "", ...aliases, ""].join("\n");
}

const keyOf = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : name.getText();

const isLiteralLike = (node: ts.TypeNode) =>
  ts.isLiteralTypeNode(node) ||
  ts.isTupleTypeNode(node) ||
  ts.isTemplateLiteralTypeNode(node) ||
  ts.isTypeQueryNode(node) ||
  ts.isParenthesizedTypeNode(node) ||
  // `undefined` is what an absent member already is
  node.kind === ts.SyntaxKind.NullKeyword;

const supported = (e: Expr) => !some(e, (n) => n.kind === "unsupported");

/** A member's value, or null when its type names no value (so it starts undefined). */
function lowerMember(cx: EmitContext, node: ts.TypeNode): Expr | null {
  const before = cx.warnings.length;
  const attempt = (): Expr | null => {
    if (ts.isTypeLiteralNode(node)) return lowerObject(cx, node);
    if (ts.isTypeReferenceNode(node)) {
      // `Widen<2>` and the DSL's other intrinsics print as the value they were written with
      if (cx.dslName(node)) {
        const e = lowerExpr(cx, node);
        return supported(e) ? e : null;
      }
      return literalOfType(cx, cx.checker.getTypeFromTypeNode(node));
    }
    if (!isLiteralLike(node)) return null;
    const e = lowerExpr(cx, node);
    return supported(e) ? e : null;
  };
  const result = attempt();
  // what was tried and found to be a plain type is not a mistake
  if (!result) cx.warnings.length = before;
  return result;
}

function lowerObject(cx: EmitContext, node: ts.TypeLiteralNode): Expr {
  const entries: [string, Expr][] = [];
  for (const m of node.members) {
    if (!ts.isPropertySignature(m) || !m.type || !m.name) continue;
    const value = lowerMember(cx, m.type);
    if (value) entries.push([keyOf(m.name), value]);
  }
  return { kind: "object", entries };
}

export function pocketValues(cwd: string, tsconfig: string) {
  let service: ReturnType<typeof languageService> | undefined;
  const serviceFor = () => (service ??= languageService(cwd, tsconfig));

  return {
    changed(file: string) {
      service?.changed(file);
    },
    /** Printed initial values for every pocket parameter of `snippet`. */
    forSnippet(
      analysis: Analysis,
      snippet: TestSnippet,
    ): Map<string, PocketValue> {
      const values = new Map<string, PocketValue>();
      const pockets = snippet.params.filter((p) => p.kind === "pocket");
      if (!pockets.length) return values;
      const file = `${analysis.file}.__vest__.ts`;
      const input = serviceFor().inputAsWritten(file, viewOf(analysis));
      if (!input) return values;
      const cx = createEmitContext(input.program, input.source);
      const aliases = new Map<string, ts.TypeAliasDeclaration>();
      for (const statement of input.source.statements)
        if (ts.isTypeAliasDeclaration(statement))
          aliases.set(statement.name.text, statement);
      for (const p of pockets) {
        const alias = aliases.get(aliasName(snippet.name, p.name));
        const type = alias?.type;
        if (!type || !ts.isTypeLiteralNode(type)) continue;
        const object = lowerObject(cx, type);
        values.set(p.name, {
          initial: printExpr(object),
          members:
            object.kind === "object"
              ? object.entries.map(([k, v]) => [k, printExpr(v)])
              : [],
          imports: cx.test.imports,
        });
      }
      return values;
    },
  };
}

import type { pocketOf } from "../_internal/harness.ts";

declare namespace pocketValues {
  type Shapes = Invoke<typeof pocketOf, ["Pocket.svelte", "shapes", "pocket"]>;

  /**
   * literal types are values; `Widen` prints what it was written with; an element,
   * a component instance and `undefined` start absent; `typeof` an import is the import
   */
  export type Initial = Expect<
    Shapes,
    "matches",
    {
      initial: '{ n: 2, w: "a", nested: { ok: true, list: [1, 2] }, data: seed$ }';
    }
  >;

  /** a type-only import a pocket takes a value from is imported again, as a value */
  export type ValueImport = Expect<
    Shapes,
    "matches",
    { imports: { "./seed.ts": ["seed as seed$"] } }
  >;
}
