import Papa from "papaparse";
import { sort } from "remeda";

type BrandRules = {
  brandName?: string;
  titleSuffix?: string;
  forbiddenTerms?: string[];
  preferredVocabulary?: string[];
  metaLengthCap?: number;
};

type Keyword = {
  keyword: string;
  position: number;
  searchVolume: number;
  score: number;
  trend: string;
  decision: string;
};

const rankingsColumns: Record<string, string> = {
  keyword: "keyword",
  position: "position",
  "search volume": "volume",
  volume: "volume",
  url: "url",
  "previous position": "previous",
  "prev position": "previous",
  "keyword difficulty": "difficulty",
  difficulty: "difficulty",
  trends: "trends",
};
const crawlColumns: Record<string, string> = {
  address: "url",
  "status code": "status",
  indexability: "indexability",
  "title 1": "title",
  "meta description 1": "meta",
  "h1-1": "h1",
  "h1 1": "h1",
};

function parseCsv(
  text: string,
  columns: Record<string, string>,
  required: string[],
) {
  const delimiter = text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    delimiter,
    skipEmptyLines: "greedy",
  });
  if (result.errors.length)
    throw new Error(`Invalid CSV/TSV: ${result.errors[0].message}`);
  const [header, ...rows] = result.data;
  if (!header)
    throw new Error(`Missing required columns: ${required.join(", ")}`);
  const mapped = header.map(
    (name) => columns[name.trim().toLowerCase()] ?? name.trim().toLowerCase(),
  );
  const missing = required.filter((name) => !mapped.includes(name));
  if (missing.length)
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  return rows.map((row) =>
    Object.fromEntries(mapped.map((name, index) => [name, row[index] ?? ""])),
  );
}

const normalizedUrl = (url: string) => url.trim().replace(/\/+$/, "");
const navigational =
  /\b(?:login|sign in|sign up|register|careers|jobs|contact|about us|sitemap|privacy policy|terms|cookie|faq|help center|support)\b/i;
const navigationalUrl =
  /\/(?:login|sign-?in|sign-?up|register|careers|jobs|contact|about|sitemap|privacy|terms|cookie|faq|help|support)(?:\/|$)/i;

function recommendation(keyword: string, rules: BrandRules) {
  const forbidden = rules.forbiddenTerms ?? [];
  const containsForbidden = (text: string) =>
    forbidden.some(
      (term) => term && text.toLowerCase().includes(term.toLowerCase()),
    );
  const safeKeyword = containsForbidden(keyword)
    ? "Explore our range"
    : keyword;
  const suffix = rules.titleSuffix ? ` – ${rules.titleSuffix}` : "";
  const title = `${safeKeyword}${suffix}`.slice(0, 60);
  const vocabulary = (rules.preferredVocabulary ?? []).find(
    (term) => !containsForbidden(term),
  );
  const meta = `Explore ${safeKeyword}${vocabulary ? ` and ${vocabulary}` : ""}${rules.brandName && !containsForbidden(rules.brandName) ? ` from ${rules.brandName}` : ""}.`;
  return {
    recommendedTitle: title,
    recommendedMeta: meta.slice(0, rules.metaLengthCap ?? 155),
  };
}

export function analyzeStrikingDistance(input: {
  rankingsCsv: string;
  crawlCsv?: string;
  brandRules?: BrandRules;
  minSearchVolume?: number;
}) {
  const rankingRows = parseCsv(input.rankingsCsv, rankingsColumns, [
    "keyword",
    "position",
    "volume",
    "url",
  ]);
  const crawlRows = input.crawlCsv
    ? parseCsv(input.crawlCsv, crawlColumns, ["url"])
    : [];
  const crawls = new Map(
    crawlRows
      .filter(
        (row) =>
          (!row.status || Number(row.status) === 200) &&
          (!row.indexability ||
            row.indexability.trim().toLowerCase() === "indexable"),
      )
      .map((row) => [normalizedUrl(row.url), row]),
  );
  const groups = new Map<
    string,
    { protected: number[]; keywords: Keyword[] }
  >();
  const rules = input.brandRules ?? {};
  for (const row of rankingRows) {
    const url = normalizedUrl(row.url);
    const position = Number(row.position);
    const volume = Number(row.volume);
    if (!row.keyword.trim() || !url || !Number.isFinite(position)) continue;
    const group = groups.get(url) ?? { protected: [], keywords: [] };
    groups.set(url, group);
    if (position <= 3) {
      group.protected.push(Number.isFinite(volume) ? volume : 0);
      continue;
    }
    if (
      position < 4 ||
      position > 20 ||
      !Number.isFinite(volume) ||
      volume < (input.minSearchVolume ?? 50)
    )
      continue;
    if (navigational.test(row.keyword) || navigationalUrl.test(url)) continue;
    if (
      rules.brandName
        ?.split(/\s+/)
        .some(
          (word) =>
            word.length > 2 &&
            row.keyword.toLowerCase().includes(word.toLowerCase()),
        )
    )
      continue;
    if (
      rules.forbiddenTerms?.some((word) =>
        row.keyword.toLowerCase().includes(word.toLowerCase()),
      )
    )
      continue;
    const previous = Number(row.previous);
    const delta =
      row.previous && Number.isFinite(previous) ? previous - position : 0;
    const trend = !row.previous
      ? "unknown"
      : delta > 1
        ? "rising"
        : delta < -1
          ? "declining"
          : "stable";
    const difficulty =
      row.difficulty && Number.isFinite(Number(row.difficulty))
        ? Number(row.difficulty)
        : 50;
    const score =
      Math.round(
        (Math.max(0, (21 - position) / 17) * 20 +
          (Math.log10(Math.max(volume, 1) + 1) / Math.log10(5001)) * 55 +
          Math.max(0, (100 - difficulty) / 100) * 15 +
          Math.min(Math.max(delta / 5, -1), 1) * 10) *
          10,
      ) / 10;
    const decision =
      trend === "rising" ||
      (position <= 10 && volume >= 200) ||
      (position <= 5 && volume >= 100)
        ? "OPTIMISE"
        : trend === "declining" && volume < 200 && position > 10
          ? "REPLACE"
          : "MONITOR";
    group.keywords.push({
      keyword: row.keyword,
      position,
      searchVolume: volume,
      score,
      trend,
      decision,
    });
  }
  return sort(
    [...groups.entries()].flatMap(([url, group]) => {
      const crawl = crawls.get(url);
      const keywords = sort(group.keywords, (a, b) => b.score - a.score);
      const actionable = keywords.filter((keyword) => {
        if (!crawl?.title || !crawl.meta) return true;
        const words = keyword.keyword
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => word.length > 3);
        return (
          !words.length ||
          words.filter((word) => crawl.title.toLowerCase().includes(word))
            .length /
            words.length <
            0.75 ||
          words.filter((word) => crawl.meta.toLowerCase().includes(word))
            .length /
            words.length <
            0.75
        );
      });
      const primary = actionable[0];
      if (!primary) return [];
      return [
        {
          url,
          primaryKeyword: primary.keyword,
          protectedCount: group.protected.length,
          keywords,
          currentTitle: crawl?.title ?? "",
          currentMeta: crawl?.meta ?? "",
          currentH1: crawl?.h1 ?? "",
          totalOpportunity: group.keywords.reduce(
            (sum, keyword) => sum + keyword.score,
            0,
          ),
          ...recommendation(primary.keyword, rules),
        },
      ];
    }),
    (a, b) => b.totalOpportunity - a.totalOpportunity,
  );
}
