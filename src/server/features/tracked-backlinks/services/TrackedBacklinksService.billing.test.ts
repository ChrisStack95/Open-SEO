import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitForBacklinkCostRead } from "./trackedBacklinkBilling";
import { TrackedBacklinksService } from "./TrackedBacklinksService";
import type {
  CheckRow,
  LinkRow,
} from "../repositories/TrackedBacklinksRepository";

const mocks = vi.hoisted(() => ({
  costReadClaim: vi.fn(),
  hasOverdueBilling: vi.fn(),
  ensureConfig: vi.fn(),
  activeCheck: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  createCheck: vi.fn(),
  claimSubmission: vi.fn(),
  saveBillingHold: vi.fn(),
  submitted: vi.fn(),
  finish: vi.fn(),
  dueChecks: vi.fn(),
  claimPoll: vi.fn(),
  billingSettled: vi.fn(),
  recordBillingCost: vi.fn(),
  price: vi.fn(),
  post: vi.fn(),
  collect: vi.fn(),
  taskCost: vi.fn(),
  reserveCredits: vi.fn(),
  settleCredits: vi.fn(),
}));
vi.mock("../repositories/BacklinkCostReadRepository", () => ({
  BacklinkCostReadRepository: { claim: mocks.costReadClaim },
}));
vi.mock("@/db", () => ({ withPgClient: vi.fn() }));
vi.mock("./trackedBacklinkChanges", () => ({
  getTrackedBacklinkChanges: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ waitUntil: vi.fn() }));
vi.mock("../repositories/TrackedBacklinksRepository", () => ({
  TrackedBacklinksRepository: mocks,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: {},
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => true,
  getOptionalEnvValue: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/pricing", () => ({
  dataforseoPricing: { onPage: { backlinkVerificationTask: mocks.price } },
}));
vi.mock("@/server/lib/dataforseo/on-page", () => ({
  postBacklinkVerificationTask: mocks.post,
  fetchBacklinkVerificationResult: mocks.collect,
}));
vi.mock("@/server/lib/dataforseo/on-page-billing", () => ({
  fetchBacklinkVerificationTaskCost: mocks.taskCost,
}));
vi.mock("@/server/billing/subscription", () => ({
  customerHasPaidPlan: vi.fn(),
  getOrCreateOrganizationCustomer: async () => ({ id: "org" }),
  reserveUsageCredits: mocks.reserveCredits,
  settleUsageCredits: mocks.settleCredits,
}));

const customer = {
  organizationId: "org",
  projectId: "project",
  userId: "user",
  userEmail: "user@example.com",
};
const hold = {
  lockId: "lock",
  featureId: "usage_credits" as const,
  estimatedCredits: 1,
  callIndexes: [0],
};
const link: LinkRow = {
  id: "link",
  projectId: "project",
  sourceUrl: "https://source.example/page",
  targetUrl: "https://target.example/",
  acquiredOn: null,
  notes: "",
  paused: false,
  checking: false,
  checkStartedAt: null,
  status: "unchecked",
  anchor: null,
  rel: null,
  lastCheckedAt: null,
  lastScheduledAt: null,
  error: null,
  createdAt: new Date().toISOString(),
};
function check(overrides: Partial<CheckRow> = {}): CheckRow {
  return {
    id: "check",
    linkId: link.id,
    projectId: link.projectId,
    sourceUrl: link.sourceUrl,
    targetUrl: link.targetUrl,
    trigger: "manual",
    state: "queued",
    status: "pending",
    taskId: null,
    anchor: null,
    rel: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    nextPollAt: new Date().toISOString(),
    billingLockId: null,
    billingFeatureId: null,
    billingEstimatedCredits: null,
    billingEstimatedCostUsd: 0.0001,
    billingActualCostUsd: null,
    billingSettledAt: null,
    ...overrides,
  };
}
beforeEach(() => {
  mocks.costReadClaim.mockResolvedValue(true);
  mocks.hasOverdueBilling.mockResolvedValue(false);
  mocks.ensureConfig.mockResolvedValue({ maxCostUsdPerCheck: 0.000128 });
  mocks.activeCheck.mockResolvedValue(null);
  mocks.reserve.mockResolvedValue(true);
  mocks.createCheck.mockImplementation(async (input: Partial<CheckRow>) =>
    check(input),
  );
  mocks.claimSubmission.mockResolvedValue(check());
  mocks.saveBillingHold.mockResolvedValue(undefined);
  mocks.submitted.mockResolvedValue(undefined);
  mocks.recordBillingCost.mockResolvedValue(undefined);
  mocks.finish.mockResolvedValue(undefined);
  mocks.release.mockResolvedValue(undefined);
  mocks.price.mockResolvedValue(0.0001);
  mocks.post.mockResolvedValue({
    data: { taskId: "task" },
    billing: { costUsd: 0, path: ["v3", "on_page", "task_post"] },
  });
  mocks.reserveCredits.mockResolvedValue({ holds: [hold], refusedCalls: [] });
  mocks.settleCredits.mockResolvedValue(true);
  mocks.dueChecks.mockResolvedValue([]);
  mocks.claimPoll.mockResolvedValue(true);
  mocks.collect.mockResolvedValue({ status: "completed", found: true });
  mocks.taskCost.mockResolvedValue({ taskId: "task", costUsd: 0.0001 });
});

