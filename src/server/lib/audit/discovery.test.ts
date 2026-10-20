import { describe, expect, it, vi } from "vitest";
import { discoverUrls, parseRobotsTxt } from "@/server/lib/audit/discovery";

function sitemapXml(urls: string[]): string {
  const entries = urls.map((url) => `<url><loc>${url}</loc></url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${entries}</urlset>`;
}

describe("discoverUrls", () => {
  // Seeding the frontier is what sets a page's in-sitemap flag, so a URL
  // dropped here reports inSitemap: false once the crawl reaches it through a
  // link. Real sitemaps bury the homepage in the middle of the list
  // (bannerbear.com lists it 387th of 1,328).
  it("returns sitemap URLs listed past the crawl's page budget", async () => {
    const posts = Array.from(
      { length: 5 },
      (_, index) => `https://example.com/blog/post-${index}/`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/robots.txt")
            ? new Response("User-agent: *\nAllow: /")
            : new Response(sitemapXml([...posts, "https://example.com/"]), {
                headers: { "content-type": "application/xml" },
              }),
        ),
      ),
    );

    const { urls } = await discoverUrls("https://example.com", 2);

    expect(urls).toContain("https://example.com/");
  });
});

const ORIGIN = "https://example.com";

describe("parseRobotsTxt", () => {
  it("honors a group that names the crawler", () => {
    const robots = parseRobotsTxt(
      ORIGIN,
      ["User-agent: OpenSEO-Audit", "Disallow: /private/"].join("\n"),
    );

    expect(robots.isAllowed(`${ORIGIN}/private/report`)).toBe(false);
  });

  it("honors an allowance the crawler is named in", () => {
    const robots = parseRobotsTxt(
      ORIGIN,
      [
        "User-agent: *",
        "Disallow: /",
        "",
        "User-agent: OpenSEO-Audit",
        "Allow: /",
      ].join("\n"),
    );

    expect(robots.isAllowed(`${ORIGIN}/pricing`)).toBe(true);
  });

  it("falls back to the wildcard group when the crawler is not named", () => {
    const robots = parseRobotsTxt(
      ORIGIN,
      ["User-agent: *", "Disallow: /admin/"].join("\n"),
    );

    expect(robots.isAllowed(`${ORIGIN}/admin/settings`)).toBe(false);
    expect(robots.isAllowed(`${ORIGIN}/pricing`)).toBe(true);
  });
});
