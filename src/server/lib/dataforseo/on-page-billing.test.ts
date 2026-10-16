import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fetchBacklinkVerificationPrice,
  fetchBacklinkVerificationTaskCost,
} from "@/server/lib/dataforseo/on-page-billing";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

function response(result: unknown[]) {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      tasks: [{ status_code: 20000, result }],
    }),
  );
}

function prices(overrides: Record<string, unknown> = {}) {
  const free = { priority_normal: [{ cost_type: "per_request", cost: 0 }] };
  return response([
    {
      price: {
        on_page: {
          task_post: {
            priority_normal: [
              { cost_type: "per_result", cost: 0.00012 },
              { cost_type: "per_request", cost: 0.00001 },
            ],
          },
          summary: free,
          pages: free,
          links: free,
          id_list: free,
          ...overrides,
        },
      },
    },
  ]);
}

const createdAt = new Date(Date.now() - 5 * 60_000);

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

it("uses this account's one-page price without a hard-coded public rate", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(prices());
  await expect(fetchBacklinkVerificationPrice()).resolves.toBeCloseTo(0.00013);
  expect(fetch).toHaveBeenCalledWith(
    "https://api.dataforseo.com/v3/appendix/user_data",
    expect.objectContaining({ method: "GET" }),
  );
});

it("accepts the documented account price shape that omits the free id_list endpoint", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(prices({ id_list: undefined }));
  await expect(fetchBacklinkVerificationPrice()).resolves.toBeCloseTo(0.00013);
});

it.each([
  {
    task_post: {
      priority_normal: [{ cost_type: "unknown_multiplier", cost: 0.00012 }],
    },
  },
  { links: { priority_normal: [{ cost_type: "per_request", cost: 0.01 }] } },
  { task_post: undefined },
])(
  "disables checks when a safe complete price is unavailable",
  async (overrides) => {
    vi.mocked(fetch).mockResolvedValueOnce(prices(overrides));
    await expect(fetchBacklinkVerificationPrice()).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it("reads the completed crawl's actual id_list cost including a zero-cost crawl", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(prices())
    .mockResolvedValueOnce(
      response([
        {
          id: "crawl-id",
          cost: 0,
          datetime_done: "2026-10-16 12:00:00 +00:00",
        },
      ]),
    );
  await expect(
    fetchBacklinkVerificationTaskCost({ taskId: "crawl-id", createdAt }),
  ).resolves.toEqual({ taskId: "crawl-id", costUsd: 0 });
  expect(fetch).toHaveBeenLastCalledWith(
    "https://api.dataforseo.com/v3/on_page/id_list",
    expect.objectContaining({ method: "POST" }),
  );
});

it("reconciles when the account price table omits the documented free id_list endpoint", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(prices({ id_list: undefined }))
    .mockResolvedValueOnce(
      response([
        {
          id: "crawl-id",
          cost: 0.00012,
          datetime_done: "2026-10-16 12:00:00 +00:00",
        },
      ]),
    );
  await expect(
    fetchBacklinkVerificationTaskCost({ taskId: "crawl-id", createdAt }),
  ).resolves.toEqual({ taskId: "crawl-id", costUsd: 0.00012 });
});

it("recovers an uncertain submission by its persisted tag without another task_post", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(prices())
    .mockResolvedValueOnce(
      response([
        {
          id: "recovered",
          cost: 0.00012,
          datetime_done: "2026-10-16 12:00:00 +00:00",
          metadata: { tag: "check-id" },
        },
      ]),
    );
  await expect(
    fetchBacklinkVerificationTaskCost({ tag: "check-id", createdAt }),
  ).resolves.toEqual({ taskId: "recovered", costUsd: 0.00012 });
  const body = vi.mocked(fetch).mock.calls[1]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected JSON request body");
  expect(JSON.parse(body)).toEqual([
    expect.objectContaining({ include_metadata: true }),
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
  { rows: [] },
  { rows: [{ id: "crawl-id", cost: 0.00012, datetime_done: null }] },
  { rows: [{ id: "crawl-id", datetime_done: "2026-10-16 12:00:00 +00:00" }] },
])("keeps an unknown or incomplete cost unresolved", async ({ rows }) => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(prices())
    .mockResolvedValueOnce(response(rows));
  await expect(
    fetchBacklinkVerificationTaskCost({ taskId: "crawl-id", createdAt }),
  ).resolves.toBeNull();
});

