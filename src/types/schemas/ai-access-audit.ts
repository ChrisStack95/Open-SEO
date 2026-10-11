import { z } from "zod";

export const startAiAccessAuditSchema = z.object({
  projectId: z.string().min(1),
  url: z.string().url(),
});
export const getAiAccessAuditStatusSchema = z.object({
  projectId: z.string().min(1),
  auditId: z.string().min(1).optional(),
});
export const aiAccessAuditResultsSchema = z.object({
  url: z.string(),
  overallScore: z.number(),
  js: z
    .object({ score: z.number(), riskFactors: z.array(z.string()) })
    .passthrough(),
  llmTxt: z.object({
    score: z.number(),
    files: z.record(
      z.string(),
      z.object({
        found: z.boolean(),
        url: z.string(),
        content: z.string(),
        quality: z
          .object({
            hasTitle: z.boolean(),
            hasDescription: z.boolean(),
            hasLinks: z.boolean(),
            hasSections: z.boolean(),
            charCount: z.number(),
            lineCount: z.number(),
          })
          .optional(),
      }),
    ),
  }),
  robots: z
    .object({
      score: z.number(),
      found: z.boolean(),
      aiAgents: z.record(
        z.string(),
        z.object({
          company: z.string(),
          ua: z.string(),
          robotsAllowed: z.boolean(),
        }),
      ),
      blockedResources: z.array(z.string()),
      sensitivePaths: z.record(
        z.string(),
        z.object({
          accessiblePerRobots: z.boolean(),
          mentionedInRobots: z.boolean(),
        }),
      ),
    })
    .passthrough(),
  schema: z
    .object({
      score: z.number(),
      found: z.boolean(),
      schemas: z.array(
        z.object({
          type: z.string(),
          format: z.string(),
          data: z.record(z.string(), z.unknown()),
        }),
      ),
    })
    .passthrough(),
  pageMeta: z.object({
    metaTags: z.array(z.object({ name: z.string(), content: z.string() })),
    xRobotsTag: z.string().nullable(),
    nosnippetElements: z.number(),
    htmlLength: z.number(),
    textLength: z.number(),
  }),
  wellKnown: z.record(
    z.string(),
    z.object({
      found: z.boolean(),
      url: z.string(),
      content: z.string().optional(),
    }),
  ),
  botCrawl: z.array(
    z.object({
      name: z.string(),
      company: z.string(),
      status: z.number().optional(),
      robotsAllowed: z.boolean().nullable(),
      noindex: z.boolean(),
      title: z.string(),
      loadTimeMs: z.number(),
      contentLength: z.number(),
      error: z.string().optional(),
    }),
  ),
});
