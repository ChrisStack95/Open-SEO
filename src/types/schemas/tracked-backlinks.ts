import { z } from "zod";

// Canonical URLs retain query strings and path case. Fragments never reach
// the server and are excluded from pair deduplication and provider matching.
const webUrl = z
  .url()
  .max(2048)
  .transform((value, ctx) => {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Use an HTTP or HTTPS URL without credentials.",
      });
      return z.NEVER;
    }
    url.hash = "";
    return url.href;
  })
  .pipe(
    z
      .string()
      .max(1000, "The normalized URL must be 1,000 characters or fewer."),
  );
export const trackedBacklinkProjectSchema = z.object({
  projectId: z.string().min(1),
});
export const trackedBacklinkIdSchema = trackedBacklinkProjectSchema.extend({
  id: z.string().min(1),
});
export const createTrackedBacklinkSchema = trackedBacklinkProjectSchema.extend({
  sourceUrl: webUrl,
  targetUrl: webUrl,
  acquiredOn: z.iso.date().nullable().default(null),
  notes: z.string().max(10000).default(""),
});
export const updateTrackedBacklinkSchema = createTrackedBacklinkSchema.extend({
  id: z.string().min(1),
  paused: z.boolean(),
});
export const updateTrackedBacklinkConfigSchema =
  trackedBacklinkProjectSchema.extend({
    scheduleInterval: z.enum(["off", "daily", "weekly"]),
    monthlyCheckLimit: z.number().int().min(0).max(10000),
    maxCostUsdPerCheck: z.number().finite().nonnegative().default(0),
  });
export const checkTrackedBacklinksSchema = trackedBacklinkProjectSchema.extend({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .transform((ids) => [...new Set(ids)]),
  maxCostUsd: z.number().finite().nonnegative(),
});
