import { z } from "zod";
import { dataforseoGet, dataforseoPost } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  DataforseoChargedTaskError,
  isTaskInProgress,
  type DataforseoApiResponse,
  type DataforseoTaskLike,
} from "@/server/lib/dataforseo/envelope";
import { isCrawlableUrl } from "@/server/lib/audit/url-policy";
import { AppError } from "@/server/lib/errors";

// Official request and response models:
// https://github.com/dataforseo/TypeScriptClient/blob/master/docs/OnPageTaskPostRequestInfo.md
// https://github.com/dataforseo/TypeScriptClient/blob/master/src/models/BaseOnPageLinkItem.ts
const TASK_POST_PATH = "/v3/on_page/task_post";
const LINKS_LIMIT = 1000;
// Reads are free, but a pathological source page must not monopolize a worker.
const MAX_LINK_PAGES = 10;

const summarySchema = z.object({
  crawl_progress: z.enum(["in_progress", "finished"]),
  crawl_stop_reason: z.string().nullish(),
  domain_info: z
    .object({ extended_crawl_status: z.string().nullish() })
    .nullish(),
});
const pageSchema = z.object({
  resource_type: z.string(),
  status_code: z.number().int().nullish(),
  url: z.string(),
});
const linkSchema = z.object({
  type: z.string(),
  direction: z.string(),
  link_from: z.string(),
  link_to: z.string(),
  text: z.string().nullish(),
  link_attribute: z.array(z.string()).nullish(),
  dofollow: z.boolean().nullish(),
});
const pagesSchema = z.object({ items: z.array(pageSchema).nullable() });
const linksSchema = z.object({
  crawl_progress: z.enum(["in_progress", "finished"]),
  total_items_count: z.number().int().nonnegative(),
  items: z.array(linkSchema).nullable(),
});

type BacklinkVerificationResult =
  | { status: "pending" }
  | {
      status: "completed";
      /** Null means the crawl could not establish presence or absence. */
      found: boolean | null;
      anchor: string | null;
      rel: string | null;
      httpStatus: number | null;
      message: string | null;
    };

function unverified(
  message: string,
  httpStatus: number | null = null,
): BacklinkVerificationResult {
  return {
    status: "completed",
    found: null,
    anchor: null,
    rel: null,
    httpStatus,
    message,
  };
}

function comparableUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Submit exactly one source page. Never automatically replay a paid POST. */
export async function postBacklinkVerificationTask(input: {
  sourceUrl: string;
  tag: string;
  signal?: AbortSignal;
}): Promise<DataforseoApiResponse<{ taskId: string }>> {
  if (!isCrawlableUrl(input.sourceUrl)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Enter a public HTTP or HTTPS source URL.",
    );
  }
  const source = new URL(input.sourceUrl);
  if (source.username || source.password || input.tag.length > 255) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Invalid backlink verification request.",
    );
  }
  source.hash = "";
  const response = await dataforseoPost(
    TASK_POST_PATH,
    [
      {
        target: source.hostname.replace(/^www\./, ""),
        start_url: source.href,
        max_crawl_pages: 1,
        max_crawl_depth: 0,
        force_sitewide_checks: false,
        load_resources: false,
        enable_javascript: false,
        enable_browser_rendering: false,
        calculate_keyword_density: false,
        tag: input.tag,
      },
    ],
    { maxServerErrorRetries: 0, signal: input.signal },
  );
  const task = assertOk(response, { okTaskStatusCode: 20100 });
  const billing = buildTaskBilling(task);
  const id = z.string().min(1).safeParse(task.id);
  if (!id.success) {
    throw new DataforseoChargedTaskError(
      "DataForSEO created a verification task without a task ID",
      billing,
    );
  }
  return { data: { taskId: id.data }, billing };
}

/**
 * Collect an existing crawl by ID, without submitting any new paid task.
 * Summary polling avoids the account-wide tasks_ready queue and establishes
 * completion before an empty links result can count as a missing backlink.
 */
