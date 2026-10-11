import type { FetchedText } from "./types";

export const LLM_PATHS = [
  "/llm.txt",
  "/llms.txt",
  "/llms-full.txt",
  "/.well-known/llm.txt",
] as const;
export function isHtml(text: string): boolean {
  return /^\s*(?:<!doctype|<html)/i.test(text);
}

export function checkLlmTxt(
  baseUrl: string,
  responses: Record<string, FetchedText>,
) {
  const files: Record<
    string,
    {
      found: boolean;
      url: string;
      content: string;
      quality?: {
        hasTitle: boolean;
        hasDescription: boolean;
        hasLinks: boolean;
        hasSections: boolean;
        charCount: number;
        lineCount: number;
      };
    }
  > = {};
  for (const path of LLM_PATHS) {
    const response = responses[path];
    const text = response?.text.trim() ?? "";
    const found =
      response?.status === 200 &&
      text.length > 10 &&
      !isHtml(text) &&
      !response.contentType?.includes("text/html");
    files[path] = {
      found,
      url: new URL(path, baseUrl).toString(),
      content: found ? text.slice(0, 5000) : "",
    };
    if (found)
      files[path].quality = {
        hasTitle: /^#\s+/m.test(text),
        hasDescription: text.length > 100,
        hasLinks: /https?:\/\//.test(text),
        hasSections: (text.match(/\n\n/g) ?? []).length > 2,
        charCount: text.length,
        lineCount: text.split(/\r?\n/).length,
      };
  }
  const first = Object.values(files).find((item) => item.found)?.quality;
  const score = first
    ? Math.min(
        100,
        50 +
          (first.hasTitle ? 10 : 0) +
          (first.hasDescription ? 10 : 0) +
          (first.hasLinks ? 15 : 0) +
          (first.hasSections ? 10 : 0) +
          (first.charCount > 500 ? 5 : 0),
      )
    : 0;
  return { files, score };
}
