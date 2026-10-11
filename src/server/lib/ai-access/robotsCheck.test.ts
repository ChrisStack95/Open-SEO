import { expect, it } from "vitest";
import { checkRobots } from "./robotsCheck";

it("blocks GPTBot only when its group disallows the homepage", () => {
  const result = checkRobots(
    "https://example.com",
    "User-agent: GPTBot\nDisallow: /\n",
  );
  expect(result.aiAgents.GPTBot.robotsAllowed).toBe(false);
  expect(result.aiAgents.ClaudeBot.robotsAllowed).toBe(true);
});
it("penalizes blocked resources", () => {
  const result = checkRobots(
    "https://example.com",
    "User-agent: *\nDisallow: /css/\nDisallow: /js/\n",
  );
  expect(result.blockedResources).toContain("/css/");
  expect(result.score).toBeLessThan(60);
});
it("credits protection of sensitive paths", () => {
  const result = checkRobots(
    "https://example.com",
    "User-agent: *\nDisallow: /admin\n",
  );
  expect(result.sensitivePaths["/admin"].accessiblePerRobots).toBe(false);
  expect(result.score).toBeGreaterThan(60);
});