it("paginates id_list rather than losing a task beyond the first thousand rows", async () => {
  const beforeRead = vi.fn(async () => {});
  vi.mocked(fetch)
    .mockResolvedValueOnce(prices())
    .mockResolvedValueOnce(
      response(Array.from({ length: 1000 }, (_, i) => ({ id: `other-${i}` }))),
    )
    .mockResolvedValueOnce(
      response([
        {
          id: "crawl-id",
          cost: 0.00012,
          datetime_done: "2026-10-16 12:00:00 +00:00",
        },
      ]),
    );
  await expect(
    fetchBacklinkVerificationTaskCost({
      taskId: "crawl-id",
      createdAt,
      beforeRead,
    }),
  ).resolves.toEqual({ taskId: "crawl-id", costUsd: 0.00012 });
  expect(beforeRead).toHaveBeenCalledTimes(2);
  const body = vi.mocked(fetch).mock.calls[2]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected JSON request body");
  expect(JSON.parse(body)).toEqual([expect.objectContaining({ offset: 1000 })]);
});

it("does not call id_list when the shared account read quota cannot be acquired", async () => {
  const beforeRead = vi.fn(async () => {
    throw new Error("Read quota deadline exceeded");
  });
  vi.mocked(fetch).mockResolvedValueOnce(prices());
  await expect(
    fetchBacklinkVerificationTaskCost({
      taskId: "crawl-id",
      createdAt,
      beforeRead,
    }),
  ).rejects.toThrow("Read quota deadline exceeded");
  expect(beforeRead).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    "https://api.dataforseo.com/v3/appendix/user_data",
    expect.anything(),
  );
});

it("does not bypass the read quota with an automatic HTTP retry", async () => {
  const beforeRead = vi.fn(async () => {});
  vi.mocked(fetch)
    .mockResolvedValueOnce(prices())
    .mockResolvedValue(new Response("upstream error", { status: 502 }));
  await expect(
    fetchBacklinkVerificationTaskCost({
      taskId: "crawl-id",
      createdAt,
      beforeRead,
    }),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  expect(beforeRead).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not read a billable id_list after an account price change", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    prices({
      id_list: { priority_normal: [{ cost_type: "per_request", cost: 0.01 }] },
    }),
  );
  await expect(
    fetchBacklinkVerificationTaskCost({ taskId: "crawl-id", createdAt }),
  ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("still reconciles earlier work when the account's new crawl pricing is unsupported", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(prices({ task_post: undefined, links: undefined }))
    .mockResolvedValueOnce(
      response([
        {
          id: "crawl-id",
          cost: 0.00012,
          datetime_done: "2026-10-16 12:00:00 +00:00",
        },
      ]),
    );
  await expect(
    fetchBacklinkVerificationTaskCost({ taskId: "crawl-id", createdAt }),
  ).resolves.toEqual({ taskId: "crawl-id", costUsd: 0.00012 });
});

it("uses one cancellation deadline across account pricing and paginated task costs", async () => {
  const signal = AbortSignal.timeout(30_000);
  vi.mocked(fetch)
    .mockResolvedValueOnce(prices())
    .mockResolvedValueOnce(
      response(Array.from({ length: 1000 }, (_, i) => ({ id: `other-${i}` }))),
    )
    .mockResolvedValueOnce(
      response([
        {
          id: "crawl-id",
          cost: 0.00012,
          datetime_done: "2026-10-16 12:00:00 +00:00",
        },
      ]),
    );
  await fetchBacklinkVerificationTaskCost({
    taskId: "crawl-id",
    createdAt,
    signal,
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([, options]) => options?.signal === signal),
  ).toBe(true);
});
