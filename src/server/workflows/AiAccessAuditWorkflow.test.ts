import { beforeEach, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import { AiAccessAuditWorkflow } from "./AiAccessAuditWorkflow";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  fail: vi.fn(),
  fetch: vi.fn(),
  validate: vi.fn(),
  redirects: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    env = {};
  },
}));
vi.mock("@/server/workflows/pgStep", () => ({
  pgStep: (
    _step: unknown,
    _name: string,
    _config: unknown,
    fn: () => unknown,
  ) => fn(),
}));
vi.mock(
  "@/server/features/ai-access/repositories/AiAccessAuditRepository",
  () => ({
    AiAccessAuditRepository: {
      markCompleted: mocks.complete,
      markFailed: mocks.fail,
    },
  }),
);
vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: mocks.validate,
  resolveStartUrlRedirects: mocks.redirects,
}));

const customer = {
  organizationId: "org",
  userId: "user",
  userEmail: "u@example.com",
};
const run = () => {
  // The mocked base and pgStep use no execution context, bindings, or step methods besides do.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal test runtime boundary
  const workflow = new AiAccessAuditWorkflow({} as ExecutionContext, {} as Env);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pgStep is mocked; only do executes
  const step = {
    do: (_name: string, _config: unknown, fn: () => unknown) => fn(),
  } as unknown as WorkflowStep;
  return workflow.run(
    {
      payload: {
        auditId: "audit",
        projectId: "project",
        startUrl: "https://example.com/",
        customer,
      },
      instanceId: "audit",
      timestamp: new Date("2026-09-05T12:00:00Z"),
    },
    step,
  );
};

beforeEach(() => {
  mocks.validate.mockResolvedValue("https://example.com/");
  mocks.redirects.mockResolvedValue({ url: "https://example.com/" });
  mocks.fetch.mockResolvedValue(
    new Response("<title>Example</title><h1>Example</h1>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});
it("finalizes with results and scores", async () => {
  await run();
  expect(mocks.complete).toHaveBeenCalledWith(
    "audit",
    "project",
    expect.objectContaining({
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- expect.any matcher into typed mock arg
      overallScore: expect.any(Number),
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- expect.any matcher into typed mock arg
      jsScore: expect.any(Number),
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- expect.any matcher into typed mock arg
      results: expect.objectContaining({ botCrawl: expect.any(Array) }),
    }),
  );
});
it("marks a failed homepage fetch without throwing", async () => {
  mocks.fetch.mockRejectedValue(new Error("network down"));
  await expect(run()).resolves.toBeUndefined();
  expect(mocks.fail).toHaveBeenCalledWith(
    "audit",
    "project",
    "FETCH_FAILED",
    expect.any(String),
  );
});
