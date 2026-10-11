import { describe, expect, it } from "vitest";
import { analyzeAccessLogs } from "./analyze";

const line = (path: string, status: number, agent: string, day = "01") =>
  `127.0.0.1 - - [${day}/Jan/2026:12:00:00 +0000] "GET ${path} HTTP/1.1" ${status} 123 "-" "${agent}"`;

describe("analyzeAccessLogs", () => {
  it("counts only claimed Googlebot variants, with the source's subtype precedence", () => {
    const result = analyzeAccessLogs(
      [
        line("/a", 200, "Googlebot-Image"),
        line("/a", 200, "Googlebot-Video"),
        line("/a", 200, "Googlebot-News"),
        line("/a", 200, "AdsBot-Google"),
        line("/a", 200, "Mediapartners-Google"),
        line("/a", 200, "googlebot"),
        line("/a", 200, "bingbot"),
        line("/a", 200, "Mozilla/5.0"),
      ].join("\n"),
    );
    expect(result.totalHits).toBe(6);
    expect(result.bots).toEqual({
      "Googlebot-Image": 1,
      "Googlebot-Video": 1,
      "Googlebot-News": 1,
      "AdsBot-Google": 1,
      "Mediapartners-Google": 1,
      Googlebot: 1,
    });
  });

  it("calculates non-200 waste and status classes including non-200 2xx", () => {
    const result = analyzeAccessLogs(
      [
        line("/a", 200, "Googlebot"),
        line("/a", 204, "Googlebot"),
        line("/b", 301, "Googlebot"),
        line("/b", 404, "Googlebot"),
      ].join("\n"),
    );
    expect(result.waste).toEqual({ total: 4, non_200: 3, waste_ratio: 0.75 });
    expect(result.statusClasses).toEqual({ "2xx": 2, "3xx": 1, "4xx": 1 });
  });

  it("aggregates directories and daily crawl frequency from parsed paths", () => {
    const result = analyzeAccessLogs(
      [
        line("/products/a?x=1", 200, "Googlebot"),
        line("/products/b", 404, "Googlebot", "02"),
        line("/", 200, "Googlebot"),
        "malformed",
      ].join("\n"),
    );
    expect(result.directories).toEqual([
      { directory: "/products/", hits: 2, non_200: 1, waste_ratio: 0.5 },
      { directory: "/", hits: 1, non_200: 0, waste_ratio: 0 },
    ]);
    expect(result.dailyHits).toEqual([
      { date: "2026-01-01", hits: 2 },
      { date: "2026-01-02", hits: 1 },
    ]);
    expect(result.skippedLines).toBe(1);
  });
});
