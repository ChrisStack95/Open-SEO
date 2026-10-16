import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fetchBacklinkVerificationResult,
  postBacklinkVerificationTask,
} from "@/server/lib/dataforseo/on-page";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

const sourceUrl = "https://publisher.example/article";
const targetUrl = "https://project.example/product";
const input = { taskId: "crawl-id", sourceUrl, targetUrl };

function response(result: unknown, overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [result], ...overrides }],
    }),
  );
}

function mockCompletedPage(overrides: Record<string, unknown> = {}) {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      response({
        crawl_progress: "finished",
        crawl_stop_reason: "limit_exceeded",
        domain_info: { extended_crawl_status: "no_errors" },
      }),
    )
    .mockResolvedValueOnce(
      response({
        items: [
          {
            resource_type: "html",
            status_code: 200,
            url: sourceUrl,
            ...overrides,
          },
        ],
      }),
    );
}

function link(overrides: Record<string, unknown> = {}) {
  return {
    type: "anchor",
    direction: "external",
    link_from: sourceUrl,
    link_to: targetUrl,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it("submits one exact source page with all optional paid rendering disabled", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    response(null, {
      status_code: 20100,
      id: "crawl-id",
      path: ["v3", "on_page", "task_post"],
      cost: 0,
    }),
  );
  await expect(
    postBacklinkVerificationTask({ sourceUrl, tag: "check-id" }),
  ).resolves.toEqual({
    data: { taskId: "crawl-id" },
    billing: { path: ["v3", "on_page", "task_post"], costUsd: 0 },
  });
  expect(fetch).toHaveBeenCalledWith(
    "https://api.dataforseo.com/v3/on_page/task_post",
    expect.objectContaining({
      body: JSON.stringify([
        {
          target: "publisher.example",
          start_url: sourceUrl,
          max_crawl_pages: 1,
          max_crawl_depth: 0,
          force_sitewide_checks: false,
          load_resources: false,
          enable_javascript: false,
          enable_browser_rendering: false,
          calculate_keyword_density: false,
          tag: "check-id",
        },
      ]),
    }),
  );
});

it("never retries an ambiguous paid submission failure", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response("upstream error", { status: 502 }),
  );
  await expect(
    postBacklinkVerificationTask({ sourceUrl, tag: "check-id" }),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("preserves billing metadata when a charged submission lacks its task ID", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    response(null, {
      status_code: 20100,
      path: ["v3", "on_page", "task_post"],
      cost: 0.001,
    }),
  );
  await expect(
    postBacklinkVerificationTask({ sourceUrl, tag: "check-id" }),
  ).rejects.toMatchObject({ billing: { costUsd: 0.001 } });
});

it.each([
  response({ crawl_progress: "in_progress" }),
  response(null, { status_code: 40602 }),
])("keeps incomplete crawls pending without reading links", async (pending) => {
  vi.mocked(fetch).mockResolvedValueOnce(pending);
  await expect(fetchBacklinkVerificationResult(input)).resolves.toEqual({
    status: "pending",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("returns observed anchor and rel tokens, preserving target queries and ignoring fragments", async () => {
  mockCompletedPage();
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      crawl_progress: "finished",
      total_items_count: 2,
      items: [
        link({ link_to: targetUrl + "?different=1" }),
        link({
          link_to: targetUrl + "#details",
          text: "Our product",
          link_attribute: ["sponsored", "nofollow"],
        }),
      ],
    }),
  );
  await expect(fetchBacklinkVerificationResult(input)).resolves.toEqual({
    status: "completed",
    found: true,
    anchor: "Our product",
    rel: "sponsored nofollow",
    httpStatus: 200,
    message: null,
  });
});

it("does not mistake canonical, internal, or another source's links for a backlink", async () => {
  mockCompletedPage();
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      crawl_progress: "finished",
      total_items_count: 3,
      items: [
        link({ type: "canonical" }),
        link({ direction: "internal" }),
        link({ link_from: sourceUrl + "/different" }),
      ],
    }),
  );
  await expect(fetchBacklinkVerificationResult(input)).resolves.toMatchObject({
    status: "completed",
    found: false,
  });
});

it.each([
  { resource_type: "broken", status_code: 403 },
  { url: "https://publisher.example/redirected" },
])(
  "reports failed or redirected source pages as unverified",
  async (overrides) => {
    mockCompletedPage(overrides);
    await expect(fetchBacklinkVerificationResult(input)).resolves.toMatchObject(
      { status: "completed", found: null },
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

it("does not report a robots exclusion as a missing link", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      crawl_progress: "finished",
      domain_info: { extended_crawl_status: "forbidden_robots" },
    }),
  );
  await expect(fetchBacklinkVerificationResult(input)).resolves.toMatchObject({
    status: "completed",
    found: null,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not report missing when a partial links page leaves unchecked results", async () => {
  mockCompletedPage();
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      crawl_progress: "finished",
      total_items_count: 2,
      items: [link({ link_to: targetUrl + "/different" })],
    }),
  );
  await expect(fetchBacklinkVerificationResult(input)).resolves.toMatchObject({
    status: "completed",
    found: null,
  });
});

it("rejects malformed provider links instead of silently treating them as absent", async () => {
  mockCompletedPage();
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      crawl_progress: "finished",
      total_items_count: 1,
      items: [{ type: "anchor" }],
    }),
  );
  await expect(fetchBacklinkVerificationResult(input)).rejects.toMatchObject({
    code: "UPSTREAM_UNAVAILABLE",
  });
});
