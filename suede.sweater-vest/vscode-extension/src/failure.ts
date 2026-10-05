import { GENERATED_SUFFIX } from "../../vite-plugin/names.ts";

export type Failure = {
  name: string;
  message: string;
  stack?: string | null;
  where?: string | null;
};

// a generated test is served from memory, so a frame in it opens nothing
const NOT_YOURS = [
  "node_modules",
  "node:internal",
  "(native)",
  GENERATED_SUFFIX,
];

const isYours = (frame: string) =>
  !NOT_YOURS.some((part) => frame.includes(part));

export function frames(stack: string | null | undefined): string[] {
  if (!stack) return [];
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") && isYours(line));
}

export function explain({ name, message, stack, where }: Failure): string {
  const parts = [where ? `${name} — ${where}` : name, "", message];
  const rest = frames(stack);
  if (rest.length) parts.push("", ...rest);
  return parts.join("\n");
}
