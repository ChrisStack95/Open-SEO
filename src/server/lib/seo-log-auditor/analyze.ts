import { sort } from "remeda";

const nginxLine =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^"]*?)\s+(HTTP\/[\d.]+)"\s+(\d{3})\s+(\d+|-)\s+"([^"]*)"\s+"([^"]*)"(?:\s+(\d+|-)\s+([\d.]+|-))?/;

const googleBots = [
  "Googlebot-Image",
  "Googlebot-Video",
  "Googlebot-News",
  "AdsBot-Google",
  "Mediapartners-Google",
  "Googlebot",
] as const;

function directory(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 1 ? `/${segments[0]}/` : "/";
}

export function analyzeAccessLogs(text: string) {
  const bots: Record<string, number> = {};
  const statuses: Record<string, number> = {};
  const statusClasses: Record<string, number> = {};
  const days: Record<string, number> = {};
  const dirs = new Map<string, { hits: number; non_200: number }>();
  let totalHits = 0;
  let non200 = 0;
  let skippedLines = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = nginxLine.exec(line.trim());
    if (!match) {
      skippedLines++;
      continue;
    }
    const agent = match[9];
    const bot = googleBots.find((name) =>
      agent.toLowerCase().includes(name.toLowerCase()),
    );
    if (!bot) continue;
    const status = Number(match[6]);
    const path = (match[4] || "/").split("?", 1)[0];
    const group = directory(path);
    const existing = dirs.get(group) ?? { hits: 0, non_200: 0 };
    existing.hits++;
    if (status !== 200) {
      existing.non_200++;
      non200++;
    }
    dirs.set(group, existing);
    totalHits++;
    bots[bot] = (bots[bot] ?? 0) + 1;
    statuses[status] = (statuses[status] ?? 0) + 1;
    const statusClass =
      status >= 200 && status < 600 ? `${Math.floor(status / 100)}xx` : "other";
    statusClasses[statusClass] = (statusClasses[statusClass] ?? 0) + 1;
    const time =
      /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):\d{2}:\d{2}:\d{2} ([+-]\d{4})$/.exec(
        match[2],
      );
    if (time) {
      const date = new Date(
        `${time[2]} ${time[1]}, ${time[3]} 00:00:00 GMT${time[4]}`,
      );
      if (!Number.isNaN(date.getTime())) {
        const key = date.toISOString().slice(0, 10);
        days[key] = (days[key] ?? 0) + 1;
      }
    }
  }

  return {
    totalHits,
    skippedLines,
    bots,
    statuses,
    statusClasses,
    waste: {
      total: totalHits,
      non_200: non200,
      waste_ratio: totalHits ? non200 / totalHits : 0,
    },
    directories: sort(
      [...dirs.entries()].map(([name, data]) => ({
        directory: name,
        ...data,
        waste_ratio: data.non_200 / data.hits,
      })),
      (a, b) => b.hits - a.hits || a.directory.localeCompare(b.directory),
    ),
    dailyHits: sort(Object.entries(days), ([a], [b]) => a.localeCompare(b)).map(
      ([date, hits]) => ({ date, hits }),
    ),
  };
}
