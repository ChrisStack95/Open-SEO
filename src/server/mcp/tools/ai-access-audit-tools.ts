import { z } from "zod";
import { AiAccessAuditService } from "@/server/features/ai-access/services/AiAccessAuditService";
import { AppError } from "@/server/lib/errors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const runInputSchema = {
  projectId: projectIdSchema,
  url: z.string().url().max(2048).describe("Public site URL to inspect."),
} as const;
const readInputSchema = {
  projectId: projectIdSchema,
  auditId: z
    .string()
    .optional()
    .describe("Audit ID; omit for the latest audit in this project."),
} as const;
type RunArgs = z.infer<z.ZodObject<typeof runInputSchema>>;
type ReadArgs = z.infer<z.ZodObject<typeof readInputSchema>>;

function auditPath(projectId: string, auditId?: string) {
  return `/p/${projectId}/ai-access-audit${auditId ? `?auditId=${encodeURIComponent(auditId)}` : ""}`;
}

export const runAiAccessAuditTool = {
  name: "run_ai_access_audit",
  config: {
    title: "Run AI access audit",
    description:
      "Check whether AI crawlers can reach a site and inspect robots.txt, llms.txt, structured data, and page rendering signals. Runs in the background; poll get_ai_access_audit_status, then call get_ai_access_audit_results. This is an access diagnosis, not a measurement of AI answer visibility.",
    inputSchema: runInputSchema,
    outputSchema: z
      .object({ auditId: z.string(), ...optionalMetaOutputSchema })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: RunArgs, context) => {
    const started = await AiAccessAuditService.startAudit({
      projectId: args.projectId,
      url: args.url,
      actorUserId: context.auth.userId,
      customer: context.billing,
    });
    return mcpResponse({
      text: `AI access audit ${started.auditId} started for ${started.url}. Poll get_ai_access_audit_status and then call get_ai_access_audit_results.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, started.auditId),
      ),
      structuredContent: started,
    });
  }),
};

export const getAiAccessAuditStatusTool = {
  name: "get_ai_access_audit_status",
  config: {
    title: "Get AI access audit status",
    description:
      "Read the status of a project's AI access audit. Omit auditId for the latest audit.",
    inputSchema: readInputSchema,
    outputSchema: z
      .object({ audit: looseObjectOutputSchema, ...optionalMetaOutputSchema })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ReadArgs, context) => {
    const audit = await AiAccessAuditService.getStatus(args);
    if (!audit)
      throw new AppError(
        "NOT_FOUND",
        "No AI access audit found in this project.",
      );
    return mcpResponse({
      text: `AI access audit ${audit.id}: ${audit.status}${audit.status === "completed" ? ". Call get_ai_access_audit_results for the findings." : ""}`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, audit.id),
      ),
      structuredContent: { audit },
    });
  }),
};

export const getAiAccessAuditResultsTool = {
  name: "get_ai_access_audit_results",
  config: {
    title: "Get AI access audit results",
    description:
      "Read a project's AI access audit findings and component scores. Results are null until the audit completes. Omit auditId for the latest audit.",
    inputSchema: readInputSchema,
    outputSchema: z
      .object({
        audit: looseObjectOutputSchema,
        results: looseObjectOutputSchema.nullable(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ReadArgs, context) => {
    const response = await AiAccessAuditService.getResults(args);
    if (!response)
      throw new AppError(
        "NOT_FOUND",
        "No AI access audit found in this project.",
      );
    const results = response.results ? JSON.parse(response.results) : null;
    return mcpResponse({
      text: results
        ? `AI access score: ${results.overallScore}/100. Check each component and its evidence before recommending changes.`
        : `AI access audit ${response.audit.id}: ${response.audit.status}. Results are not available yet.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        auditPath(args.projectId, response.audit.id),
      ),
      structuredContent: { audit: response.audit, results },
    });
  }),
};
