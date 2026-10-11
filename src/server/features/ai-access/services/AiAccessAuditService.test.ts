import { beforeEach, expect, it, vi } from "vitest";
import { AiAccessAuditService } from "./AiAccessAuditService";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  workflowCreate: vi.fn(),
  validate: vi.fn(),
  redirects: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  env: { AI_ACCESS_AUDIT_WORKFLOW: { create: mocks.workflowCreate } },
}));
vi.mock(
  "@/server/features/ai-access/repositories/AiAccessAuditRepository",
  () => ({ AiAccessAuditRepository: { create: mocks.create } }),
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

beforeEach(() => {
  mocks.validate.mockImplementation(async (url: string) => url);
  mocks.redirects.mockImplementation(async (url: string) => ({ url }));
});
it("rejects an invalid or private URL before writing", async () => {
  mocks.validate.mockRejectedValue(new Error("blocked"));
  await expect(
    AiAccessAuditService.startAudit({
      projectId: "project",
      url: "http://localhost/",
      actorUserId: "user",
      customer,
    }),
  ).rejects.toThrow("blocked");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("passes the validated URL and audit ID into the workflow", async () => {
  await AiAccessAuditService.startAudit({
    projectId: "project",
    url: "https://example.com",
    actorUserId: "user",
    customer,
  });
  const row = mocks.create.mock.calls[0][0];
  expect(mocks.workflowCreate).toHaveBeenCalledWith({
    id: row.id,
    params: {
      auditId: row.id,
      projectId: "project",
      startUrl: "https://example.com",
      customer,
    },
  });
});
