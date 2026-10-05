#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit, type BrowserType } from "playwright";

import { cli } from "../vendored/typescript-cli-suede/index.ts";
import { TESTS_ENDPOINT } from "../endpoints.ts";
import { renderMarkdown } from "./markdown.ts";

import type { PageResult } from "../runtimes/common.svelte.ts";

// the page's `capture` calls this: a real screenshot, of one element or the whole page
const CAPTURE_BINDING = "__sweaterVestCapture";

export const browsers = ["chromium", "firefox", "webkit"] as const;
export type Browser = (typeof browsers)[number];

const launchers: Record<Browser, BrowserType> = { chromium, firefox, webkit };

export type Options = {
  /** Where the dev server is. */
  server?: string;
  /** The route that renders a snippet on a page. */
  route?: string;
  browsers?: Browser[];
  /** The Markdown report; an empty string writes nothing. */
  output?: string;
  /** Only run tests whose name matches. */
  test?: RegExp;
  /** How long one page may take to settle. */
  timeoutMs?: number;
  headless?: boolean;
};

export type Run = PageResult & { browser: Browser; url: string };

export type Summary = {
  generatedAt: string;
  server: string;
  runs: Run[];
  passed: number;
  failed: number;
};

type Entry = { name: string; key: string; test: boolean };

export const defaults = {
  server: "http://localhost:5173",
  route: "/vests",
  browsers: ["chromium"],
  output: "./fashion-show.md",
  timeoutMs: 60_000,
  headless: true,
} as const;

const settled = () =>
  window.__sweaterVest !== undefined &&
  window.__sweaterVest.state !== "running";

const timedOut = (
  entry: Entry,
  timeoutMs: number,
  why: string,
): PageResult => ({
  name: entry.name,
  key: entry.key,
  test: entry.test,
  state: "failed",
  error: `no result within ${timeoutMs}ms: ${why}`,
  notes: [],
  captures: [],
  durationMs: timeoutMs,
});

async function runIn(
  browser: Browser,
  entries: Entry[],
  server: string,
  options: Required<Options>,
): Promise<Run[]> {
  const instance = await launchers[browser].launch({
    headless: options.headless,
  });
  const runs: Run[] = [];
  try {
    const context = await instance.newContext();
    await context.exposeBinding(
      CAPTURE_BINDING,
      async ({ page }, selector: string | null) => {
        const shot = selector
          ? await page.locator(selector).screenshot({ type: "png" })
          : await page.screenshot({ type: "png" });
        return shot.toString("base64");
      },
    );
    for (const entry of entries) {
      const url = `${server}${options.route}/${entry.key}`;
      const page = await context.newPage();
      try {
        await page.goto(url);
        await page.waitForFunction(settled, undefined, {
          timeout: options.timeoutMs,
        });
        runs.push({
          ...(await page.evaluate(() => window.__sweaterVest!)),
          browser,
          url,
        });
      } catch (e) {
        runs.push({
          ...timedOut(
            entry,
            options.timeoutMs,
            e instanceof Error ? e.message.split("\n")[0]! : String(e),
          ),
          browser,
          url,
        });
      } finally {
        await page.close();
      }
      const last = runs.at(-1)!;
      console.log(
        `${last.state === "passed" ? "✅" : "❌"} ${last.name} (${browser}) ${last.durationMs}ms${last.error ? `\n   ${last.error}` : ""}`,
      );
    }
  } finally {
    await instance.close();
  }
  return runs;
}

const slug = (text: string) => text.replace(/[^\w.-]+/g, "_");

// captures are written beside the report, as files it links to, rather than inlined as data
function writeAssets(output: string, runs: Run[]): Map<string, string> {
  const dir = `${output.replace(/\.md$/, "")}.assets`;
  const assets = new Map<string, string>();
  const wanted = runs.filter((r) => r.captures.length);
  if (wanted.length) fs.mkdirSync(dir, { recursive: true });
  for (const run of wanted)
    run.captures.forEach((capture, i) => {
      const file = path.join(
        dir,
        `${slug(`${run.browser}-${run.key}`)}-${i + 1}.png`,
      );
      fs.writeFileSync(
        file,
        Buffer.from(capture.dataUri.split(",")[1] ?? "", "base64"),
      );
      assets.set(
        `${run.browser}:${run.key}:${i}`,
        path.relative(path.dirname(output), file).split(path.sep).join("/"),
      );
    });
  return assets;
}

export async function generateReport(given: Options = {}): Promise<Summary> {
  const options = { ...defaults, ...given } as Required<Options>;
  const server = options.server.replace(/\/$/, "");
  const response = await fetch(`${server}${TESTS_ENDPOINT}`).catch((e) => {
    throw new Error(
      `no dev server at ${server} (${e instanceof Error ? e.message : e}); start it, or pass --server`,
    );
  });
  // an example runs too: it passes by mounting
  const entries = ((await response.json()) as Entry[]).filter(
    (e) => !given.test || given.test.test(e.name),
  );
  const runs: Run[] = [];
  for (const browser of options.browsers)
    runs.push(...(await runIn(browser, entries, server, options)));
  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    server,
    runs,
    passed: runs.filter((r) => r.state === "passed").length,
    failed: runs.filter((r) => r.state === "failed").length,
  };
  if (options.output) {
    const output = path.resolve(options.output);
    fs.writeFileSync(
      output,
      renderMarkdown(summary, writeAssets(output, runs)),
    );
    console.log(`Report written to ${path.relative(process.cwd(), output)}`);
  }
  console.log(
    `${summary.failed ? "🔴" : "🟢"} ${summary.failed} failed · ${summary.passed} passed · ${runs.length} total`,
  );
  return summary;
}

if (cli.entry(import.meta.url)) {
  const args = cli(
    "Open every test snippet on the dev server, in a real browser, and write a Markdown report.",
    cli.flag(["server", "s"], "Where the dev server is.", defaults.server),
    cli.flag(
      ["route", "r"],
      "The route that renders a snippet on a page.",
      defaults.route,
    ),
    cli.flags(["browser", "b"], "Which browser(s) to run.", browsers, [
      ...defaults.browsers,
    ]),
    cli.flag(
      ["output", "o"],
      "The Markdown report; pass an empty string to write nothing.",
      defaults.output,
    ),
    cli.flag(
      ["test", "t"],
      "Only run tests whose name matches this pattern (case-insensitive).",
    ),
    cli.flag(
      ["timeout", "w"],
      "Seconds one page may take to settle.",
      defaults.timeoutMs / 1000,
    ),
    cli.flag("headed", "Show the browser.", false),
  );
  generateReport({
    server: args.server,
    route: args.route,
    browsers: args.browser,
    output: args.output,
    ...(args.test ? { test: new RegExp(args.test, "i") } : {}),
    timeoutMs: args.timeout * 1000,
    headless: !args.headed,
  })
    .then((summary) => process.exit(summary.failed ? 1 : 0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
