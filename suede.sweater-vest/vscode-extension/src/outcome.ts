import { explain } from "./failure.ts";
import type { Assertion } from "./vitest.ts";

export type Outcome =
  | { state: "running" }
  | { state: "passed"; duration: number }
  | { state: "skipped" }
  | { state: "failed"; message: string; duration: number };

export const lensTitle = (outcome: Outcome | undefined) => {
  if (!outcome) return "$(play) Run";
  if (outcome.state === "running") return "$(sync~spin) Running…";
  if (outcome.state === "passed")
    return `$(check) Passed (${outcome.duration}ms)`;
  if (outcome.state === "skipped") return "$(circle-slash) Skipped";
  return "$(error) Failed";
};

const BETWEEN_FAILURES = `\n\n${"─".repeat(60)}\n\n`;

// Vitest's own message: its first line, then the frames from your code
const explained = (assertion: Assertion) => {
  const [message = "failed", ...stack] = (
    assertion.failureMessages?.[0] ?? "failed"
  ).split("\n");
  return explain({
    name: assertion.fullName ?? assertion.title,
    message,
    stack: stack.join("\n"),
  });
};

export function outcomeOf(assertions: Assertion[], duration: number): Outcome {
  const failed = assertions.filter((a) => a.status === "failed");
  if (failed.length)
    return {
      state: "failed",
      message: failed.map(explained).join(BETWEEN_FAILURES),
      duration,
    };
  if (assertions.every((a) => a.status === "passed"))
    return { state: "passed", duration };
  return { state: "skipped" };
}
