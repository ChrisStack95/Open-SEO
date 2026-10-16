import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  lt,
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

import { TrackedBacklinkChecksRepository } from "./TrackedBacklinkChecksRepository";
export type { CheckRow } from "./TrackedBacklinkChecksRepository";
export type LinkRow = typeof links.$inferSelect;
type ConfigRow = typeof configs.$inferSelect;

async function ensureConfig(projectId: string) {
  await db
    .insert(configs)
    .values({ projectId, usageMonth: new Date().toISOString().slice(0, 7) })
    .onConflictDoNothing();
  const [config] = await db
    .select()
    .from(configs)
    .where(eq(configs.projectId, projectId));
  return config;
}
async function list(projectId: string) {
  await db
    .update(links)
    .set({ checking: false })
    .where(
      and(
        eq(links.projectId, projectId),
        eq(links.checking, true),
        lt(
          links.checkStartedAt,
          new Date(Date.now() - 10 * 60_000).toISOString(),
        ),
        sql`NOT EXISTS (SELECT 1 FROM ${checks} WHERE ${checks.linkId} = ${links.id} AND (${checks.state} <> 'completed' OR (${checks.billingLockId} IS NOT NULL AND ${checks.billingSettledAt} IS NULL)))`,
      ),
    );
  return db
    .select()
    .from(links)
    .where(eq(links.projectId, projectId))
    .orderBy(desc(links.createdAt), asc(links.id));
}
async function get(projectId: string, id: string) {
  const [link] = await db
    .select()
    .from(links)
    .where(and(eq(links.projectId, projectId), eq(links.id, id)));
  return link ?? null;
}
async function create(input: {
  id: string;
  projectId: string;
  sourceUrl: string;
  targetUrl: string;
  acquiredOn: string | null;
  notes: string;
  createdAt: string;
}) {
  // Lock the shared project configuration before counting. Postgres takes
  // the row lock in statement one, then statement two gets a fresh snapshot;
  // D1 runs both in its atomic batch. A crash cannot leak inventory slots.
  await runBatch((tx) => [
    tx
      .update(configs)
      .set({ projectId: input.projectId })
      .where(eq(configs.projectId, input.projectId)),
    tx
      .insert(links)
      .select(
        tx
          .select({
            id: sql<string>`${input.id}`.as("id"),
            projectId: projects.id,
            sourceUrl: sql<string>`${input.sourceUrl}`.as("source_url"),
            targetUrl: sql<string>`${input.targetUrl}`.as("target_url"),
            acquiredOn: sql<string | null>`${input.acquiredOn}`.as(
              "acquired_on",
            ),
            notes: sql<string>`${input.notes}`.as("notes"),
            paused: sql<boolean>`false`.as("paused"),
            status: sql<LinkRow["status"]>`'unchecked'`.as("status"),
            anchor: sql<null>`NULL`.as("anchor"),
            rel: sql<null>`NULL`.as("rel"),
            lastCheckedAt: sql<null>`NULL`.as("last_checked_at"),
            error: sql<null>`NULL`.as("error"),
            checking: sql<boolean>`false`.as("checking"),
            checkStartedAt: sql<null>`NULL`.as("check_started_at"),
            lastScheduledAt: sql<null>`NULL`.as("last_scheduled_at"),
            createdAt: sql<string>`${input.createdAt}`.as("created_at"),
          })
          .from(projects)
          .where(
            and(
              eq(projects.id, input.projectId),
              sql`(SELECT COUNT(*) FROM ${links} WHERE ${links.projectId} = ${input.projectId}) < 1000`,
            ),
          ),
      )
      .onConflictDoNothing(),
  ]);
  return get(input.projectId, input.id);
}
async function update(
  projectId: string,
  id: string,
  values: Partial<LinkRow>,
  requireIdle = false,
) {
  const [updated] = await db
    .update(links)
    .set(values)
    .where(
      and(
        eq(links.projectId, projectId),
        eq(links.id, id),
        requireIdle ? eq(links.checking, false) : undefined,
        requireIdle
          ? sql`NOT EXISTS (SELECT 1 FROM ${checks} WHERE ${checks.linkId} = ${id} AND ${checks.state} <> 'completed')`
          : undefined,
      ),
    )
    .returning();
  return updated ?? null;
}
async function remove(projectId: string, id: string) {
  const deleted = await db
    .delete(links)
    .where(
      and(
        eq(links.projectId, projectId),
        eq(links.id, id),
        eq(links.checking, false),
        sql`NOT EXISTS (SELECT 1 FROM ${checks} WHERE ${checks.linkId} = ${id} AND (${checks.state} <> 'completed' OR (${checks.billingLockId} IS NOT NULL AND ${checks.billingSettledAt} IS NULL)))`,
      ),
    )
    .returning({ id: links.id });
  return deleted.length > 0;
}
async function updateConfig(projectId: string, values: Partial<ConfigRow>) {
  await db.update(configs).set(values).where(eq(configs.projectId, projectId));
}

async function dueConfigs(now: string) {
  return db
    .select({ config: configs, organizationId: projects.organizationId })
    .from(configs)
    .innerJoin(projects, eq(configs.projectId, projects.id))
    .where(
      and(
        inArray(configs.scheduleInterval, ["daily", "weekly"]),
        lte(configs.nextCheckAt, now),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(
      sql`COALESCE(${configs.lastProcessedAt}, '') ASC`,
      asc(configs.nextCheckAt),
    )
    .limit(50);
}
async function claimSchedule(config: ConfigRow, nextCheckAt: string) {
  if (!config.nextCheckAt) return false;
  const [row] = await db
    .update(configs)
    .set({ nextCheckAt, lastSkipReason: null })
    .where(
      and(
        eq(configs.projectId, config.projectId),
        eq(configs.nextCheckAt, config.nextCheckAt),
        eq(configs.scheduleInterval, config.scheduleInterval),
      ),
    )
    .returning();
  return !!row;
}
async function scheduledLinks(projectId: string, slot: string, limit: number) {
  return db
    .select()
    .from(links)
    .where(
      and(
        eq(links.projectId, projectId),
        eq(links.paused, false),
        or(isNull(links.lastScheduledAt), lt(links.lastScheduledAt, slot)),
      ),
    )
    .orderBy(asc(links.id))
    .limit(limit);
}
async function claimScheduledLink(link: LinkRow, slot: string) {
  const [row] = await db
    .update(links)
    .set({ lastScheduledAt: slot })
    .where(
      and(
        eq(links.id, link.id),
        eq(links.projectId, link.projectId),
        eq(links.paused, false),
        or(isNull(links.lastScheduledAt), lt(links.lastScheduledAt, slot)),
        sql`EXISTS (SELECT 1 FROM ${configs} WHERE ${configs.projectId} = ${link.projectId} AND ${configs.nextCheckAt} = ${slot} AND ${configs.scheduleInterval} <> 'off')`,
      ),
    )
    .returning();
  return row ?? null;
}

export const TrackedBacklinksRepository = {
  ...TrackedBacklinkChecksRepository,
  ensureConfig,
  list,
  get,
  create,
  update,
  remove,
  updateConfig,
  dueConfigs,
  claimSchedule,
  scheduledLinks,
  claimScheduledLink,
};
