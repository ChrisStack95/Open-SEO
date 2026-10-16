import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { TrackedBacklinksRepository as repo } from "@/server/features/tracked-backlinks/repositories/TrackedBacklinksRepository";

// Replace only the runtime binding. Repository SQL, dialect schemas, real
// postgres.js execution, and runBatch transactions remain production code.
let pg: ReturnType<typeof postgres>;
let testDb: ReturnType<typeof drizzle>;
vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("@/db/pg/client", () => ({
  get pgDb() {
    return testDb;
  },
}));
vi.mock("@/db/d1/client", () => ({ d1Db: {} }));
vi.mock("@/db/provider", () => ({ getDatabaseProvider: () => "postgres" }));

const now = new Date().toISOString();
const month = now.slice(0, 7);
const sourceUrl = "https://source.example/article";
const targetUrl = "https://target.example/page";
const migrationsFolder = fileURLToPath(
  new URL("../drizzle/pg", import.meta.url),
);

beforeAll(async () => {
  const connectionString = process.env.TRACKED_BACKLINKS_PG_TEST_URL;
  if (!connectionString)
    throw new Error(
      "Set TRACKED_BACKLINKS_PG_TEST_URL to an empty, disposable PostgreSQL database.",
    );
  pg = postgres(connectionString, { max: 30, onnotice: () => {} });
  testDb = drizzle(pg);
  const [{ count }] = await pg<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`;
  expect(count).toBe(0);
  await migrate(testDb, { migrationsFolder });
  await pg`INSERT INTO organization (id, name, slug, created_at) VALUES ('pg-test-org', 'PG test', 'pg-test-org', now())`;
});
afterAll(async () => {
  await pg?.end();
});
beforeEach(async () => {
  await pg`DELETE FROM projects WHERE organization_id = 'pg-test-org'`;
  await pg`INSERT INTO projects (id, organization_id, name, domain) VALUES ('p', 'pg-test-org', 'PG test project', 'target.example')`;
  await repo.ensureConfig("p");
});

async function add(id = "link") {
  const link = await repo.create({
    id,
    projectId: "p",
    sourceUrl: sourceUrl + (id === "link" ? "" : "/" + id),
    targetUrl,
    acquiredOn: null,
    notes: "",
    createdAt: now,
  });
  expect(link).not.toBeNull();
  return link;
}
function checkInput(id = "check", linkId = "link", source = sourceUrl) {
  return {
    id,
    linkId,
    projectId: "p",
    sourceUrl: source,
    targetUrl,
    trigger: "manual" as const,
    createdAt: now,
    nextPollAt: now,
    billingEstimatedCostUsd: 0.00012,
  };
}

it("applies every Postgres migration from an empty database and creates billing and uniqueness constraints", async () => {
  const [{ count }] = await pg<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
  expect(count).toBe(readMigrationFiles({ migrationsFolder }).length);
  const indexes = await pg<
    { indexname: string; indexdef: string }[]
  >`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('tracked_backlinks', 'tracked_backlink_checks', 'tracked_backlink_configs')`;
  expect(
    indexes.some(
      (row) =>
        row.indexname === "tracked_backlink_checks_one_active_idx" &&
        row.indexdef.includes("WHERE"),
    ),
  ).toBe(true);
  expect(
    indexes.some(
      (row) =>
        row.indexname === "tracked_backlinks_project_urls_idx" &&
        row.indexdef.includes("UNIQUE"),
    ),
  ).toBe(true);
  const columns = await pg<
    { column_name: string; data_type: string }[]
  >`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tracked_backlink_checks'`;
  expect(columns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        column_name: "billing_estimated_cost_usd",
        data_type: "double precision",
      }),
      expect.objectContaining({
        column_name: "billing_settled_at",
        data_type: "text",
      }),
    ]),
  );
});

it("admits one concurrent intent and one submission claim for the same link", async () => {
  await add();
  const admissions = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      repo.createCheck(checkInput("check-" + i)),
    ),
  );
  expect(admissions.filter(Boolean)).toHaveLength(1);
  const check = admissions.find(Boolean)!;
  const claims = await Promise.all(
    Array.from({ length: 20 }, () => repo.claimSubmission(check.id)),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(await repo.history("p", "link")).toHaveLength(1);
  expect(await repo.get("p", "link")).toMatchObject({
    checking: true,
    status: "pending",
  });
});

