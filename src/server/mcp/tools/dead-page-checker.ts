import { z } from "zod";
import {
  analyseDeadPages,
  parseDeadPageHtml,
  type DeadPage,
} from "@/server/lib/dead-page-checker/dead-page-checker";
import {
  normalizeAndValidateStartUrl,
  resolveStartUrlRedirects,
} from "@/server/lib/audit/url-policy";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
  pages: z
    .array(
      z.object({
        url: z.string().max(2048),
        bucket: z.enum(["collection", "page", "blog"]),
        status: z.number().int().optional(),
        productCount: z.number().int().optional(),
        mainLength: z.number().int().optional(),
        wordCount: z.number().int().optional(),
        title: z.string().optional(),
        challenged: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (pages) => JSON.stringify(pages).length <= 2_000_000,
      "Page data exceeds 2 MB",
    ),
  fetchPages: z
    .boolean()
    .optional()
    .describe(
      "Fetch URLs with SSRF validation; otherwise analyse provided measurements.",
    ),
};
type Args = z.infer<z.ZodObject<typeof inputSchema>>;

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 2_000_000) throw new Error("Response exceeds 2 MB");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchPage(page: Args["pages"][number]): Promise<DeadPage> {
  const base = {
    url: page.url,
    bucket: page.bucket,
    status: 0,
    productCount: 0,
    mainLength: 0,
    wordCount: 0,
  };
  const safeUrl = await normalizeAndValidateStartUrl(page.url);
  const resolved = await resolveStartUrlRedirects(safeUrl);
  const url = await normalizeAndValidateStartUrl(resolved.url);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "OpenSEO-Audit/1.0" },
    });
    if (response.status >= 300 && response.status < 400)
      return {
        ...base,
        error: "Redirect changed after validation; retry from the new URL",
      };
    const html = await readLimited(response);
    return { ...base, status: response.status, ...parseDeadPageHtml(html) };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const checkDeadPagesTool = {
  name: "check_dead_pages",
  config: {
    title: "Check dead pages",
    description:
      "Classify empty collections, thin pages, blocked fetches and collections requiring human review. Optionally fetch up to 50 URLs using SSRF-checked requests.",
    inputSchema,
    outputSchema: z
      .object({
        results: z.array(
          z
            .object({
              url: z.string(),
              bucket: z.string(),
              classification: z.string(),
              reviewReasons: z.array(z.string()),
            })
            .passthrough(),
        ),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const pages: DeadPage[] = [];
    if (args.fetchPages) {
      for (let index = 0; index < args.pages.length; index += 5) {
        pages.push(
          ...(await Promise.all(
            args.pages.slice(index, index + 5).map(fetchPage),
          )),
        );
      }
    } else {
      pages.push(
        ...args.pages.map((page) => ({
          ...page,
          status: page.status ?? 0,
          productCount: page.productCount ?? 0,
          mainLength: page.mainLength ?? 0,
          wordCount: page.wordCount ?? 0,
        })),
      );
    }
    const results = analyseDeadPages(pages);
    return mcpResponse({
      text: JSON.stringify(results),
      structuredContent: { results },
      meta: buildProjectMeta(context, args.projectId),
    });
  }),
};
