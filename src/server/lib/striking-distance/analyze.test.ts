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

  it("downweights a keyword that also has a protected top-three ranking before selecting a primary", () => {
    const result = analyzeStrikingDistance({
      rankingsCsv:
        "Keyword,Position,Search Volume,URL\n" +
        "protected phrase,2,2000,https://example.com/page\n" +
        "protected phrase,4,2000,https://example.com/page\n" +
        "new phrase,8,300,https://example.com/page",
    });
    expect(result[0].primaryKeyword).toBe("new phrase");
    expect(result[0].keywords[0].keyword).toBe("new phrase");
    expect(result[0].keywords[1].score).toBeLessThan(
      result[0].keywords[0].score,
    );
  });

  it("prefers Semrush search-volume Trends over a conflicting position movement", () => {
    const result = analyzeStrikingDistance({
      rankingsCsv:
        "Keyword,Position,Search Volume,URL,Previous Position,Trends\n" +
        'growing topic,12,100,https://example.com/page,8,"[10,10,10,40,40,40]"',
    });
    expect(result[0].keywords[0]).toMatchObject({
      trend: "rising",
      decision: "OPTIMISE",
    });
  });

  it("retains short keywords unless the whole phrase appears in both title and meta", () => {
    const result = analyzeStrikingDistance({
      rankingsCsv:
        "Keyword,Position,Search Volume,URL\ncat,6,100,https://example.com/page",
      crawlCsv:
        "Address,Title 1,Meta Description 1\nhttps://example.com/page,Cat supplies,Dog care",
    });
    expect(result[0].primaryKeyword).toBe("cat");
  });

  it("emits plain-text-safe drafts from untrusted keywords and brand rules", () => {
    const result = analyzeStrikingDistance({
      rankingsCsv:
        'Keyword,Position,Search Volume,URL\n"<script>alert</script>",4,300,https://example.com/page',
      brandRules: {
        titleSuffix: "<b>Brand</b>\u0007",
        brandName: "Shop<online>",
      },
    });
    expect(result[0].recommendedTitle).not.toMatch(/[<>\p{Cc}]/u);
    expect(result[0].recommendedMeta).not.toMatch(/[<>\p{Cc}]/u);
  });

  it("drops an overlong suffix rather than cutting a keyword mid-word", () => {
    const keyword =
      "wonderful speakers with outstanding immersive audio quality";
    const result = analyzeStrikingDistance({
      rankingsCsv: `Keyword,Position,Search Volume,URL\n${keyword},4,300,https://example.com/page`,
      brandRules: {
        titleSuffix: "A Particularly Long Brand Name",
        forbiddenTerms: ["particularly"],
      },
    });
    expect(result[0].recommendedTitle).toBe(keyword);
    expect(result[0].recommendedTitle).not.toContain("Particularly");
  });

  it("parses quoted commas, escaped quotes, newlines and TSV fields", () => {
    const result = analyzeStrikingDistance({
      rankingsCsv:
        'Keyword\tPosition\tSearch Volume\tURL\r\n"speaker, portable"\t6\t100\thttps://example.com/p\r\n',
    });
    expect(result[0].keywords[0].keyword).toBe("speaker, portable");
  });
});
