import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "cloudflare:workers";
import { requireProjectContext } from "./middleware";
import { AiAccessAuditService } from "@/server/features/ai-access/services/AiAccessAuditService";
import { captureServerEvent } from "@/server/lib/posthog";
import {
  startAiAccessAuditSchema,
  getAiAccessAuditStatusSchema,
  getAiAccessAuditResultsSchema,
} from "@/types/schemas/ai-access-audit";

export const startAiAccessAudit = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(startAiAccessAuditSchema)
  .handler(async ({ data, context }) => {
    const result = await AiAccessAuditService.startAudit({
      projectId: context.projectId,
      url: data.url,
      actorUserId: context.userId,
      customer: context,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "ai_access_audit:start",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId },
      }),
    );
    return result;
  });
export const getAiAccessAuditStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAiAccessAuditStatusSchema)
  .handler(({ data, context }) =>
    AiAccessAuditService.getStatus({
      projectId: context.projectId,
      auditId: data.auditId,
    }),
  );
export const getAiAccessAuditResults = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAiAccessAuditResultsSchema)
  .handler(({ data, context }) =>
    AiAccessAuditService.getResults({
      projectId: context.projectId,
      auditId: data.auditId,
    }),
  );
