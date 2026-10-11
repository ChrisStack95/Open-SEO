import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  normalizeAndValidateStartUrl,
  resolveStartUrlRedirects,
} from "@/server/lib/audit/url-policy";
import { analyzeHtml } from "@/server/lib/audit/page-analyzer";
import { AI_BOTS, BROWSER_UA } from "@/server/lib/ai-access/bots";
import { checkJsRendering } from "@/server/lib/ai-access/jsRendering";
import { checkSchema } from "@/server/lib/ai-access/schemaCheck";
import { checkPageMeta } from "@/server/lib/ai-access/pageMeta";
import { checkLlmTxt, LLM_PATHS } from "@/server/lib/ai-access/llmTxt";
import {
  checkWellKnown,
  WELL_KNOWN_PATHS,
} from "@/server/lib/ai-access/wellKnown";
import { checkRobots } from "@/server/lib/ai-access/robotsCheck";
import { computeOverall } from "@/server/lib/ai-access/scoring";
import type {
  AiAccessResults,
  BotCrawlResult,
  FetchedText,
} from "@/server/lib/ai-access/types";
import { AiAccessAuditRepository } from "@/server/features/ai-access/repositories/AiAccessAuditRepository";
import { pgStep } from "./pgStep";

interface Params {
  auditId: string;
  projectId: string;
  startUrl: string;
  customer: BillingCustomerContext;
}
const FETCH_STEP = {
  retries: { limit: 1, delay: "10 seconds" as const },
  timeout: "5 minutes" as const,
};
const DB_STEP = {
  retries: { limit: 1, delay: "10 seconds" as const },
  timeout: "5 minutes" as const,
};

async function readLimited(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("Response too large");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("Response too large");
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function fetchChecked(
  url: string,
  ua: string,
  timeout: number,
  cap: number,
): Promise<{ response: Response; text: string }> {
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": ua },
    signal: AbortSignal.timeout(timeout),
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error("Redirect refused");
  return { response, text: await readLimited(response, cap) };
}

export class AiAccessAuditWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<void> {
    const { auditId, projectId, startUrl } = event.payload;
    try {
      const page = await step.do("fetch-page", FETCH_STEP, async () => {
        const validated = await normalizeAndValidateStartUrl(startUrl);
        const resolved = await resolveStartUrlRedirects(validated);
        const { response, text } = await fetchChecked(
          resolved.url,
          BROWSER_UA,
          15_000,
          1024 * 1024,
        );
        if (!response.ok) throw new Error(`Homepage HTTP ${response.status}`);
        const analysis = analyzeHtml(text, resolved.url, response.status, 0);
        return {
          url: resolved.url,
          js: checkJsRendering(text),
          schema: JSON.stringify(checkSchema(text)),
          meta: checkPageMeta(text, response.headers.get("x-robots-tag")),
          title: analysis.title ?? "",
        };
      });
      const origin = new URL(page.url).origin;
      const aux = await step.do("fetch-aux", FETCH_STEP, async () => {
        const paths = ["/robots.txt", ...LLM_PATHS, ...WELL_KNOWN_PATHS];
        const entries = await Promise.all(
          paths.map(async (path) => {
            const cap = path === "/robots.txt" ? 500 * 1024 : 100 * 1024;
            try {
              const { response, text } = await fetchChecked(
                new URL(path, origin).toString(),
                BROWSER_UA,
                path === "/robots.txt"
                  ? 15_000
                  : WELL_KNOWN_PATHS.includes(path as never)
                    ? 8_000
                    : 10_000,
                cap,
              );
              return [
                path,
                {
                  status: response.status,
                  text: text.slice(
                    0,
                    path === "/robots.txt"
                      ? cap
                      : WELL_KNOWN_PATHS.includes(path as never)
                        ? 2000
                        : 5000,
                  ),
                  url: response.url,
                  contentType:
                    response.headers.get("content-type") ?? undefined,
                },
              ] as const;
            } catch {
              return [
                path,
                { status: 0, text: "", url: new URL(path, origin).toString() },
              ] as const;
            }
          }),
        );
        return Object.fromEntries(entries) as Record<string, FetchedText>;
      });
      const robots = checkRobots(
        origin,
        aux["/robots.txt"]?.status === 200 ? aux["/robots.txt"].text : null,
      );
      const botCrawl = await step.do("bot-crawl", FETCH_STEP, async () => {
        const bots = Object.entries(AI_BOTS).flatMap(([company, agents]) =>
          Object.entries(agents).map(([name, ua]) => ({ company, name, ua })),
        );
        const output: BotCrawlResult[] = [];
        for (let offset = 0; offset < bots.length; offset += 5) {
          output.push(
            ...(await Promise.all(
              bots
                .slice(offset, offset + 5)
                .map(async ({ company, name, ua }) => {
                  const started = Date.now();
                  const robotsAllowed =
                    robots.aiAgents[name]?.robotsAllowed ?? null;
                  try {
                    const { response, text } = await fetchChecked(
                      page.url,
                      ua,
                      20_000,
                      1024 * 1024,
                    );
                    const analysis = analyzeHtml(
                      text,
                      page.url,
                      response.status,
                      Date.now() - started,
                    );
                    return {
                      company,
                      name,
                      status: response.status,
                      robotsAllowed,
                      noindex: /noindex/i.test(
                        `${analysis.robotsMeta ?? ""},${response.headers.get("x-robots-tag") ?? ""}`,
                      ),
                      title: analysis.title ?? "",
                      loadTimeMs: Date.now() - started,
                      contentLength: text.length,
                    };
                  } catch (error) {
                    return {
                      company,
                      name,
                      robotsAllowed,
                      noindex: false,
                      title: "",
                      loadTimeMs: Date.now() - started,
                      contentLength: 0,
                      error:
                        error instanceof Error ? error.name : "FETCH_FAILED",
                    };
                  }
                }),
            )),
          );
        }
        return output;
      });
      await pgStep(step, "finalize", DB_STEP, async () => {
        const llmTxt = checkLlmTxt(origin, aux);
        const schema = JSON.parse(page.schema) as AiAccessResults["schema"];
        const results: AiAccessResults = {
          url: page.url,
          js: page.js,
          llmTxt,
          robots,
          schema,
          pageMeta: page.meta,
          wellKnown: checkWellKnown(origin, aux),
          botCrawl,
          overallScore: computeOverall(
            page.js.score,
            llmTxt.score,
            robots.score,
            schema.score,
          ),
        };
        await AiAccessAuditRepository.markCompleted(auditId, projectId, {
          overallScore: results.overallScore,
          jsScore: page.js.score,
          llmTxtScore: llmTxt.score,
          robotsScore: robots.score,
          schemaScore: schema.score,
          results,
        });
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await pgStep(step, "mark-failed", DB_STEP, () =>
        AiAccessAuditRepository.markFailed(
          auditId,
          projectId,
          "FETCH_FAILED",
          detail.slice(0, 500),
        ),
      );
    }
  }
}
