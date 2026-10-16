import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { expect, it, vi } from "vitest";
import { mapBacklinksRows } from "@/server/features/backlinks/services/backlinksRowMappers";
import { BacklinksTable } from "./BacklinksTable";
import { backlinkPairKey } from "./backlinksPageUtils";

it("distinguishes zero from missing spam scores without changing boundary values", () => {
  const rows = mapBacklinksRows(
    [undefined, null, 0, 39, 40].map((score) => ({
      url_from: "https://openseo.so/",
      backlink_spam_score: score,
    })),
  );
  const html = renderToStaticMarkup(
    createElement(BacklinksTable, {
      rows,
      domainRatings: null,
      sorting: [],
      onSortingChange: vi.fn(),
      expansion: null,
    }),
  );
  const $ = load(html);
  const scores = $("tbody tr")
    .map((_, row) => $(row).find("td").eq(6).text())
    .get();
  expect(scores).toEqual(["-", "-", "0", "39", "40"]);
  expect($("[title='Spam score unknown']")).toHaveLength(2);
});

it("marks the exact tracked pair while keeping provider rows and metrics", () => {
  const rows = mapBacklinksRows([
    {
      url_from: "https://REFERRER.test/article#section",
      url_to: "https://site.test/page?campaign=one",
      rank: 70,
    },
    {
      url_from: "https://referrer.test/article",
      url_to: "https://site.test/page?campaign=two",
      rank: 40,
    },
    {
      url_from: "https://referrer.test/Article",
      url_to: "https://site.test/page?campaign=one",
      rank: 20,
    },
  ]);
  const pair = backlinkPairKey(
    "https://referrer.test/article",
    "https://site.test/page?campaign=one",
  );
  const $ = load(
    renderToStaticMarkup(
      createElement(BacklinksTable, {
        rows,
        domainRatings: null,
        sorting: [],
        onSortingChange: vi.fn(),
        expansion: null,
        trackedPairs: new Set(pair ? [pair] : []),
      }),
    ),
  );
  expect(
    $("tbody tr")
      .map((_, row) => $(row).find("td").eq(3).text())
      .get(),
  ).toEqual(["Tracked", "", ""]);
  expect(
    $("tbody tr")
      .map((_, row) => $(row).find("td").eq(4).text())
      .get(),
  ).toEqual(["70", "40", "20"]);
});
