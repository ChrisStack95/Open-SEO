import { sort } from "remeda";

type LlmsPage = {
  url: string;
  title?: string;
  description?: string;
  content?: string;
  canonical?: string;
  indexable?: boolean;
  statusCode?: number;
  depth?: number;
  uniqueInlinks?: number;
  linkScore?: number;
  wordCount?: number;
};

type Input = { siteName: string; summary?: string; pages: LlmsPage[] };

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

function importance(page: LlmsPage): number {
  return (
    (page.linkScore ?? 0) * 0.4 +
    Math.min((page.uniqueInlinks ?? 0) * 10, 100) * 0.3 +
    Math.max(0, 100 - (page.depth ?? 0) * 20) * 0.2 +
    (page.wordCount ? Math.min(page.wordCount / 10, 100) : 50) * 0.1
  );
}

function label(page: LlmsPage): string {
  return (
    page.title?.trim() ||
    pathOf(page.url).split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") ||
    page.url
  )
    .replace(/[[\]\r\n]/g, " ")
    .slice(0, 60);
}

export function generateLlmsTxt({ siteName, summary, pages }: Input) {
  const available = pages.filter(
    (page) =>
      page.indexable !== false && (!page.statusCode || page.statusCode === 200),
  );
  const canonicalUrls = new Set(available.map((page) => page.url));
  const seen = new Set<string>();
  const sections = new Map<string, LlmsPage[]>();
  for (const page of available) {
    if (
      page.canonical &&
      page.canonical !== page.url &&
      canonicalUrls.has(page.canonical)
    )
      continue;
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    const parts = pathOf(page.url).split("/").filter(Boolean);
    const first = parts[0] ?? "Home";
    const section = /contact/i.test(first)
      ? "Contact"
      : page.depth != null && page.depth >= 4 && (page.uniqueInlinks ?? 0) <= 1
        ? "Optional"
        : first[0].toUpperCase() + first.slice(1).replaceAll("-", " ");
    sections.set(section, [...(sections.get(section) ?? []), page]);
  }
  const site = siteName.replace(/[\r\n]/g, " ").trim();
  const header = `# ${site}\n\n> ${summary?.trim() || `Official website content for ${site}`}\n`;
  const ordered = sort([...sections], ([a], [b]) =>
    a === "Optional"
      ? 1
      : b === "Optional"
        ? -1
        : a === "Contact"
          ? 1
          : b === "Contact"
            ? -1
            : a.localeCompare(b),
  );
  const index = ordered
    .map(
      ([section, entries]) =>
        `## ${section}\n${sort(entries, (a, b) => importance(b) - importance(a))
          .map(
            (page) =>
              `- [${label(page)}](${page.url}): ${(page.description?.trim() || label(page)).replace(/[\r\n]/g, " ").slice(0, 120)}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");
  const full = ordered
    .flatMap(([, entries]) =>
      entries
        .filter((page) => page.content?.trim())
        .map(
          (page) =>
            `## ${label(page)}\n\nSource: ${page.url}\n\n${page.content?.trim()}`,
        ),
    )
    .join("\n\n");
  return {
    llmsTxt: `${header}\n${index}\n`,
    llmsFullTxt: full ? `# ${site}\n\n${full}\n` : "",
  };
}
