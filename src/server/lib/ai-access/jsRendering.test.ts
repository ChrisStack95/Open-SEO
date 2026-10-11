import { expect, it } from "vitest";
import { checkJsRendering } from "./jsRendering";

it("applies the high-risk and JavaScript-required penalties to an empty framework page", () => {
  const result = checkJsRendering(
    '<div id="root"></div><noscript>Enable JavaScript</noscript><script src="/chunk.js"></script><script src="/bundle.js"></script><script src="/webpack.js"></script><script src="/app.js"></script>',
  );
  expect(result.score).toBe(5);
});

it("penalizes product elements without prices", () => {
  const html = `<title>Catalog</title><nav><a href="/">Home</a></nav><h1>Catalog</h1><div class="product">${"Shoes ".repeat(100)}</div>`;
  expect(checkJsRendering(html).riskFactors).toContain(
    "Product elements detected but no prices in HTML",
  );
});
