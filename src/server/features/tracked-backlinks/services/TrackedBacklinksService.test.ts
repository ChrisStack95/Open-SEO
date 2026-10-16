import { readFileSync, readdirSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { TrackedBacklinksService as service } from "./TrackedBacklinksService";
import { runScheduledTrackedBacklinks } from "./scheduledTrackedBacklinks";
import { TrackedBacklinksRepository as repo } from "../repositories/TrackedBacklinksRepository";
import { trackedBacklinkChecks } from "@/db/schema";
import { createTrackedBacklinkSchema } from "@/types/schemas/tracked-backlinks";
import { AppError } from "@/server/lib/errors";
import type { runBatch } from "@/db/runBatch";

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  post: vi.fn(),
  poll: vi.fn(),
  cost: vi.fn(),
  pricing: vi.fn(),
  hosted: vi.fn(),
  credits: vi.fn(),
  settle: vi.fn(),
  paid: vi.fn(),
  background: vi.fn<(work: Promise<unknown>) => void>(),
}));
let client: Client;
let testDb: ReturnType<typeof drizzle>;
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
  waitUntil: mocks.background,
}));
vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
  withPgClient: async (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/db/runBatch", () => ({
  runBatch: async (build: Parameters<typeof runBatch>[0]) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- real SQLite Drizzle exposes the same builder surface as D1
    const executor = testDb as unknown as Parameters<typeof build>[0];
    for (const statement of build(executor)) await statement;
  },
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectForOrganization: mocks.project },
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => "configured",
  isHostedServerAuthMode: mocks.hosted,
}));
vi.mock("@/server/lib/dataforseo/on-page", () => ({
  postBacklinkVerificationTask: mocks.post,
  fetchBacklinkVerificationResult: mocks.poll,
}));
vi.mock("@/server/lib/dataforseo/on-page-billing", () => ({
  fetchBacklinkVerificationTaskCost: mocks.cost,
}));
vi.mock("@/server/lib/dataforseo/pricing", () => ({
  dataforseoPricing: { onPage: { backlinkVerificationTask: mocks.pricing } },
}));
vi.mock("@/server/billing/subscription", () => ({
  getOrCreateOrganizationCustomer: async () => ({ id: "org" }),
  reserveUsageCredits: mocks.credits,
  settleUsageCredits: mocks.settle,
  customerHasPaidPlan: mocks.paid,
}));

const customer = {
  organizationId: "org",
  userId: "user",
  userEmail: "user@example.com",
  projectId: "p",
};
beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  testDb = drizzle(client);
  await client.executeMultiple(
    "CREATE TABLE projects (id text PRIMARY KEY, organization_id text NOT NULL, archived_at text);",
  );
  const migration = readdirSync("drizzle/sqlite").find(
    (name) => name.startsWith("0056_") && name.endsWith(".sql"),
  )!;
  await client.executeMultiple(
    readFileSync(`drizzle/sqlite/${migration}`, "utf8"),
  );
});
afterAll(() => client.close());
beforeEach(async () => {
  mocks.project.mockImplementation(
    async (projectId: string, organizationId: string) =>
      organizationId === "org" ? { id: projectId } : null,
  );
  mocks.hosted.mockResolvedValue(false);
  mocks.post.mockImplementation(async ({ tag }) => ({
    data: { taskId: `task-${tag}` },
    billing: { costUsd: 0, path: [] },
  }));
  mocks.poll.mockResolvedValue({ status: "pending" });
  mocks.cost.mockResolvedValue({ costUsd: 0.001 });
  mocks.pricing.mockResolvedValue(0.001);
  mocks.credits.mockResolvedValue({
    holds: [
      {
        lockId: "lock",
        featureId: "usage_credits",
        estimatedCredits: 2,
        callIndexes: [0],
      },
    ],
    refusedCalls: [],
  });
  mocks.settle.mockResolvedValue(true);
  mocks.paid.mockResolvedValue(true);
  await client.executeMultiple(
    "DELETE FROM tracked_backlink_checks; DELETE FROM tracked_backlinks; DELETE FROM tracked_backlink_configs; DELETE FROM projects; INSERT INTO projects VALUES ('p','org',NULL),('other','org',NULL);",
  );
});
async function add(
  sourceUrl = "https://source.example/article",
  projectId = "p",
) {
  return service.create(
    createTrackedBacklinkSchema.parse({
      projectId,
      sourceUrl,
      targetUrl: "https://target.example/page",
    }),
    customer,
  );
}
async function drainBackground() {
  await Promise.allSettled(mocks.background.mock.calls.map(([work]) => work));
}
async function run(id: string) {
  const result = await service.check(
    { projectId: "p", ids: [id], maxCostUsd: 1 },
    customer,
  );
  await drainBackground();
  return result;
}

