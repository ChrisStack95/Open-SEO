import { expect, it } from "vitest";
import { checkSchema } from "./schemaCheck";

it("flattens graph and array types", () => {
  const result = checkSchema(
    `<script type="application/ld+json">{"@graph":[{"@type":["WebSite","Organization"],"name":"Example"},{"@type":"Product","name":"Shoe"}]}</script>`,
  );
  expect(result.typesFound).toEqual(
    expect.arrayContaining(["WebSite", "Organization", "Product"]),
  );
  expect(
    result.validations.find((v) => v.type === "Product")?.completeness,
  ).toBe(17);
  expect(result.score).toBeGreaterThanOrEqual(40);
});
