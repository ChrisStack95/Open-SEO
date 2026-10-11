import { z } from "zod";
import { analyzeStrikingDistance } from "@/server/lib/striking-distance/analyze";
import { mcpResponse } from "@/server/mcp/formatters";
import { looseObjectOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
  rankingsCsv: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024, "Rankings CSV/TSV must be 2 MB or smaller."),
  crawlCsv: z
    .string()
    .max(2 * 1024 * 1024, "Crawl CSV/TSV must be 2 MB or smaller.")
    .optional(),
  brandRules: z
    .object({
      brandName: z.string().optional(),
      titleSuffix: z.string().optional(),
      forbiddenTerms: z.array(z.string()).optional(),
      preferredVocabulary: z.array(z.string()).optional(),
      metaLengthCap: z.number().int().min(1).max(1000).optional(),
    })
    .optional(),
  minSearchVolume: z.number().nonnegative().optional(),
} as const;

export const strikingDistanceTool = {
  name: "analyze_striking_distance",
  config: {
    title: "Analyze striking-distance keywords",
    description:
      "Analyze pasted Semrush rankings CSV/TSV (Keyword, Position, Search Volume, URL) and optional Screaming Frog Internal_All CSV/TSV (Address, Title 1, Meta Description 1, H1-1). Finds position 4–20 opportunities with default volume ≥50; deterministic templates only, not AI-written copy. No network calls.",
    inputSchema,
    outputSchema: z
      .object({ pages: z.array(looseObjectOutputSchema) })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof inputSchema>>) => {
      const pages = analyzeStrikingDistance(args);
      return mcpResponse({
        text: `Found ${pages.length} pages with striking-distance opportunities. Templates are starting points for human review.`,
        structuredContent: { pages },
      });
    },
  ),
};
