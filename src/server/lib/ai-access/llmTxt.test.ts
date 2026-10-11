import { expect, it } from "vitest";
import { checkLlmTxt } from "./llmTxt";

const base = "https://example.com";
it("rejects HTML at the llms path", () => {
  expect(
    checkLlmTxt(base, {
      "/llms.txt": {
        url: base + "/llms.txt",
        status: 200,
        text: "<html>Not found</html>",
      },
    }).score,
  ).toBe(0);
});
it("scores absent, bare and complete files", () => {
  expect(checkLlmTxt(base, {}).score).toBe(0);
  expect(
    checkLlmTxt(base, {
      "/llms.txt": {
        url: base + "/llms.txt",
        status: 200,
        text: "A simple statement about this website",
      },
    }).score,
  ).toBe(50);
  const text = `# Title\n\nDescription of the site.\n\nPages\n\nhttps://example.com\n\n${"Details ".repeat(80)}`;
  expect(
    checkLlmTxt(base, {
      "/llms.txt": { url: base + "/llms.txt", status: 200, text },
    }).score,
  ).toBe(100);
});
