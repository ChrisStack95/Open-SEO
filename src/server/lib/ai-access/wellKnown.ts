import { isHtml } from "./llmTxt";
import type { FetchedText } from "./types";

export const WELL_KNOWN_PATHS = [
  "/.well-known/ai-plugin.json",
  "/.well-known/aip.json",
  "/.well-known/tdmrep.json",
] as const;
export function checkWellKnown(
  origin: string,
  responses: Record<string, FetchedText>,
) {
  const files: Record<
    string,
    { found: boolean; url: string; content?: string }
  > = {};
  for (const path of WELL_KNOWN_PATHS) {
    const response = responses[path];
    const text = response?.text.trim() ?? "";
    const found =
      response?.status === 200 &&
      Boolean(text) &&
      !isHtml(text) &&
      !response.contentType?.includes("text/html");
    files[path] = {
      found,
      url: new URL(path, origin).toString(),
      ...(found ? { content: text.slice(0, 2000) } : {}),
    };
  }
  return files;
}
