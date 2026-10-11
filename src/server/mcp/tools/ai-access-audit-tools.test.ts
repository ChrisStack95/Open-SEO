import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runAiAccessAuditTool,
  getAiAccessAuditStatusTool,
  getAiAccessAuditResultsTool,
} from "./ai-access-audit-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  startAudit: vi.fn(),
  getStatus: vi.fn(),
  getResults: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/ai-access/services/AiAccessAuditService", () => ({
  AiAccessAuditService: mocks,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  mocks.startAudit.mockResolvedValue({
    auditId: "audit_1",
    status: "running",
    url: "https://example.com/",
  });
  mocks.getStatus.mockResolvedValue({
    id: "audit_1",
    status: "completed",
    overallScore: 75,
  });
  mocks.getResults.mockResolvedValue({
    audit: { id: "audit_1", status: "completed" },
    results: JSON.stringify({ overallScore: 75 }),
  });
});

describe("AI access audit tools", () => {
  it("starts an audit in the authorized project", async () => {
    const response = await runAiAccessAuditTool.handler(
      { projectId: "project_1", url: "https://example.com/" },
      makeToolContext(),
    );
    expect(mocks.startAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        url: "https://example.com/",
        actorUserId: expect.any(String),
        customer: expect.any(Object),
      }),
    );
    expect(response.structuredContent).toMatchObject({ auditId: "audit_1" });
  });

  it("rejects inaccessible projects before starting or reading", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);
    const context = makeToolContext();
    await expect(
      runAiAccessAuditTool.handler(
        { projectId: "other", url: "https://example.com/" },
        context,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getAiAccessAuditResultsTool.handler({ projectId: "other" }, context),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.startAudit).not.toHaveBeenCalled();
    expect(mocks.getResults).not.toHaveBeenCalled();
  });

  it("reads status and results scoped to the project and requested audit", async () => {
    const context = makeToolContext();
    const args = { projectId: "project_1", auditId: "audit_1" };
    const status = await getAiAccessAuditStatusTool.handler(args, context);
    const results = await getAiAccessAuditResultsTool.handler(args, context);
    expect(mocks.getStatus).toHaveBeenCalledWith(args);
    expect(mocks.getResults).toHaveBeenCalledWith(args);
    expect(status.structuredContent).toMatchObject({
      audit: { id: "audit_1" },
    });
    expect(results.structuredContent).toMatchObject({
      results: { overallScore: 75 },
    });
  });

  it("distinguishes missing audits from results still running", async () => {
    const context = makeToolContext();
    mocks.getStatus.mockResolvedValue(null);
    await expect(
      getAiAccessAuditStatusTool.handler({ projectId: "project_1" }, context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    mocks.getResults.mockResolvedValue({
      audit: { id: "audit_1", status: "running" },
      results: null,
    });
    const response = await getAiAccessAuditResultsTool.handler(
      { projectId: "project_1" },
      context,
    );
    expect(response.structuredContent).toMatchObject({ results: null });
  });
});
