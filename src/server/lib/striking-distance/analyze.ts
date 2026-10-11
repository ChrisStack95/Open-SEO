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
  const plainText = (text: string) =>
    text.replace(/<[^>]*>/g, " ").replace(/[<>\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const forbidden = (rules.forbiddenTerms ?? []).map(plainText).filter(Boolean);
  const containsForbidden = (text: string) =>
    forbidden.some((term) => text.toLowerCase().includes(term.toLowerCase()));
  const safeKeyword = plainText(keyword);
  const target = safeKeyword && !containsForbidden(safeKeyword) ? safeKeyword : "Explore our range";
  const suffix = plainText(rules.titleSuffix ?? "");
  const fullTitle = suffix && !containsForbidden(suffix) ? `${target} – ${suffix}` : target;
  const titleCandidate = fullTitle.length <= 60 ? fullTitle : target;
  const title = titleCandidate.length <= 60
    ? titleCandidate
    : titleCandidate.slice(0, 61).replace(/\s+\S*$/, "").trim();
  const vocabulary = (rules.preferredVocabulary ?? []).map(plainText).find(
    (term) => term && !containsForbidden(term),
  );
  const brand = plainText(rules.brandName ?? "");
  const meta = `Explore ${target}${vocabulary ? ` and ${vocabulary}` : ""}${brand && !containsForbidden(brand) ? ` from ${brand}` : ""}.`;
  const cap = rules.metaLengthCap ?? 155;
  const bounded = meta.length <= cap ? meta : meta.slice(0, cap + 1).replace(/\s+\S*$/, "").trim();
  return {
    recommendedTitle: title,
    recommendedMeta: bounded,
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
    { protected: Set<string>; keywords: Keyword[] }
  >();
  const rules = input.brandRules ?? {};
  for (const row of rankingRows) {
    const url = normalizedUrl(row.url);
    const position = Number(row.position);
    const volume = Number(row.volume);
    if (!row.keyword.trim() || !url || !Number.isFinite(position)) continue;
    const group = groups.get(url) ?? { protected: new Set<string>(), keywords: [] };
    groups.set(url, group);
    if (position <= 3) {
      group.protected.add(row.keyword.toLowerCase());
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
    const trendValues = row.trends?.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const trendFromVolume = (() => {
      if (trendValues.length < 6) return null;
      const early = (trendValues[0] + trendValues[1] + trendValues[2]) / 3;
      const recent = (trendValues.slice(-3).reduce((sum, value) => sum + value, 0)) / 3;
      if (early === 0) return recent > 0 ? "new" : "stable";
      const change = (recent - early) / early;
      return change > 0.15 ? "rising" : change < -0.15 ? "declining" : "stable";
    })();
    const trend = trendFromVolume ?? (!row.previous
      ? "unknown"
      : previous === 0
        ? "new"
        : delta > 1
          ? "rising"
          : delta < -1
            ? "declining"
            : "stable");
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
          (group.protected.has(row.keyword.toLowerCase()) ? 1 : 10),
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
        const title = crawl.title.toLowerCase();
        const meta = crawl.meta.toLowerCase();
        const phrase = keyword.keyword.toLowerCase();
        if (!words.length) {
          return !(title.includes(phrase) && meta.includes(phrase));
        }
        const titleMatches = words.filter((word) => title.includes(word))
          .length;
        const metaMatches = words.filter((word) => meta.includes(word)).length;
        return (
          titleMatches / words.length < 0.75 ||
          metaMatches / words.length < 0.75
        );
      });
      const primary = actionable[0];
      if (!primary) return [];
      return [
        {
          url,
          primaryKeyword: primary.keyword,
          protectedCount: group.protected.size,
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