describe("queued backlink crawl billing", () => {
  it("stops waiting for the global account quota when the polling deadline aborts", async () => {
    vi.useFakeTimers();
    try {
      mocks.costReadClaim.mockResolvedValue(false);
      const controller = new AbortController();
      const waiting = waitForBacklinkCostRead("org", controller.signal);
      const rejected = expect(waiting).rejects.toThrow("poll deadline");
      await vi.advanceTimersByTimeAsync(10);
      controller.abort(new Error("poll deadline"));
      await rejected;
      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.costReadClaim).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an expired hold's recorded actual cost without pretending the charge settled", async () => {
    const expired = check({
      state: "completed",
      createdAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
      billingLockId: hold.lockId,
      billingFeatureId: hold.featureId,
      billingEstimatedCredits: hold.estimatedCredits,
      billingActualCostUsd: 0.00012,
    });
    mocks.dueChecks.mockResolvedValue([
      { check: expired, organizationId: customer.organizationId },
    ]);
    await TrackedBacklinksService.processPending();
    expect(mocks.taskCost).not.toHaveBeenCalled();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.billingSettled).not.toHaveBeenCalled();
  });

  it("pauses new organization spend when an older provider charge outlives its credit hold", async () => {
    mocks.hasOverdueBilling.mockResolvedValue(true);
    await expect(
      TrackedBacklinksService.queue(link, "manual", customer),
    ).rejects.toThrow("earlier provider charge");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.hasOverdueBilling).toHaveBeenCalledWith(
      customer.organizationId,
      expect.any(String),
    );
  });

  it("checks scheduled price approval again immediately before creating an intent", async () => {
    mocks.price.mockResolvedValue(0.0002);
    await expect(
      TrackedBacklinksService.queue(link, "scheduled", customer),
    ).rejects.toThrow("approved per-check maximum");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("persists the credit hold before dispatch and retains it when task_post costs zero", async () => {
    await TrackedBacklinksService.queue(link, "manual", customer);
    expect(mocks.saveBillingHold).toHaveBeenCalledWith(
      expect.any(String),
      hold,
      0.0001,
    );
    expect(mocks.saveBillingHold.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.post.mock.invocationCallOrder[0],
    );
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      expect.objectContaining({ ttlMs: 86_340_000 }),
    );
  });

  it("refuses changed prices before holding or submitting against the approved amount", async () => {
    mocks.price.mockResolvedValue(0.0002);
    await expect(
      TrackedBacklinksService.queue(link, "manual", customer, {
        approvedRawUsd: 0.0001,
      }),
    ).rejects.toThrow("pricing changed");
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });

  it("reports insufficient credits without submitting a provider task", async () => {
    mocks.reserveCredits.mockRejectedValue(new Error("Insufficient credits"));
    await expect(
      TrackedBacklinksService.queue(link, "manual", customer),
    ).rejects.toThrow("Insufficient credits");
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });

  it("preserves an ambiguous submission's hold and reconciles its eventual actual cost by tag", async () => {
    mocks.post.mockRejectedValueOnce(new Error("Lost connection"));
    await expect(
      TrackedBacklinksService.queue(link, "manual", customer),
    ).rejects.toThrow("Lost connection");
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    const pending = check({
      state: "completed",
      billingLockId: hold.lockId,
      billingFeatureId: hold.featureId,
      billingEstimatedCredits: hold.estimatedCredits,
    });
    mocks.dueChecks.mockResolvedValue([
      { check: pending, organizationId: customer.organizationId },
    ]);
    await TrackedBacklinksService.processPending();
    expect(mocks.taskCost).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: undefined, tag: pending.id }),
    );
    expect(mocks.settleCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        hold,
        costs: [{ costUsd: 0.0001, path: ["v3", "on_page", "task_post"] }],
      }),
    );
    expect(mocks.billingSettled).toHaveBeenCalledWith(pending.id, 0.0001);
  });

  it("keeps reconciliation pending when the final cost or credit settlement is unavailable", async () => {
    const pending = check({
      state: "completed",
      billingLockId: hold.lockId,
      billingFeatureId: hold.featureId,
      billingEstimatedCredits: hold.estimatedCredits,
    });
    mocks.dueChecks.mockResolvedValue([
      { check: pending, organizationId: customer.organizationId },
    ]);
    mocks.taskCost.mockResolvedValueOnce(null);
    await TrackedBacklinksService.processPending();
    expect(mocks.settleCredits).not.toHaveBeenCalled();
    mocks.settleCredits.mockResolvedValueOnce(false);
    await TrackedBacklinksService.processPending();
    expect(mocks.billingSettled).not.toHaveBeenCalled();
  });
});
