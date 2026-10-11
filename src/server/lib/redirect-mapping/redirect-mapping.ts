export type RedirectPage = {
  url: string;
  title?: string;
  h1?: string;
  h2?: string;
  breadcrumb?: string;
  inlinks?: string[];
  collection?: boolean;
};

type RedirectInput = {
  mode: "migration" | "retirement";
  oldPages: RedirectPage[];
  newPages: RedirectPage[];
};

function segments(url: string): string[] {
  try {
    return new URL(url).pathname.toLowerCase().split("/").filter(Boolean);
  } catch {
    return url.toLowerCase().split("/").filter(Boolean);
  }
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const left = a.toLowerCase().trim();
  const right = b.toLowerCase().trim();
  if (left === right) return 1;
  const distances = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let previous = distances[0];
    distances[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const next = distances[j];
      distances[j] = Math.min(
        distances[j] + 1,
        distances[j - 1] + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      previous = next;
    }
  }
  return 1 - distances[right.length] / Math.max(left.length, right.length);
}

function overlap(a: string[] = [], b: string[] = []): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  return union.size
    ? [...left].filter((item) => right.has(item)).length / union.size
    : 0;
}

function ancestor(a: string[], b: string[]): number {
  let shared = 0;
  while (shared < Math.min(a.length, b.length) && a[shared] === b[shared])
    shared++;
  if (shared === b.length && b.length > 0) return 1;
  return shared >= 2 ? 0.7 : shared >= 1 ? 0.3 : 0;
}

function tier(score: number, second: number): "high" | "review" | "no_match" {
  if (score >= 0.9 && score - second >= 0.05) return "high";
  return score >= 0.7 ? "review" : "no_match";
}

export function mapRedirects({ mode, oldPages, newPages }: RedirectInput) {
  return oldPages.map((page) => {
    const oldParts = segments(page.url);
    const oldSlug = oldParts.at(-1);
    const targets =
      mode === "retirement"
        ? newPages.filter((target) => target.collection)
        : newPages;
    if (mode === "migration" && oldSlug) {
      const exact = targets.filter(
        (target) => segments(target.url).at(-1) === oldSlug,
      );
      if (exact.length === 1)
        return {
          source: page.url,
          target: exact[0].url,
          score: 1,
          tier: "high" as const,
          methods: ["exact_slug"],
        };
    }
    const ranked = targets
      .map((target) => {
        const parts = segments(target.url);
        const signals: Record<string, number> =
          mode === "retirement"
            ? {
                inlinks: overlap(page.inlinks, target.inlinks) * 0.4,
                ancestor: ancestor(oldParts, parts) * 0.3,
                text:
                  Math.max(
                    similarity(page.title ?? "", target.title ?? ""),
                    similarity(page.h1 ?? "", target.h1 ?? ""),
                  ) * (page.breadcrumb ? 0.2 : 0.3),
                breadcrumb:
                  similarity(page.breadcrumb ?? "", target.breadcrumb ?? "") *
                  0.1,
              }
            : {
                path:
                  similarity(oldParts.join("/"), parts.join("/")) *
                  (page.inlinks?.length ? 0.1 : 0.15),
                slug: similarity(oldSlug ?? "", parts.at(-1) ?? "") * 0.15,
                title:
                  similarity(page.title ?? "", target.title ?? "") *
                  (page.inlinks?.length ? 0.2 : 0.25),
                h1:
                  similarity(page.h1 ?? "", target.h1 ?? "") *
                  (page.inlinks?.length ? 0.25 : 0.3),
                h2:
                  similarity(page.h2 ?? "", target.h2 ?? "") *
                  (page.inlinks?.length ? 0.1 : 0.15),
                ...(page.inlinks?.length
                  ? { inlinks: overlap(page.inlinks, target.inlinks) * 0.2 }
                  : {}),
              };
        const score = Object.values(signals).reduce(
          (sum, value) => sum + value,
          0,
        );
        return {
          target: target.url,
          score,
          methods: Object.entries(signals)
            .filter(([, value]) => value > 0)
            .map(([key]) => key),
        };
      });
    ranked.sort(
      (a, b) => b.score - a.score || a.target.localeCompare(b.target),
    );
    const best = ranked[0];
    return {
      source: page.url,
      target: best?.target ?? null,
      score: best?.score ?? 0,
      tier: tier(best?.score ?? 0, ranked[1]?.score ?? 0),
      methods: best?.methods ?? [],
    };
  });
}
