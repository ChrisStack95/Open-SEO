import Papa from "papaparse";
import { z } from "zod";
import {
  mapRedirects,
  type RedirectPage,
} from "@/server/lib/redirect-mapping/redirect-mapping";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
  mode: z.enum(["migration", "retirement"]),
  oldPages: z
    .string()
    .min(1)
    .max(2_000_000)
    .describe(
      "Old crawl CSV, with Address, Title 1, H1-1, H2-1 columns, or one URL per line.",
    ),
  newPages: z
    .string()
    .min(1)
    .max(2_000_000)
    .describe(
      "New crawl CSV or one URL per line. In retirement mode include a Collection column with true for collection URLs, or URLs containing /collections/.",
    ),
};
type Args = z.infer<z.ZodObject<typeof inputSchema>>;

function parsePages(input: string): RedirectPage[] {
  const rows = Papa.parse<string[]>(input.trim(), {
    skipEmptyLines: true,
  }).data;
  const headers = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const address = headers.findIndex((header) =>
    ["address", "url"].includes(header),
  );
  if (address < 0)
    return rows
      .map(([url]) => ({ url: url?.trim() ?? "" }))
      .filter((row) => row.url);
  const get = (row: string[], ...keys: string[]) =>
    row[headers.findIndex((header) => keys.includes(header))] ?? "";
  return rows
    .slice(1)
    .map((row) => ({
      url: row[address]?.trim() ?? "",
      title: get(row, "title 1", "title"),
      h1: get(row, "h1-1", "h1"),
      h2: get(row, "h2-1", "h2"),
      breadcrumb: get(row, "breadcrumb"),
      collection:
        get(row, "collection").toLowerCase() === "true" ||
        row[address]?.includes("/collections/"),
      inlinks: get(row, "inlinks sources").split("|").filter(Boolean),
    }))
    .filter((row) => row.url);
}

export const redirectMappingTool = {
  name: "map_redirects",
  config: {
    title: "Map redirects",
    description:
      "Build a deterministic redirect review map from pasted old and new crawl data. Never deploy redirects automatically; review ambiguous mappings manually.",
    inputSchema,
    outputSchema: z
      .object({
        results: z.array(
          z.object({
            source: z.string(),
            target: z.string().nullable(),
            score: z.number(),
            tier: z.enum(["high", "review", "no_match"]),
            methods: z.array(z.string()),
          }),
        ),
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
    const results = mapRedirects({
      mode: args.mode,
      oldPages: parsePages(args.oldPages),
      newPages: parsePages(args.newPages),
    });
    return mcpResponse({
      text: JSON.stringify(results),
      structuredContent: { results },
      meta: buildProjectMeta(context, args.projectId),
    });
  }),
};
