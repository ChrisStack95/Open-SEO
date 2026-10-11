import * as cheerio from "cheerio";

export const EXPECTED_SCHEMA_TYPES = {
  site_wide: ["Organization", "WebSite", "WebPage", "BreadcrumbList"],
  product: ["Product", "Offer", "Brand", "AggregateRating", "Review"],
  article: ["Article", "NewsArticle", "BlogPosting"],
  faq: ["FAQPage", "Question", "Answer"],
  local: ["LocalBusiness", "Store", "Place"],
  collection: ["ItemList", "CollectionPage", "ProductCollection"],
};
export const SCHEMA_KEY_FIELDS: Record<string, string[]> = {
  Product: ["name", "description", "image", "sku", "brand", "offers"],
  Offer: ["price", "priceCurrency", "availability", "url"],
  Organization: ["name", "url", "logo", "contactPoint"],
  WebSite: ["name", "url", "potentialAction"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  Article: ["headline", "author", "datePublished", "image"],
  BlogPosting: ["headline", "author", "datePublished", "image"],
  AggregateRating: ["ratingValue", "reviewCount"],
  Review: ["author", "reviewRating", "reviewBody"],
  LocalBusiness: ["name", "address", "telephone", "openingHours"],
  ItemList: ["itemListElement", "numberOfItems"],
};

type SchemaData = Record<string, unknown>;
const isObject = (value: unknown): value is SchemaData =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function flatten(value: unknown, types: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, types);
    return;
  }
  if (!isObject(value)) return;
  const names = value["@type"];
  if (typeof names === "string") types.add(names);
  if (Array.isArray(names))
    for (const name of names) if (typeof name === "string") types.add(name);
  for (const child of Object.values(value)) flatten(child, types);
}
export function checkSchema(html: string) {
  const $ = cheerio.load(html);
  const schemas: { format: string; type: string; data: SchemaData }[] = [];
  const types = new Set<string>();
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const data: unknown = JSON.parse($(element).html() ?? "");
      flatten(data, types);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items)
        if (isObject(item)) {
          const entries = Array.isArray(item["@graph"])
            ? item["@graph"]
            : [item];
          for (const entry of entries)
            if (isObject(entry))
              schemas.push({
                format: "JSON-LD",
                type: Array.isArray(entry["@type"])
                  ? entry["@type"].join(", ")
                  : String(entry["@type"] ?? "Unknown"),
                data: entry,
              });
        }
    } catch {
      schemas.push({ format: "JSON-LD", type: "Parse Error", data: {} });
    }
  });
  $("[itemscope]")
    .slice(0, 10)
    .each((_, element) => {
      const type =
        ($(element).attr("itemtype") ?? "Unknown").split("/").at(-1) ??
        "Unknown";
      schemas.push({ format: "Microdata", type, data: {} });
      types.add(type);
    });
  const validations = schemas
    .filter(
      (item) => item.type !== "Parse Error" && Object.keys(item.data).length,
    )
    .map((item) => {
      const expected = SCHEMA_KEY_FIELDS[item.type.split(",")[0].trim()] ?? [];
      const present = expected.filter((field) => Boolean(item.data[field]));
      return {
        type: item.type,
        expected,
        present,
        missing: expected.filter((field) => !present.includes(field)),
        completeness: expected.length
          ? Math.round((present.length / expected.length) * 100)
          : 100,
      };
    });
  const coverage = Object.fromEntries(
    Object.entries(EXPECTED_SCHEMA_TYPES).map(([category, expected]) => {
      const found = expected.filter((type) => types.has(type));
      return [
        category,
        {
          expected,
          found,
          missing: expected.filter((type) => !types.has(type)),
          coveragePct: Math.round((found.length / expected.length) * 100),
        },
      ];
    }),
  );
  const average = validations.length
    ? validations.reduce((sum, item) => sum + item.completeness, 0) /
      validations.length
    : 50;
  const score = schemas.length
    ? Math.min(
        100,
        30 +
          Math.round(average * 0.3) +
          Math.round(coverage.site_wide.coveragePct * 0.2) +
          (schemas.length >= 3 ? 10 : 0) +
          (schemas.some((s) => s.type === "Product" || s.type === "Offer")
            ? 10
            : 0),
      )
    : 0;
  return {
    found: schemas.length > 0,
    schemas,
    typesFound: [...types],
    validations,
    coverage,
    score,
  };
}
