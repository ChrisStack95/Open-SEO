import { describe, expect, it } from "vitest";
import { analyzeStrikingDistance } from "./analyze";

describe("analyzeStrikingDistance", () => {
  it("filters positions 4 through 20 inclusive and joins page data by normalized URL", () => {
    const result = analyzeStrikingDistance({
      rankingsCsv:
        "Keyword,Position,Search Volume,URL,Previous Position\n" +
        "first,3,100,/p/,4\nfour,4,200,https://example.com/p/,5\n" +
        "ten,10,100,https://example.com/p,11\ntwenty,20,50,https://example.com/p,20\n" +
        "twentyone,21,100,https://example.com/p,21",
      crawlCsv:
        "Address,Title 1,Meta Description 1,H1-1,Indexability,Status Code\n" +
        "https://example.com/p/,Page title,Useful description,Heading,Indexable,200",
    });
    expect(result).toHaveLength(1);
    expect(result[0].keywords.map((keyword) => keyword.keyword)).toEqual([
      "four",
      "ten",
      "twenty",
    ]);
    expect(result[0]).toMatchObject({
      url: "https://example.com/p",
      currentTitle: "Page title",
      currentMeta: "Useful description",
      currentH1: "Heading",
    });
  });

  it("respects brand rules in deterministic title and meta templates", () => {
    const result = analyzeStrikingDistance({
      rankingsCsv:
        "Keyword,Position,Search Volume,URL\nwireless speaker,4,300,https://example.com/speakers",
      brandRules: {
        brandName: "Acme Audio",
        titleSuffix: "Acme",
        forbiddenTerms: ["cheap", "best"],
        preferredVocabulary: ["sound"],
        metaLengthCap: 70,
      },
    });
    expect(result[0].recommendedTitle).toContain("Acme");
    expect(result[0].recommendedMeta.toLowerCase()).not.toMatch(/cheap|best/);
    expect(result[0].recommendedMeta.length).toBeLessThanOrEqual(70);
    expect(result[0].recommendedMeta.toLowerCase()).toContain("sound");
  });

  it("parses quoted commas, escaped quotes, newlines and TSV fields", () => {
    const result = analyzeStrikingDistance({
      rankingsCsv:
        'Keyword\tPosition\tSearch Volume\tURL\r\n"speaker, portable"\t6\t100\thttps://example.com/p\r\n',
    });
    expect(result[0].keywords[0].keyword).toBe("speaker, portable");
  });
});
