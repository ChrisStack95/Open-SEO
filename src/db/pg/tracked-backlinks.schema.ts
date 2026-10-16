import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

export const trackedBacklinkConfigs = pgTable(
  "tracked_backlink_configs",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    scheduleInterval: text("schedule_interval", {
      enum: ["off", "daily", "weekly"],
    })
      .notNull()
      .default("off"),
    maxCostUsdPerCheck: doublePrecision("max_cost_usd_per_check")
      .notNull()
      .default(0),
    lastProcessedAt: text("last_processed_at"),
    monthlyCheckLimit: integer("monthly_check_limit").notNull().default(100),
    usageMonth: text("usage_month").notNull(),
    checksUsed: integer("checks_used").notNull().default(0),
    nextCheckAt: text("next_check_at"),
    lastSkipReason: text("last_skip_reason"),
  },
  (t) => [
    index("tracked_backlink_configs_due_idx").on(
      t.scheduleInterval,
      t.nextCheckAt,
    ),
  ],
);

export const trackedBacklinks = pgTable(
  "tracked_backlinks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    targetUrl: text("target_url").notNull(),
    acquiredOn: text("acquired_on"),
    notes: text("notes").notNull().default(""),
    paused: boolean("paused").notNull().default(false),
    status: text("status", {
      enum: ["unchecked", "pending", "found", "not_found", "unverified"],
    })
      .notNull()
      .default("unchecked"),
    anchor: text("anchor"),
    rel: text("rel"),
    lastCheckedAt: text("last_checked_at"),
    error: text("error"),
    checking: boolean("checking").notNull().default(false),
    checkStartedAt: text("check_started_at"),
    lastScheduledAt: text("last_scheduled_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("tracked_backlinks_project_urls_idx").on(
      t.projectId,
      t.sourceUrl,
      t.targetUrl,
    ),
    index("tracked_backlinks_project_idx").on(t.projectId),
  ],
);

// A durable intent is claimed before the one billable task_post. A process
// dying in submitting is ambiguous and must never automatically post again.
export const trackedBacklinkChecks = pgTable(
  "tracked_backlink_checks",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => trackedBacklinks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    targetUrl: text("target_url").notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    state: text("state", {
      enum: ["queued", "submitting", "pending", "completed"],
    })
      .notNull()
      .default("queued"),
    status: text("status", {
      enum: ["pending", "found", "not_found", "unverified"],
    })
      .notNull()
      .default("pending"),
    taskId: text("task_id"),
    billingLockId: text("billing_lock_id"),
    billingFeatureId: text("billing_feature_id", {
      enum: ["usage_credits", "topup_credits"],
    }),
    billingEstimatedCredits: integer("billing_estimated_credits"),
    billingEstimatedCostUsd: doublePrecision("billing_estimated_cost_usd"),
    billingActualCostUsd: doublePrecision("billing_actual_cost_usd"),
    billingSettledAt: text("billing_settled_at"),
    anchor: text("anchor"),
    rel: text("rel"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    nextPollAt: text("next_poll_at").notNull(),
  },
  (t) => [
    index("tracked_backlink_checks_project_idx").on(t.projectId, t.createdAt),
    index("tracked_backlink_checks_due_idx").on(t.state, t.nextPollAt),
    uniqueIndex("tracked_backlink_checks_one_active_idx")
      .on(t.linkId)
      .where(sql`${t.state} IN ('queued', 'submitting', 'pending')`),
  ],
);
