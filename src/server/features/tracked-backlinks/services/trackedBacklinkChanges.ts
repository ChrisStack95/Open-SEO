import { and, eq, inArray, sql } from "drizzle-orm";
import { sort } from "remeda";
import { db } from "@/db";
import {
  trackedBacklinkChecks as checks,
  trackedBacklinks as links,
} from "@/db/schema";

type Observation = {
  linkId: string;
  status: string;
  anchor: string | null;
  rel: string | null;
  completedAt: string | null;
};
type Change = {
  kind: "not_observed" | "recovered" | "attributes_changed";
  at: string;
};

// Compare only definitive observations of the current pair. An edited URL,
// failed crawl, or pending task must not look like a link disappearing.
export async function getTrackedBacklinkChanges(projectId: string) {
  const ranked = db
    .select({
      linkId: checks.linkId,
      status: checks.status,
      anchor: checks.anchor,
      rel: checks.rel,
      completedAt: checks.completedAt,
      position:
        sql<number>`row_number() over (partition by ${checks.linkId} order by ${checks.completedAt} desc, ${checks.id} desc)`.as(
          "position",
        ),
    })
    .from(checks)
    .innerJoin(
      links,
      and(
        eq(checks.linkId, links.id),
        eq(checks.sourceUrl, links.sourceUrl),
        eq(checks.targetUrl, links.targetUrl),
      ),
    )
    .where(
      and(
        eq(checks.projectId, projectId),
        eq(links.projectId, projectId),
        eq(checks.state, "completed"),
        inArray(checks.status, ["found", "not_found"]),
      ),
    )
    .as("ranked_backlink_observations");
  const observations = await db
    .select()
    .from(ranked)
    .where(sql`${ranked.position} <= 2`)
    .orderBy(ranked.linkId, sql`${ranked.position}`);
  const latest = new Map<string, Observation>();
  const changes = new Map<string, Change>();
  for (const observation of observations) {
    const current = latest.get(observation.linkId);
    if (!current) {
      latest.set(observation.linkId, observation);
      continue;
    }
    if (!current.completedAt) continue;
    let kind: Change["kind"] | null = null;
    if (current.status !== observation.status) {
      kind = current.status === "found" ? "recovered" : "not_observed";
    } else if (
      current.status === "found" &&
      (current.anchor !== observation.anchor ||
        normalizedRel(current.rel) !== normalizedRel(observation.rel))
    ) {
      kind = "attributes_changed";
    }
    if (kind)
      changes.set(observation.linkId, { kind, at: current.completedAt });
  }
  return changes;
}

function normalizedRel(rel: string | null) {
  return sort(
    [...new Set((rel ?? "").toLowerCase().split(/\s+/).filter(Boolean))],
    (a, b) => a.localeCompare(b),
  ).join(" ");
}
