import { expect, it } from "vitest";
import { checkPageMeta } from "./pageMeta";
import { checkWellKnown } from "./wellKnown";

it("reads X-Robots-Tag and agent-specific meta", () => {
  const result = checkPageMeta(
    '<meta name="google-extended" content="noindex"><span data-nosnippet>Hidden</span>',
    "noindex, nofollow",
  );
  expect(result.xRobotsTag).toBe("noindex, nofollow");
  expect(result.metaTags).toContainEqual({
    name: "google-extended",
    content: "noindex",
  });
  expect(result.nosnippetElements).toBe(1);
});
it("rejects an HTML fallback at a well-known path", () => {
  expect(
    checkWellKnown("https://example.com", {
      "/.well-known/aip.json": {
        url: "https://example.com/.well-known/aip.json",
        status: 200,
        text: "<!doctype html><html>Missing</html>",
      },
    })["/.well-known/aip.json"].found,
  ).toBe(false);
});
