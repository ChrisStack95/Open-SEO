import { describe, expect, it } from "vitest";
import { analyseDeadPages, parseDeadPageHtml } from "./dead-page-checker";

describe("dead page checker", () => {
  it("counts product markers and main text in supplied HTML", () => {
    const parsed = parseDeadPageHtml(
      "<title>Shop</title><main><div data-product-id='1'>Shoe</div><div data-product-id='2'>Boot</div></main>",
    );
    expect(parsed.productCount).toBe(2);
    expect(parsed.wordCount).toBe(2);
  });
  it("flags editorial collections for review instead of safe deletion", () => {
    const [row] = analyseDeadPages([
      {
        url: "https://example.com/collections/launch-2026",
        bucket: "collection",
        status: 200,
        productCount: 0,
        mainLength: 501,
        wordCount: 90,
      },
    ]);
    expect(row.classification).toBe("review_before_deleting");
    expect(row.reviewReasons).toContain("rich-editorial-main");
  });
  it("distinguishes thin pages and unavailable fetches", () => {
    const rows = analyseDeadPages([
      {
        url: "https://example.com/a",
        bucket: "page",
        status: 200,
        productCount: 0,
        mainLength: 20,
        wordCount: 5,
      },
      {
        url: "https://example.com/b",
        bucket: "blog",
        status: 503,
        productCount: 0,
        mainLength: 0,
        wordCount: 0,
      },
    ]);
    expect(rows.map((row) => row.classification)).toEqual([
      "thin",
      "fetch_issue",
    ]);
  });
});