it("reserves the last monthly slot exactly once under concurrent manual and cron admission", async () => {
  await repo.updateConfig("p", {
    monthlyCheckLimit: 100,
    usageMonth: month,
    checksUsed: 99,
  });
  const results = await Promise.all(
    Array.from({ length: 20 }, () => repo.reserve("p", month)),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await repo.ensureConfig("p")).toMatchObject({
    checksUsed: 100,
    usageMonth: month,
  });
});

it("rolls a stale monthly counter forward only once when contenders race", async () => {
  await repo.updateConfig("p", {
    monthlyCheckLimit: 1,
    usageMonth: "2000-01",
    checksUsed: 100,
  });
  const results = await Promise.all(
    Array.from({ length: 20 }, () => repo.reserve("p", month)),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await repo.ensureConfig("p")).toMatchObject({
    checksUsed: 1,
    usageMonth: month,
  });
});

it("allows only one final inventory slot across concurrent inserts", async () => {
  await pg`INSERT INTO tracked_backlinks (id, project_id, source_url, target_url, created_at)
    SELECT 'prefill-' || i, 'p', 'https://source.example/prefill-' || i, ${targetUrl}, ${now}
    FROM generate_series(1, 999) AS i`;
  const added = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      repo.create({
        id: "new-" + i,
        projectId: "p",
        sourceUrl: sourceUrl + "/" + i,
        targetUrl,
        acquiredOn: null,
        notes: "",
        createdAt: now,
      }),
    ),
  );
  expect(added.filter(Boolean)).toHaveLength(1);
  const [{ count }] = await pg<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM tracked_backlinks WHERE project_id = 'p'`;
  expect(count).toBe(1000);
});

it("makes deletion and check admission mutually exclusive", async () => {
  for (let i = 0; i < 20; i++) {
    const link = await add("delete-race-" + i);
    const [check, removed] = await Promise.all([
      repo.createCheck(
        checkInput("delete-check-" + i, link.id, link.sourceUrl),
      ),
      repo.remove("p", link.id),
    ]);
    expect(Boolean(check) && removed).toBe(false);
    expect(Boolean(check) || removed).toBe(true);
    if (check)
      expect(await repo.get("p", link.id)).toMatchObject({ checking: true });
  }
});

it("prevents stale-URL check admission when URL edits race", async () => {
  for (let i = 0; i < 20; i++) {
    const link = await add("edit-race-" + i);
    const editedUrl = "https://source.example/edited-" + i;
    const [check, edited] = await Promise.all([
      repo.createCheck(checkInput("edit-check-" + i, link.id, link.sourceUrl)),
      repo.update("p", link.id, { sourceUrl: editedUrl }, true),
    ]);
    expect(Boolean(check) && Boolean(edited)).toBe(false);
    expect(Boolean(check) || Boolean(edited)).toBe(true);
    expect((await repo.get("p", link.id))?.sourceUrl).toBe(
      check ? link.sourceUrl : editedUrl,
    );
  }
});

it("keeps billing reconciliation durable after observation completion and releases editing only after settlement", async () => {
  await add();
  const check = (await repo.createCheck(checkInput()))!;
  await repo.saveBillingHold(
    check.id,
    { lockId: "hold-id", featureId: "usage_credits", estimatedCredits: 2 },
    0.00012,
  );
  await repo.finish(check, {
    status: "found",
    anchor: "Target",
    rel: "nofollow",
  });
  expect(await repo.get("p", "link")).toMatchObject({
    checking: true,
    status: "found",
  });
  expect(await repo.remove("p", "link")).toBe(false);
  expect(
    await repo.update("p", "link", { sourceUrl: sourceUrl + "/edited" }, true),
  ).toBeNull();
  expect(await repo.activeCheck("link")).toMatchObject({
    state: "completed",
    billingSettledAt: null,
  });
  await repo.billingSettled(check.id, 0.00012);
  expect(await repo.activeCheck("link")).toBeNull();
  expect(await repo.get("p", "link")).toMatchObject({ checking: false });
  expect(
    await repo.update("p", "link", { sourceUrl: sourceUrl + "/edited" }, true),
  ).not.toBeNull();
  expect(await repo.remove("p", "link")).toBe(true);
});
