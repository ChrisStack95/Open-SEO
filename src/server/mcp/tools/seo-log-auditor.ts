import { z } from "zod";
import { analyzeAccessLogs } from "@/server/lib/seo-log-auditor/analyze";
import { mcpResponse } from "@/server/mcp/formatters";
import { looseObjectOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
  accessLogs: z
    .string()
    .min(1)
    .max(5_000_000, "Access logs must be 5 million characters or fewer.")
    .describe(
      "Raw nginx combined access-log lines; pasted text only. No URL fetching.",
    ),
} as const;

export const seoLogAuditorTool = {
  name: "audit_googlebot_logs",
  config: {
    title: "Audit Googlebot access logs",
    description:
      "Analyze pasted nginx combined access logs for claimed Googlebot crawl hits, status waste, daily crawl frequency and directory breakdowns. User-agent matching does not verify bot identity. No network calls.",
    inputSchema,
    outputSchema: z.object({ analysis: looseObjectOutputSchema }).passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof inputSchema>>) => {
      const analysis = analyzeAccessLogs(args.accessLogs);
      return mcpResponse({
        text: `Analyzed ${analysis.totalHits} claimed Googlebot hits; ${analysis.waste.non_200} non-200 responses (${(analysis.waste.waste_ratio * 100).toFixed(1)}%).`,
        structuredContent: { analysis },
      });
    },
  ),
};
