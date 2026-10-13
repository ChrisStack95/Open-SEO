import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import type { createDataforseoClient } from "@/server/lib/dataforseo";
import { runLiveCheck, runQueuedCheck } from "./rankCheckPaths";

const mocks = vi.hoisted(() => ({
  updateRun: vi.fn(),
  setRunErrorIfEmpty: vi.fn(),
  insertSnapshots: vi.fn(),
  getSnapshotsForRun: vi.fn(),
  fetchRankCheckTaskResult: vi.fn(),
  rankCheckTaskPost: vi.fn(),
  rankCheckBatch: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);
vi.mock("@/server/lib/dataforseo", () => ({
  MAX_TASKS_PER_POST: 100,
  fetchRankCheckTaskResult: mocks.fetchRankCheckTaskResult,
}));
vi.mock("@/server/workflows/pgStep", () => ({
  pgStep: (
    _step: unknown,
    _name: string,
    _config: unknown,
    fn: () => unknown,
  ) => fn(),
}));

const LIMIT_ERROR = new Error(
  "Too many subrequests by single Worker invocation.",
);
const actionableLimitError: unknown = expect.stringContaining(
  "Upgrade to Workers Paid and redeploy",
);

function keywords(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `kw_${index}`,
    keyword: `keyword ${index}`,
  }));
}

function context(keywordCount: number) {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the rank check calls are reached
    client: {
      serp: {
        rankCheckTaskPost: mocks.rankCheckTaskPost,
        rankCheckBatch: mocks.rankCheckBatch,
      },
    } as unknown as ReturnType<typeof createDataforseoClient>,
    keywords: keywords(keywordCount),
    devices: "desktop" as const,
    serpDepth: 10,
    domain: "example.com",
    locationCode: 2840,
    languageCode: "en",
    runId: "run_1",
  };
}

function rankResult(keywordId: string) {
  return {
    keywordId,
    keyword: keywordId,
    position: 3,
    url: null,
    serpFeatures: [],
  };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- steps run directly through the pgStep mock
const step = { sleep: mocks.sleep } as unknown as WorkflowStep;

describe("rank check at the platform subrequest limit", () => {
  beforeEach(() => {
    mocks.getSnapshotsForRun.mockResolvedValue([]);
    mocks.rankCheckTaskPost.mockImplementation(
      async ({ tasks }: { tasks: Array<{ keywordId: string }> }) =>
        tasks.map((task) => ({ ...task, taskId: `task_${task.keywordId}` })),
    );
  });

  it("stops a queued check without polling again or falling back to live calls", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The budget runs out partway through the second task_get chunk.
    let budget = 30;
    mocks.fetchRankCheckTaskResult.mockImplementation(
      async ({ keywordId }: { keywordId: string }) => {
        if (budget-- <= 0) throw LIMIT_ERROR;
        return { status: "completed", result: rankResult(keywordId) };
      },
    );

    const stats = await runQueuedCheck(step, context(80));

    expect(stats).toEqual({
      queueTasks: 80,
      queueCollected: 30,
      fallbackTasks: 0,
      fallbackChecked: 0,
    });
    // Two chunks of 25, then nothing: no third chunk, round, or fallback.
    expect(mocks.fetchRankCheckTaskResult).toHaveBeenCalledTimes(50);
    expect(mocks.sleep).toHaveBeenCalledTimes(1);
    expect(mocks.rankCheckBatch).not.toHaveBeenCalled();
    expect(mocks.insertSnapshots.mock.calls[0][0]).toHaveLength(30);
    expect(mocks.updateRun).toHaveBeenCalledWith("run_1", {
      errorMessage: actionableLimitError,
    });
  });

  it("stops a live check after the batch that hit the limit, keeping its results", async () => {
    mocks.rankCheckBatch.mockImplementation(
      async (inputs: Array<{ keywordId: string }>) =>
        inputs.map((input, index) =>
          index < 4
            ? { status: "fulfilled", value: rankResult(input.keywordId) }
            : { status: "rejected", reason: LIMIT_ERROR },
        ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runLiveCheck(step, context(30))).rejects.toThrow(
      "Too many subrequests",
    );

    expect(mocks.rankCheckBatch).toHaveBeenCalledTimes(1);
    expect(mocks.insertSnapshots.mock.calls[0][0]).toHaveLength(4);
    expect(mocks.updateRun).toHaveBeenCalledWith("run_1", {
      errorMessage: actionableLimitError,
    });
  });
});
