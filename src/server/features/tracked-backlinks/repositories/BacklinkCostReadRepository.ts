import { lte } from "drizzle-orm";
import { db } from "@/db";
import { dataRefreshClaims } from "@/db/schema";

// All organizations share the server's DataForSEO API account. This key is
// intentionally global; its first organization only supplies the table's FK.
const COST_READ_KEY = "tracked-backlinks:onpage-cost-read";
const COST_READ_INTERVAL_MS = 6100;

async function claim(organizationId: string) {
  const now = Date.now();
  const token = crypto.randomUUID();
  const [row] = await db
    .insert(dataRefreshClaims)
    .values({
      key: COST_READ_KEY,
      organizationId,
      token,
      nextAttemptAt: now + COST_READ_INTERVAL_MS,
    })
    .onConflictDoUpdate({
      target: dataRefreshClaims.key,
      set: { token, nextAttemptAt: now + COST_READ_INTERVAL_MS },
      setWhere: lte(dataRefreshClaims.nextAttemptAt, now),
    })
    .returning({ token: dataRefreshClaims.token });
  return row?.token === token;
}

export const BacklinkCostReadRepository = { claim };