async function makeDue() {
  await testDb
    .update(trackedBacklinkChecks)
    .set({ nextPollAt: "2000-01-01T00:00:00.000Z" });
}

describe("tracked backlinks", () => {
  it("canonicalizes and deduplicates a source/target pair within a project", async () => {
    const first = await add("https://SOURCE.example:443/article#section");
    expect(first.sourceUrl).toBe("https://source.example/article");
    await expect(add()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await add("https://source.example/article", "other")).toMatchObject({
      projectId: "other",
      status: "unchecked",
    });
    expect((await repo.ensureConfig("p")).scheduleInterval).toBe("off");
  });
  it("rejects URLs whose encoded normalized form exceeds the supported length", () => {
    expect(() =>
      createTrackedBacklinkSchema.parse({
        projectId: "p",
        sourceUrl: "https://example.com/" + "é".repeat(200),
        targetUrl: "https://target.example",
      }),
    ).toThrow("1,000 characters");
  });
  it("refuses another organization and project-scopes record IDs", async () => {
    const link = await add();
    await expect(
      service.history(
        { projectId: "p", id: link.id },
        { ...customer, organizationId: "foreign" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.remove({ projectId: "other", id: link.id }, customer),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repo.get("p", link.id)).not.toBeNull();
  });
  it("admits one concurrent check per link and does not replay it on refresh", async () => {
    const link = await add();
    const results = await Promise.all([run(link.id), run(link.id)]);
    expect(results.reduce((n, result) => n + result.started, 0)).toBe(1);
    await makeDue();
    await service.processPending("p");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect((await repo.ensureConfig("p")).checksUsed).toBe(1);
  });
  it("reserves the last monthly slot atomically across different links", async () => {
    const first = await add();
    const second = await add("https://source.example/second");
    await repo.updateConfig("p", { monthlyCheckLimit: 1 });
    const results = await Promise.allSettled([run(first.id), run(second.id)]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect((await repo.ensureConfig("p")).checksUsed).toBe(1);
  });
  it("records a queued credit refusal and never submits or consumes monthly quota", async () => {
    const link = await add();
    mocks.hosted.mockResolvedValue(true);
    mocks.credits.mockRejectedValue(new AppError("INSUFFICIENT_CREDITS"));
    expect(await run(link.id)).toMatchObject({ started: 1 });
    expect((await repo.history("p", link.id))[0]).toMatchObject({
      status: "unverified",
      error: "INSUFFICIENT_CREDITS",
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect((await repo.ensureConfig("p")).checksUsed).toBe(0);
  });
  it("records an ambiguous paid submission as unverified without automatic retry", async () => {
    const link = await add();
    mocks.post.mockRejectedValue(new Error("connection lost"));
    await run(link.id);
    await makeDue();
    await service.processPending("p");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect((await repo.history("p", link.id))[0]).toMatchObject({
      status: "unverified",
      state: "completed",
    });
  });
  it("blocks URL edits and deletion until a pending check completes", async () => {
    const link = await add();
    await run(link.id);
    expect(await repo.remove("p", link.id)).toBe(false);
    expect(
      await repo.update(
        "p",
        link.id,
        { sourceUrl: "https://source.example/new" },
        true,
      ),
    ).toBeNull();
    mocks.poll.mockResolvedValue({
      status: "completed",
      found: true,
      anchor: "Example",
      rel: "nofollow",
      message: null,
    });
    await makeDue();
    await service.processPending("p");
    expect(await repo.get("p", link.id)).toMatchObject({
      status: "found",
      anchor: "Example",
      rel: "nofollow",
      checking: false,
    });
    expect(await repo.remove("p", link.id)).toBe(true);
  });
  it("retains the billing gate after observation completes until its hold settles", async () => {
    const link = await add();
    mocks.hosted.mockResolvedValue(true);
    await run(link.id);
    mocks.cost.mockResolvedValue(null);
    mocks.poll.mockResolvedValue({
      status: "completed",
      found: false,
      anchor: null,
      rel: null,
      message: null,
    });
    await makeDue();
    await service.processPending("p");
    expect(await repo.remove("p", link.id)).toBe(false);
    const [check] = await repo.history("p", link.id);
    await repo.billingSettled(check.id, 0.001);
    expect(await repo.remove("p", link.id)).toBe(true);
  });
  it("makes progress for later projects while limiting each scheduled tick", async () => {
    for (let project = 0; project < 11; project++) {
      const projectId = `scheduled-${project}`;
      await client.execute({
        sql: "INSERT INTO projects VALUES (?, ?, NULL)",
        args: [projectId, "org"],
      });
      for (let i = 0; i < 6; i++)
        await add(`https://source.example/${i}`, projectId);
      await repo.updateConfig(projectId, {
        scheduleInterval: "daily",
        nextCheckAt: "2026-01-01T00:00:00.000Z",
        maxCostUsdPerCheck: 0.001,
      });
    }
    await runScheduledTrackedBacklinks();
    expect(mocks.post).toHaveBeenCalledTimes(50);
    await runScheduledTrackedBacklinks();
    expect(
      (await repo.list("scheduled-10")).filter(
        (link) => link.status === "pending",
      ),
    ).toHaveLength(5);
    expect(mocks.post).toHaveBeenCalledTimes(65);
  });
  it("returns queued work while provider submission is still pending", async () => {
    const link = await add();
    let release!: (value: { data: { taskId: string } }) => void;
    mocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const result = await service.check(
      { projectId: "p", ids: [link.id], maxCostUsd: 1 },
      customer,
    );
    expect(result).toMatchObject({ started: 1 });
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    release({ data: { taskId: "deferred-task" } });
    await drainBackground();
  });
  it("pauses automatic work while allowing an explicit manual check", async () => {
    const link = await add();
    await repo.update("p", link.id, { paused: true });
    const slot = "2026-01-01T00:00:00.000Z";
    await repo.updateConfig("p", {
      scheduleInterval: "daily",
      nextCheckAt: slot,
      maxCostUsdPerCheck: 0.001,
    });
    await runScheduledTrackedBacklinks();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(await run(link.id)).toMatchObject({ started: 1 });
  });
  it("requires renewed automatic consent when current per-check pricing increases", async () => {
    await add();
    await repo.updateConfig("p", {
      scheduleInterval: "daily",
      nextCheckAt: "2026-01-01T00:00:00.000Z",
      maxCostUsdPerCheck: 0.0001,
    });
    await runScheduledTrackedBacklinks();
    expect(mocks.post).not.toHaveBeenCalled();
    expect((await repo.ensureConfig("p")).lastSkipReason).toContain(
      "price changed",
    );
  });
  it("keeps archived projects in pending collection while refusing new scheduled admission", async () => {
    const link = await add();
    await run(link.id);
    await client.execute(
      "UPDATE projects SET archived_at = '2026-01-01' WHERE id = 'p'",
    );
    await makeDue();
    expect(await repo.dueChecks(new Date().toISOString())).toHaveLength(1);
    await repo.updateConfig("p", {
      scheduleInterval: "daily",
      nextCheckAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await repo.dueConfigs(new Date().toISOString())).toHaveLength(0);
  });
  it("rejects automatic work after its project schedule is switched off", async () => {
    const link = await add();
    const slot = "2026-01-01T00:00:00.000Z";
    await repo.updateConfig("p", {
      scheduleInterval: "daily",
      nextCheckAt: slot,
    });
    await repo.updateConfig("p", {
      scheduleInterval: "off",
      nextCheckAt: null,
    });
    expect(await repo.claimScheduledLink(link, slot)).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
