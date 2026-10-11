import { load } from "cheerio";

export type DeadPage = {
  url: string;
  bucket: "collection" | "page" | "blog";
  status: number;
  productCount: number;
  mainLength: number;
  wordCount: number;
  title?: string;
  challenged?: boolean;
  error?: string;
};

export function parseDeadPageHtml(html: string) {
  const $ = load(html);
  const main = $("main")
    .first()
    .find("*")
    .addBack()
    .contents()
    .map((_, node) => ("data" in node ? node.data : ""))
    .get()
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const products = $("[data-product-id]").length;
  return {
    productCount: products || $(".product-item").length,
    mainLength: main.length,
    wordCount: main ? main.split(/\s+/).length : 0,
    title: $("title").first().text().trim().slice(0, 200),
    challenged: [
      "Just a moment",
      "cf-chl-bypass",
      "Checking your browser",
      "cf-browser-verification",
    ].some((value) => html.includes(value)),
  };
}

export function analyseDeadPages(pages: DeadPage[]) {
  return pages.map((page) => {
    const url = page.url.toLowerCase();
    const reviewReasons =
      page.bucket === "collection" &&
      page.status === 200 &&
      page.productCount === 0
        ? [
            page.mainLength >= 500 && "rich-editorial-main",
            /(?:^|\D)(?:2025|2026|2027)(?:\D|$)/.test(url) && "future-dated",
            /(draft|preorder|pre-order|coming-soon|launch|debut|reveal)/.test(
              url,
            ) && "pre-launch",
            /(?:\bx-|-x-|\bcollab|collaboration)/.test(url) && "collaboration",
            /(?:\/test\b|\/staging|\/sandbox|\/dev-)/.test(url) &&
              "test-or-staging",
          ].filter((reason): reason is string => typeof reason === "string")
        : [];
    const classification =
      page.error ||
      page.challenged ||
      (page.status !== 200 && page.status !== 404)
        ? "fetch_issue"
        : page.bucket === "collection" &&
            (page.status === 404 || page.productCount === 0)
          ? reviewReasons.length
            ? "review_before_deleting"
            : "empty_collection"
          : page.bucket !== "collection" &&
              page.status === 200 &&
              (page.wordCount < 100 || page.mainLength < 50)
            ? "thin"
            : "healthy";
    return { ...page, classification, reviewReasons };
  });
}
