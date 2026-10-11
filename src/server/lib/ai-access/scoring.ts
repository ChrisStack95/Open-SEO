export const BENCHMARKS = {
  js: 60,
  llmTxt: 0,
  robots: 80,
  schema: 50,
} as const;

export function computeOverall(
  js: number,
  llm: number,
  robots: number,
  schema: number,
): number {
  return Math.round(js * 0.25 + llm * 0.15 + robots * 0.3 + schema * 0.3);
}
