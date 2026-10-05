import type { Run, Summary } from "./index.ts";

const code = (s: string, lang = "") => `\`\`\`${lang}\n${s}\n\`\`\``;

const trace = (run: Run, assets: Map<string, string>) => [
  ...run.notes.map((note) => `- ${note}`),
  ...run.captures.map(
    (c, i) =>
      `- ![${c.name ?? `capture ${i + 1}`}](${assets.get(`${run.browser}:${run.key}:${i}`)})`,
  ),
];

const failure = (run: Run, assets: Map<string, string>) =>
  [
    `### \`${run.name}\` *(${run.browser})*`,
    "",
    ...trace(run, assets),
    "",
    `❌ **${(run.error ?? "failed").split("\n")[0]}**`,
    "",
    `<details><summary>Page</summary>\n\n[${run.url}](${run.url})\n\n</details>`,
  ].join("\n");

const passed = (run: Run, assets: Map<string, string>) =>
  [
    `- ✅ \`${run.name}\` *(${run.browser})* · ${run.durationMs}ms`,
    ...trace(run, assets).map((l) => `  ${l}`),
  ].join("\n");

/** The report, with each capture already written out and linked by `assets` (`browser:key:index` → relative path). */
export function renderMarkdown(
  summary: Summary,
  assets: Map<string, string>,
): string {
  const failed = summary.runs.filter((r) => r.state === "failed");
  const ok = summary.runs.filter((r) => r.state === "passed");
  const light = failed.length ? "🔴" : "🟢";
  const lines = [
    "# Sweater Vest Report",
    "",
    `${light} **${failed.length} failed** · ${ok.length} passed · ${summary.runs.length} total`,
    `Generated ${summary.generatedAt} · [${summary.server}](${summary.server})`,
    "",
  ];
  if (failed.length)
    lines.push(
      "---",
      "",
      `## ❌ Failures (${failed.length})`,
      "",
      ...failed.map((r) => failure(r, assets)),
      "",
    );
  if (ok.length)
    lines.push(
      "---",
      "",
      `## ✅ Passed (${ok.length})`,
      "",
      ...ok.map((r) => passed(r, assets)),
      "",
    );
  if (!summary.runs.length) lines.push("_No test snippets were found._", "");
  lines.push(
    "---",
    "",
    code(
      JSON.stringify({
        failed: failed.length,
        passed: ok.length,
        total: summary.runs.length,
      }),
      "json",
    ),
    "",
  );
  return lines.join("\n");
}
