import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lte,
  ne,
  or,
  isNotNull,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projects,
  trackedBacklinkChecks as checks,
  trackedBacklinkConfigs as configs,
  trackedBacklinks as links,
} from "@/db/schema";

export type CheckRow = typeof checks.$inferSelect;

async function activeCheck(linkId: string) {
  const [check] = await db
    .select()
    .from(checks)
    .where(
      and(
        eq(checks.linkId, linkId),
        or(
          ne(checks.state, "completed"),
          and(isNotNull(checks.billingLockId), isNull(checks.billingSettledAt)),
        ),
      ),
    );
  return check ?? null;
}
async function history(projectId: string, linkId: string) {
  return db
    .select()
    .from(checks)
    .where(and(eq(checks.projectId, projectId), eq(checks.linkId, linkId)))
    .orderBy(desc(checks.createdAt))
    .limit(100);
}
// Budget admission is one conditional UPDATE, so concurrent manual and cron
// requests cannot both spend the last slot. Crashes can waste a reserved slot,
// but never create an unbudgeted provider submission.
async function reserve(projectId: string, month: string) {
  const [row] = await db
    .update(configs)
    .set({
      checksUsed: sql`CASE WHEN ${configs.usageMonth} = ${month} THEN ${configs.checksUsed} + 1 ELSE 1 END`,
      usageMonth: month,
    })
    .where(
      and(
        eq(configs.projectId, projectId),
        sql`CASE WHEN ${configs.usageMonth} = ${month} THEN ${configs.checksUsed} ELSE 0 END < ${configs.monthlyCheckLimit}`,
      ),
    )
    .returning();
  return !!row;
}
async function release(projectId: string, month: string) {
  await db
    .update(configs)
    .set({ checksUsed: sql`${configs.checksUsed} - 1` })
    .where(
      and(
        eq(configs.projectId, projectId),
        eq(configs.usageMonth, month),
        sql`${configs.checksUsed} > 0`,
      ),
    );
}
async function createCheck(input: {
  id: string;
  linkId: string;
  projectId: string;
  sourceUrl: string;
  targetUrl: string;
  trigger: CheckRow["trigger"];
  createdAt: string;
  nextPollAt: string;
  billingEstimatedCostUsd: number;
}) {
  // A conditional row UPDATE is the shared gate for admission, URL edits
  // and deletion. Postgres rechecks it after a concurrent row writer, unlike
  // a SELECT/NOT EXISTS snapshot that can miss an uncommitted check.
  const [claimed] = await db
    .update(links)
    .set({ checking: true, checkStartedAt: input.createdAt })
    .where(
      and(
        eq(links.id, input.linkId),
        eq(links.projectId, input.projectId),
        eq(links.sourceUrl, input.sourceUrl),
        eq(links.targetUrl, input.targetUrl),
        eq(links.checking, false),
      ),
    )
    .returning();
  if (!claimed) return null;
  // Read the current pair inside the INSERT: editing/deleting a link between
  // admission and this statement must not launch a check for stale URLs.
  const [check] = await db
    .insert(checks)
    .select(
      db
        .select({
          id: sql<string>`${input.id}`.as("id"),
          linkId: links.id,
          projectId: links.projectId,
          sourceUrl: links.sourceUrl,
          targetUrl: links.targetUrl,
          trigger: sql<CheckRow["trigger"]>`${input.trigger}`.as("trigger"),
          state: sql<CheckRow["state"]>`'queued'`.as("state"),
          status: sql<CheckRow["status"]>`'pending'`.as("status"),
          taskId: sql<null>`NULL`.as("task_id"),
          billingLockId: sql<null>`NULL`.as("billing_lock_id"),
          billingFeatureId: sql<null>`NULL`.as("billing_feature_id"),
          billingEstimatedCredits: sql<null>`NULL`.as(
            "billing_estimated_credits",
          ),
          billingEstimatedCostUsd:
            sql<number>`${input.billingEstimatedCostUsd}`.as(
              "billing_estimated_cost_usd",
            ),
          billingActualCostUsd: sql<null>`NULL`.as("billing_actual_cost_usd"),
          billingSettledAt: sql<null>`NULL`.as("billing_settled_at"),
          anchor: sql<null>`NULL`.as("anchor"),
          rel: sql<null>`NULL`.as("rel"),
          error: sql<null>`NULL`.as("error"),
          createdAt: sql<string>`${input.createdAt}`.as("created_at"),
          completedAt: sql<null>`NULL`.as("completed_at"),
          nextPollAt: sql<string>`${input.nextPollAt}`.as("next_poll_at"),
        })
        .from(links)
        .where(
          and(
            eq(links.id, input.linkId),
            eq(links.projectId, input.projectId),
            eq(links.sourceUrl, input.sourceUrl),
            eq(links.targetUrl, input.targetUrl),
          ),
        ),
    )
    .onConflictDoNothing()
    .returning();
  if (check)
    await db
      .update(links)
      .set({ status: "pending", error: null })
      .where(
        and(
          eq(links.id, check.linkId),
          eq(links.projectId, check.projectId),
          sql`EXISTS (SELECT 1 FROM ${checks} WHERE ${checks.id} = ${check.id} AND ${checks.state} <> 'completed')`,
        ),
      );
  if (!check)
    await db
      .update(links)
      .set({ checking: false })
      .where(
        and(
          eq(links.id, input.linkId),
          sql`NOT EXISTS (SELECT 1 FROM ${checks} WHERE ${checks.linkId} = ${input.linkId} AND (${checks.state} <> 'completed' OR (${checks.billingLockId} IS NOT NULL AND ${checks.billingSettledAt} IS NULL)))`,
        ),
      );
  return check ?? null;
}
async function claimSubmission(id: string) {
  const [check] = await db
    .update(checks)
    .set({
      state: "submitting",
      nextPollAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    .where(and(eq(checks.id, id), eq(checks.state, "queued")))
    .returning();
  return check ?? null;
}
async function submitted(id: string, taskId: string) {
  await db
    .update(checks)
    .set({
      state: "pending",
      taskId,
      nextPollAt: new Date(Date.now() + 30_000).toISOString(),
    })
    .where(and(eq(checks.id, id), eq(checks.state, "submitting")));
}
async function dueChecks(now: string, projectId?: string) {
  return db
    .select({ check: checks, organizationId: projects.organizationId })
    .from(checks)
    .innerJoin(projects, eq(checks.projectId, projects.id))
    .where(
      and(
        or(
          ne(checks.state, "completed"),
          and(isNotNull(checks.billingLockId), isNull(checks.billingSettledAt)),
        ),
        lte(checks.nextPollAt, now),
        or(isNull(projects.archivedAt), ne(checks.state, "queued")),
        projectId ? eq(checks.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(checks.nextPollAt))
    .limit(50);
}
async function claimPoll(check: CheckRow) {
  const [row] = await db
    .update(checks)
    .set({ nextPollAt: new Date(Date.now() + 60_000).toISOString() })
    .where(
      and(
        eq(checks.id, check.id),
        eq(checks.state, check.state),
        eq(checks.nextPollAt, check.nextPollAt),
      ),
    )
    .returning();
  return !!row;
}
async function finish(
  check: CheckRow,
  result: {
    status: "found" | "not_found" | "unverified";
    anchor?: string | null;
    rel?: string | null;
    error?: string | null;
  },
) {
  const completedAt = new Date().toISOString();
  const values = {
    status: result.status,
    anchor: result.anchor ?? null,
    rel: result.rel ?? null,
    error: result.error ?? null,
  };
  await runBatch((tx) => [
    tx
      .update(links)
      .set({
        ...values,
        lastCheckedAt: completedAt,
        checking: sql`CASE WHEN EXISTS (SELECT 1 FROM ${checks} WHERE ${checks.id} = ${check.id} AND ${checks.billingLockId} IS NOT NULL AND ${checks.billingSettledAt} IS NULL) THEN true ELSE false END`,
      })
      .where(
        and(
          eq(links.id, check.linkId),
          eq(links.projectId, check.projectId),
          eq(links.sourceUrl, check.sourceUrl),
          eq(links.targetUrl, check.targetUrl),
          sql`EXISTS (SELECT 1 FROM ${checks} WHERE ${checks.id} = ${check.id} AND ${checks.state} <> 'completed')`,
        ),
      ),
    tx
      .update(checks)
      .set({ ...values, state: "completed", completedAt })
      .where(and(eq(checks.id, check.id), ne(checks.state, "completed"))),
  ]);
}
async function saveBillingHold(
  checkId: string,
  hold: {
    lockId: string;
    featureId: "usage_credits" | "topup_credits";
    estimatedCredits: number;
  },
  estimate: number,
) {
  await db
    .update(checks)
    .set({
      billingLockId: hold.lockId,
      billingFeatureId: hold.featureId,
      billingEstimatedCredits: hold.estimatedCredits,
      billingEstimatedCostUsd: estimate,
    })
    .where(eq(checks.id, checkId));
}
async function billingSettled(checkId: string, cost: number) {
  const [check] = await db
    .update(checks)
    .set({
      billingActualCostUsd: cost,
      billingSettledAt: new Date().toISOString(),
    })
    .where(eq(checks.id, checkId))
    .returning();
  if (check?.state === "completed")
    await db
      .update(links)
      .set({ checking: false })
      .where(
        and(
          eq(links.id, check.linkId),
          sql`NOT EXISTS (SELECT 1 FROM ${checks} WHERE ${checks.linkId} = ${check.linkId} AND (${checks.state} <> 'completed' OR (${checks.billingLockId} IS NOT NULL AND ${checks.billingSettledAt} IS NULL)))`,
        ),
      );
}
async function hasOverdueBilling(organizationId: string, before: string) {
  const [row] = await db
    .select({ id: checks.id })
    .from(checks)
    .innerJoin(projects, eq(checks.projectId, projects.id))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        isNotNull(checks.billingLockId),
        isNull(checks.billingSettledAt),
        lte(checks.createdAt, before),
      ),
    )
    .limit(1);
  return !!row;
}
async function recordBillingCost(checkId: string, cost: number) {
  await db
    .update(checks)
    .set({ billingActualCostUsd: cost })
    .where(eq(checks.id, checkId));
}
export const TrackedBacklinkChecksRepository = {
  recordBillingCost,
  activeCheck,
  history,
  reserve,
  release,
  createCheck,
  claimSubmission,
  submitted,
  dueChecks,
  claimPoll,
  finish,
  saveBillingHold,
  billingSettled,
  hasOverdueBilling,
};
