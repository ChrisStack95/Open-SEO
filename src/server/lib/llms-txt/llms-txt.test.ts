import { describe, expect, it } from "vitest";
import { generateLlmsTxt } from "./llms-txt";

describe("generateLlmsTxt", () => {
  it("writes a concise index and full content from provided pages only", () => {
    const output = generateLlmsTxt({
      siteName: "Example",
      pages: [
        {
          url: "https://example.com/guides/start",
          title: "Start",
          description: "Getting started",
          content: "Full guide text",
        },
      ],
    });
    expect(output.llmsTxt).toContain(
      "## Guides\n- [Start](https://example.com/guides/start): Getting started",
    );
    expect(output.llmsFullTxt).toContain("Full guide text");
  });
  it("does not invent full content when no snippet is supplied", () => {
    const output = generateLlmsTxt({
      siteName: "Example",
      pages: [{ url: "https://example.com/contact", title: "Contact" }],
    });
    expect(output.llmsFullTxt).not.toContain("undefined");
    expect(output.llmsTxt).toContain("## Contact");
  });
  it("deduplicates canonical destinations and excludes nonindexable pages", () => {
    const output = generateLlmsTxt({
      siteName: "Example",
      pages: [
        {
          url: "https://example.com/a",
          canonical: "https://example.com/main",
          title: "Duplicate",
        },
        { url: "https://example.com/main", title: "Main" },
        { url: "https://example.com/private", indexable: false },
      ],
    });
    expect(output.llmsTxt).not.toContain("/a)");
    expect(output.llmsTxt).not.toContain("/private)");
    expect(output.llmsTxt).toContain("/main)");
  });
});
