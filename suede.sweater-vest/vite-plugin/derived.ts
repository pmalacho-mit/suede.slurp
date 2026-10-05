import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Warning } from "./analyze.ts";

/** Where the plugin writes what the editor reads. Nothing in it is authored. */
export const DERIVED =
  process.env.SWEATER_VEST_DIR ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".derived");

export function ensureDerived(dir = DERIVED): string {
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(DERIVED, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return dir;
}

export const writeDiagnostics = (diagnostics: Record<string, Warning[]>) => {
  ensureDerived();
  fs.writeFileSync(
    path.join(DERIVED, "diagnostics.json"),
    JSON.stringify(diagnostics, null, 2),
  );
};
