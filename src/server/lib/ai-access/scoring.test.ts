import { expect, it } from "vitest";
import { computeOverall } from "./scoring";

it("weights pillars and rounds at the half boundary", () => {
  expect(computeOverall(1, 1, 1, 1)).toBe(1);
  expect(computeOverall(2, 0, 0, 0)).toBe(1);
  expect(computeOverall(0, 0, 0, 0)).toBe(0);
});