export async function fetchBacklinkVerificationResult(input: {
  taskId: string;
  sourceUrl: string;
  targetUrl: string;
  signal?: AbortSignal;
}): Promise<BacklinkVerificationResult> {
  const summaryResponse = await dataforseoGet(
    `/v3/on_page/summary/${encodeURIComponent(input.taskId)}`,
    { signal: input.signal },
  );
  const summaryTask = summaryResponse?.tasks?.[0];
  if (
    summaryResponse?.status_code === 20000 &&
    summaryTask &&
    isTaskInProgress(summaryTask)
  ) {
    return { status: "pending" };
  }
  const summary = parseResult(assertOk(summaryResponse), summarySchema);
  if (summary.crawl_progress === "in_progress") return { status: "pending" };
  const crawlError = summary.domain_info?.extended_crawl_status;
  if (crawlError && crawlError !== "no_errors") {
    return unverified(`Source page could not be verified (${crawlError}).`);
  }
  if (
    summary.crawl_stop_reason &&
    !["limit_exceeded", "empty_queue"].includes(summary.crawl_stop_reason)
  ) {
    return unverified("The source page crawl did not finish successfully.");
  }

  const pages = parseResult(
    assertOk(
      await dataforseoPost(
        "/v3/on_page/pages",
        [{ id: input.taskId, limit: 1 }],
        { signal: input.signal },
      ),
    ),
    pagesSchema,
  );
  const page = pages.items?.[0];
  const httpStatus = page?.status_code ?? null;
  if (
    !page ||
    page.resource_type !== "html" ||
    httpStatus === null ||
    httpStatus < 200 ||
    httpStatus >= 300
  ) {
    return unverified(
      "The source page did not return a successful HTML response.",
      httpStatus,
    );
  }
  if (comparableUrl(page.url) !== comparableUrl(input.sourceUrl)) {
    return unverified(
      "The source URL redirected or the requested page was not crawled.",
      httpStatus,
    );
  }

  const target = comparableUrl(input.targetUrl);
  if (!target)
    throw new AppError("VALIDATION_ERROR", "Invalid backlink target URL.");
  for (let pageIndex = 0; pageIndex < MAX_LINK_PAGES; pageIndex++) {
    const offset = pageIndex * LINKS_LIMIT;
    const links = parseResult(
      assertOk(
        await dataforseoPost(
          "/v3/on_page/links",
          [
            {
              id: input.taskId,
              page_from: new URL(page.url).pathname + new URL(page.url).search,
              filters: [
                ["direction", "=", "external"],
                "and",
                ["type", "in", ["anchor", "image"]],
              ],
              limit: LINKS_LIMIT,
              offset,
            },
          ],
          { signal: input.signal },
        ),
      ),
      linksSchema,
    );
    if (links.crawl_progress !== "finished") return { status: "pending" };
    const items = links.items ?? [];
    const match = items.find(
      (link) =>
        ["anchor", "image"].includes(link.type) &&
        link.direction === "external" &&
        comparableUrl(link.link_from) === comparableUrl(page.url) &&
        comparableUrl(link.link_to) === target,
    );
    if (match) {
      // link_attribute is the observed rel token list. dofollow:false is only
      // a fallback for an omitted list; never invent sponsored/ugc values.
      const rel =
        match.link_attribute?.join(" ") ??
        (match.dofollow === false ? "nofollow" : null);
      return {
        status: "completed",
        found: true,
        anchor: match.text ?? null,
        rel,
        httpStatus,
        message: null,
      };
    }
    if (offset + items.length >= links.total_items_count) {
      return {
        status: "completed",
        found: false,
        anchor: null,
        rel: null,
        httpStatus,
        message: null,
      };
    }
    if (items.length < LINKS_LIMIT) break;
  }
  return unverified(
    "The source page returned more links than could be checked completely.",
    httpStatus,
  );
}

function parseResult<T extends z.ZodType>(
  task: DataforseoTaskLike,
  schema: T,
): z.infer<T> {
  const parsed = schema.safeParse(task.result?.[0]);
  if (!parsed.success) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "DataForSEO returned an invalid verification response.",
    );
  }
  return parsed.data;
}
