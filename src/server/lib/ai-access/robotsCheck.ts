import robotsParser from "robots-parser";
import { AI_BOTS, BROWSER_UA, SENSITIVE_PATHS } from "./bots";

export function checkRobots(origin: string, text: string | null) {
  const url = new URL("/robots.txt", origin).toString();
  if (text === null)
    return {
      found: false,
      url,
      raw: "",
      sitemaps: [] as string[],
      aiAgents: {} as Record<
        string,
        { company: string; ua: string; robotsAllowed: boolean }
      >,
      sensitivePaths: {} as Record<
        string,
        { accessiblePerRobots: boolean; mentionedInRobots: boolean }
      >,
      blockedResources: [] as string[],
      score: 0,
    };
  const parser = robotsParser(url, text);
  const allowed = (path: string, ua: string) =>
    parser.isAllowed(new URL(path, origin).toString(), ua) ?? true;
  const aiAgents: Record<
    string,
    { company: string; ua: string; robotsAllowed: boolean }
  > = {};
  for (const [company, bots] of Object.entries(AI_BOTS))
    for (const [name, ua] of Object.entries(bots))
      aiAgents[name] = { company, ua, robotsAllowed: allowed("/", name) };
  const sensitivePaths: Record<
    string,
    { accessiblePerRobots: boolean; mentionedInRobots: boolean }
  > = {};
  for (const path of SENSITIVE_PATHS)
    sensitivePaths[path] = {
      accessiblePerRobots: allowed(path, BROWSER_UA),
      mentionedInRobots: text.toLowerCase().includes(path.toLowerCase()),
    };
  const blockedResources = [
    ".css",
    ".js",
    "/css/",
    "/js/",
    "/static/",
    "/assets/",
  ].filter((path) => !allowed(path, BROWSER_UA));
  const sitemaps = parser.getSitemaps();
  const specific = Object.keys(aiAgents).filter((name) =>
    new RegExp(
      `^user-agent:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
      "im",
    ).test(text),
  ).length;
  const blocked = Object.values(sensitivePaths).filter(
    (entry) => !entry.accessiblePerRobots,
  ).length;
  const exposedMentioned = Object.values(sensitivePaths).filter(
    (entry) => entry.accessiblePerRobots && entry.mentionedInRobots,
  ).length;
  let score =
    50 +
    (specific > 3 ? 15 : specific > 0 ? 10 : 0) +
    (sitemaps.length ? 10 : 0) +
    (blocked > SENSITIVE_PATHS.length / 2 ? 10 : blocked ? 5 : 0) +
    (blockedResources.length ? -10 : 10) -
    (exposedMentioned > 3 ? 10 : 0);
  score = Math.max(0, Math.min(100, score));
  return {
    found: true,
    url,
    raw: text,
    sitemaps,
    aiAgents,
    sensitivePaths,
    blockedResources,
    score,
  };
}
