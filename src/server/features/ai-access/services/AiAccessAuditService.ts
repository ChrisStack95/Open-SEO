import { env } from "cloudflare:workers";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { AiAccessAuditRepository } from "../repositories/AiAccessAuditRepository";
import {
  normalizeAndValidateStartUrl,
  resolveStartUrlRedirects,
} from "@/server/lib/audit/url-policy";
import { aiAccessAuditResultsSchema } from "@/types/schemas/ai-access-audit";

export const AiAccessAuditService = {
  async startAudit(input: {
    projectId: string;
    url: string;
    actorUserId: string;
    customer: BillingCustomerContext;
  }) {
    const url = (
      await resolveStartUrlRedirects(
        await normalizeAndValidateStartUrl(input.url),
      )
    ).url;
    const id = crypto.randomUUID();
    await AiAccessAuditRepository.create({
      id,
      projectId: input.projectId,
      startUrl: url,
      startedByUserId: input.actorUserId,
      workflowInstanceId: id,
    });
    try {
      await env.AI_ACCESS_AUDIT_WORKFLOW.create({
        id,
        params: {
          auditId: id,
          projectId: input.projectId,
          startUrl: url,
          customer: input.customer,
        },
      });
    } catch (error) {
      await AiAccessAuditRepository.markFailed(
        id,
        input.projectId,
        "INTERNAL_ERROR",
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Workflow creation failed",
      );
      throw error;
    }
    return { auditId: id, status: "running" as const, url };
  },
  async getStatus(input: { projectId: string; auditId?: string }) {
    const audit = input.auditId
      ? await AiAccessAuditRepository.getForProject(
          input.projectId,
          input.auditId,
        )
      : await AiAccessAuditRepository.getLatestForProject(input.projectId);
    return audit;
  },
  async getResults(input: { projectId: string; auditId?: string }) {
    const audit = await AiAccessAuditService.getStatus(input);
    if (!audit) return null;
    if (audit.status !== "completed") return { audit, results: null };
    const results = aiAccessAuditResultsSchema.parse(JSON.parse(audit.results));
    return { audit, results: JSON.stringify(results) };
  },
};
