import { describe, expect, it } from "vitest";
import { mapRedirects } from "./redirect-mapping";

describe("mapRedirects", () => {
  it("prefers a unique exact slug in a migration", () => {
    const result = mapRedirects({
      mode: "migration",
      oldPages: [{ url: "https://old.example/a/blue-widget" }],
      newPages: [
        { url: "https://new.example/b/blue-widget" },
        { url: "https://new.example/a/red-widget" },
      ],
    });
    expect(result[0]).toMatchObject({
      target: "https://new.example/b/blue-widget",
      tier: "high",
      score: 1,
    });
  });
  it("maps a retired product to a collection using shared inlinks and ancestors", () => {
    const result = mapRedirects({
      mode: "retirement",
      oldPages: [
        {
          url: "https://example.com/shop/shoes/runner",
          inlinks: ["https://example.com/menu"],
        },
      ],
      newPages: [
        {
          url: "https://example.com/shop/shoes",
          inlinks: ["https://example.com/menu"],
          collection: true,
        },
      ],
    });
    expect(result[0]?.target).toBe("https://example.com/shop/shoes");
  });
  it("does not call weak fuzzy matches high confidence", () => {
    const result = mapRedirects({
      mode: "migration",
      oldPages: [
        { url: "https://old.example/red", title: "Completely unrelated" },
      ],
      newPages: [{ url: "https://new.example/green", title: "Other subject" }],
    });
    expect(result[0]?.tier).not.toBe("high");
  });
});
