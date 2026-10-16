import { z } from "zod";
import { fetchUserData } from "@/server/lib/dataforseo/appendix";
import { dataforseoPost } from "@/server/lib/dataforseo/core";
import { assertOk } from "@/server/lib/dataforseo/envelope";
import { AppError } from "@/server/lib/errors";

// https://docs.dataforseo.com/v3/appendix/user_data/
// https://docs.dataforseo.com/v3/on_page/id_list/
const rateSchema = z.object({
  cost_type: z.enum(["per_request", "per_result"]),
  cost: z.number().nonnegative().finite(),
});
const endpointPriceSchema = z.object({
  priority_normal: z.array(rateSchema).min(1),
});
const accountPriceSchema = z.object({
  price: z.object({
    on_page: z.object({
      task_post: endpointPriceSchema,
      summary: endpointPriceSchema,
      pages: endpointPriceSchema,
      links: endpointPriceSchema,
      // The official account-price example omits id_list. Its own endpoint
      // documentation guarantees free reads; check an advertised rate when
      // present rather than requiring this optional account field.
      id_list: endpointPriceSchema.optional(),
    }),
  }),
});
const costReadPriceSchema = z.object({
  price: z.object({
    on_page: z.object({ id_list: endpointPriceSchema.optional() }),
  }),
});
const taskCostSchema = z.object({
  id: z.string(),
  cost: z.number().finite().nonnegative().nullish(),
  datetime_done: z.string().nullish(),
  metadata: z.object({ tag: z.string().optional() }).nullish(),
});

/**
 * Resolve the current account's bound for the exact one-page, HTML-only
 * request. Unknown pricing modes or billable collection endpoints disable
 * checking rather than turning a guessed public price into a spend limit.
 */
export async function fetchBacklinkVerificationPrice(
  options: { signal?: AbortSignal } = {},
): Promise<number> {
  const parsed = accountPriceSchema.safeParse(await fetchUserData(options));
  if (!parsed.success) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "The verification price could not be established for this DataForSEO account.",
    );
  }
  const prices = parsed.data.price.on_page;
  for (const endpoint of [
    prices.summary,
    prices.pages,
    prices.links,
    prices.id_list,
  ]) {
    if (endpoint?.priority_normal.some((rate) => rate.cost !== 0)) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "This DataForSEO account does not support free verification result collection.",
      );
    }
  }
  // One request, at most one result/page. Optional paid crawl features are
  // explicitly disabled by postBacklinkVerificationTask.
  const estimate = prices.task_post.priority_normal.reduce(
    (sum, rate) => sum + rate.cost,
    0,
  );
  if (!Number.isFinite(estimate)) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "The DataForSEO verification price is invalid.",
    );
  }
  return estimate;
}

/**
 * Read a completed crawl's authoritative total cost from id_list. The cost
 * on summary/pages/links belongs to the collection request, not the crawl.
 * A tag can recover a completed task after an ambiguous submission failure;
 * absence, incomplete cost data, or the bounded scan ending returns null.
 */
export async function fetchBacklinkVerificationTaskCost(input: {
  taskId?: string;
  tag?: string;
  createdAt: Date;
  signal?: AbortSignal;
  /** Acquire the account-wide read quota before each paginated API call. */
  beforeRead?: () => Promise<void>;
}): Promise<{ taskId: string; costUsd: number } | null> {
  if (!input.taskId && !input.tag) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A verification task ID or tag is required.",
    );
  }
  const createdAt = input.createdAt.getTime();
  const now = Date.now();
  if (!Number.isFinite(createdAt) || createdAt > now + 60_000) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Invalid verification creation date.",
    );
  }
  // Metadata is retained for a month. Returning null preserves the durable
  // reservation instead of guessing a cost after provider retention expires.
  if (createdAt < now - 29 * 24 * 60 * 60 * 1000) return null;
  // Reconciliation needs only id_list to remain free. A changed crawl price
  // or paid observation endpoint must not block settling earlier work.
  const prices = costReadPriceSchema.safeParse(
    await fetchUserData({ signal: input.signal }),
  );
  if (
    !prices.success ||
    prices.data.price.on_page.id_list?.priority_normal.some(
      (rate) => rate.cost !== 0,
    )
  ) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "The cost of verification billing reconciliation could not be established.",
    );
  }
  const datetimeFrom = providerDatetime(new Date(createdAt - 60_000));
  const datetimeTo = providerDatetime(new Date(now));
  const limit = 1000;
  for (let page = 0; page < 10; page++) {
    await input.beforeRead?.();
    const task = assertOk(
      await dataforseoPost(
        "/v3/on_page/id_list",
        [
          {
            datetime_from: datetimeFrom,
            datetime_to: datetimeTo,
            limit,
            offset: page * limit,
            sort: "asc",
            include_metadata: Boolean(input.tag),
          },
        ],
        // Each attempt consumes the provider's 10/minute read allowance.
        // Retry on the next durable poll so it acquires the quota again.
        { signal: input.signal, maxServerErrorRetries: 0 },
      ),
    );
    const parsed = z.array(taskCostSchema).safeParse(task.result ?? []);
    if (!parsed.success) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "DataForSEO returned invalid verification cost data.",
      );
    }
    const match = parsed.data.find((row) =>
      input.taskId ? row.id === input.taskId : row.metadata?.tag === input.tag,
    );
    if (match) {
      if (!match.datetime_done || match.cost == null) return null;
      return { taskId: match.id, costUsd: match.cost };
    }
    if (parsed.data.length < limit) return null;
  }
  return null;
}

function providerDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ") + " +00:00";
}
