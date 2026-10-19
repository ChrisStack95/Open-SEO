import { z } from "zod";
import { generateLlmsTxt } from "@/server/lib/llms-txt/llms-txt";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
  siteName: z.string().min(1).max(200),
  summary: z.string().max(1000).optional(),
  pages: z
    .array(
      z.object({
        url: z.url().max(2048),
        title: z.string().max(500).optional(),
        description: z.string().max(2000).optional(),
        content: z.string().max(100_000).optional(),
        canonical: z.url().optional(),
        indexable: z.boolean().optional(),
        statusCode: z.number().int().optional(),
        depth: z.number().optional(),
        uniqueInlinks: z.number().optional(),
        linkScore: z.number().optional(),
        wordCount: z.number().optional(),
      }),
    )
    .min(1)
    .max(200)
    .refine(
      (pages) => JSON.stringify(pages).length <= 2_000_000,
      "Page data exceeds 2 MB",
    ),
};
type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const generateLlmsTxtTool = {
  name: "generate_llms_txt",
  config: {
    title: "Generate llms.txt",
    description:
      "Create llms.txt and llms-full.txt from supplied page metadata and content only. Does not crawl, scrape, or generate AI summaries.",
    inputSchema,
    outputSchema: z
      .object({
        llmsTxt: z.string(),
        llmsFullTxt: z.string(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const output = generateLlmsTxt(args);
    return mcpResponse({
      text: output.llmsTxt,
      structuredContent: output,
      meta: buildProjectMeta(context, args.projectId),
    });
  }),
};
