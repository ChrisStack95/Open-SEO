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

const step = {
  do: (_name: string, _config: unknown, fn: () => unknown) => fn(),
} as unknown as WorkflowStep;
const customer = {
  organizationId: "org",
  userId: "user",
  userEmail: "u@example.com",
};
const run = () =>
  new AiAccessAuditWorkflow({} as ExecutionContext, {} as Env).run(
    {
      payload: {
        auditId: "audit",
        projectId: "project",
        startUrl: "https://example.com/",
        customer,
      },
    } as never,
    step,
  );

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
      overallScore: expect.any(Number),
      jsScore: expect.any(Number),
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
