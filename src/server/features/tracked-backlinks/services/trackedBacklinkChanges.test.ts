import { beforeEach, expect, it, vi } from "vitest";
import { trackedBacklinks, trackedBacklinkChecks } from "@/db/schema";
import { getTrackedBacklinkChanges } from "./trackedBacklinkChanges";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.db.insert(trackedBacklinks).values({
    id: "link",
    projectId: "project",
    sourceUrl: "https://source.example/post",
    targetUrl: "https://openseo.so/",
    createdAt: "2026-10-01T00:00:00.000Z",
  });
});

async function observe(
  index: number,
  status: "found" | "not_found" | "unverified",
  options: { targetUrl?: string; anchor?: string; rel?: string } = {},
) {
  const at = `2026-10-0${index}T00:00:00.000Z`;
  await testDb.db.insert(trackedBacklinkChecks).values({
    id: `check-${index}`,
    linkId: "link",
    projectId: "project",
    sourceUrl: "https://source.example/post",
    targetUrl: options.targetUrl ?? "https://openseo.so/",
    trigger: "manual",
    state: "completed",
    status,
    anchor: options.anchor ?? "OpenSEO",
    rel: options.rel ?? null,
    createdAt: at,
    completedAt: at,
    nextPollAt: at,
  });
}

it("reports a newly absent link while ignoring a later failed crawl", async () => {
  await observe(1, "found");
  await observe(2, "not_found");
  await observe(3, "unverified");
  expect((await getTrackedBacklinkChanges("project")).get("link")).toEqual({
    kind: "not_observed",
    at: "2026-10-02T00:00:00.000Z",
  });
});

it("reports recovery from the previous definitive absence", async () => {
  await observe(1, "not_found");
  await observe(2, "found");
  expect((await getTrackedBacklinkChanges("project")).get("link")?.kind).toBe(
    "recovered",
  );
});

it("does not compare a previous target URL or another project's observations", async () => {
  await observe(1, "found", { targetUrl: "https://openseo.so/old" });
  await observe(2, "not_found");
  expect(await getTrackedBacklinkChanges("project")).toEqual(new Map());
  expect(await getTrackedBacklinkChanges("other-project")).toEqual(new Map());
});

it("compares rel attributes as tokens rather than their order", async () => {
  await observe(1, "found", { rel: "nofollow sponsored" });
  await observe(2, "found", { rel: "sponsored nofollow nofollow" });
  expect(await getTrackedBacklinkChanges("project")).toEqual(new Map());
  await observe(3, "found", { rel: "sponsored" });
  expect((await getTrackedBacklinkChanges("project")).get("link")?.kind).toBe(
    "attributes_changed",
  );
});
