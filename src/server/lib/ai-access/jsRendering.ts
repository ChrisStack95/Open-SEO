import * as cheerio from "cheerio";

export function checkJsRendering(html: string) {
  const $ = cheerio.load(html);
  const frameworks: {
    name: string;
    risk: "high" | "medium";
    reason: string;
  }[] = [];
  const root = $("#root, #__next, #app").first();
  if (root.length && root.text().trim().length < 50)
    frameworks.push({
      name: "React / Next.js",
      risk: "high",
      reason: "Empty root container",
    });
  if ($("#__nuxt, [data-v-app]").length)
    frameworks.push({
      name: "Vue.js / Nuxt",
      risk: "high",
      reason: "Vue app container",
    });
  if ($("[ng-app], app-root").length)
    frameworks.push({
      name: "Angular",
      risk: "high",
      reason: "Angular app root",
    });
  const warnings = $("noscript").filter((_, el) =>
    /enable javascript|requires javascript/i.test($(el).text()),
  );
  if (warnings.length)
    frameworks.push({
      name: "JavaScript Required",
      risk: "high",
      reason: `${warnings.length} noscript warning(s)`,
    });
  const bundled = $("script[src]").filter((_, el) =>
    /chunk|bundle|webpack|main\.|app\./.test($(el).attr("src") ?? ""),
  );
  if (bundled.length > 3)
    frameworks.push({
      name: "Bundled JS (Webpack/Vite)",
      risk: "medium",
      reason: `${bundled.length} bundled script(s)`,
    });
  const text = $.root().text();
  const prices = [...new Set(text.match(/[\$£€]\s?\d+[\.,]?\d*/g) ?? [])].slice(
    0,
    20,
  );
  if (!prices.length)
    $(
      "[class*='price'], [class*='cost'], [class*='amount'], [itemprop='price']",
    )
      .slice(0, 10)
      .each((_, el) => {
        const value = $(el).text().trim();
        if (value) prices.push(value);
      });
  const productElements = $("[class]").filter((_, el) =>
    /product|item|card/i.test($(el).attr("class") ?? ""),
  ).length;
  const content = {
    title: $("title").first().text().trim(),
    h1Tags: $("h1")
      .map((_, el) => $(el).text().trim())
      .get()
      .slice(0, 10),
    navLinks: $("nav a").length,
    productElements,
    prices,
    textLength: $("body").text().trim().length || text.trim().length,
    pagination:
      $("[class], [rel]").filter((_, el) =>
        /pagination|paging|page-numbers|next|prev/i.test(
          `${$(el).attr("class") ?? ""} ${$(el).attr("rel") ?? ""}`,
        ),
      ).length > 0,
  };
  let score = 100;
  const riskFactors: string[] = [];
  if (frameworks.some((f) => f.risk === "high")) {
    score -= 30;
    riskFactors.push(
      `JS framework detected: ${frameworks
        .filter((f) => f.risk === "high")
        .map((f) => f.name)
        .join(", ")}`,
    );
  }
  if (!content.title) {
    score -= 10;
    riskFactors.push("No <title> tag in raw HTML");
  }
  if (!content.h1Tags.length) {
    score -= 10;
    riskFactors.push("No <h1> tags found in raw HTML");
  }
  if (productElements && !prices.length) {
    score -= 15;
    riskFactors.push("Product elements detected but no prices in HTML");
  }
  if (content.textLength < 200) {
    score -= 20;
    riskFactors.push(`Very little text content (${content.textLength} chars)`);
  } else if (content.textLength < 500) {
    score -= 10;
    riskFactors.push(`Low text content (${content.textLength} chars)`);
  }
  if (!content.navLinks) {
    score -= 10;
    riskFactors.push("No navigation links in raw HTML");
  }
  if (!content.pagination && productElements > 5) {
    score -= 5;
    riskFactors.push("Product listing but no pagination in HTML");
  }
  if (warnings.length) score -= 15;
  return {
    score: Math.max(0, Math.min(100, score)),
    frameworks,
    content,
    riskFactors,
  };
}
