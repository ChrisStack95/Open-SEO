import * as cheerio from "cheerio";

export function checkPageMeta(html: string, xRobotsTag: string | null) {
  const $ = cheerio.load(html);
  const metaTags: { name: string; content: string }[] = [];
  $("meta[name]").each((_, el) => {
    const name = ($(el).attr("name") ?? "").toLowerCase();
    if (
      [
        "robots",
        "googlebot",
        "google-extended",
        "googlebot-news",
        "bingbot",
      ].includes(name)
    )
      metaTags.push({ name, content: $(el).attr("content") ?? "" });
  });
  return {
    metaTags,
    xRobotsTag,
    nosnippetElements: $("[data-nosnippet]").length,
    htmlLength: html.length,
    textLength: $.root().text().trim().length,
  };
}
