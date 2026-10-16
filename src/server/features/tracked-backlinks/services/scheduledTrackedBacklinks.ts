import { TrackedBacklinksRepository as repo } from "../repositories/TrackedBacklinksRepository";
import { TrackedBacklinksService as service } from "./TrackedBacklinksService";
import { computeNextCheckAt } from "@/shared/rank-tracking";
import {
  isHostedServerAuthMode,
  getOptionalEnvValue,
} from "@/server/lib/runtime-env";
import { customerHasPaidPlan } from "@/server/billing/subscription";

const TASK_BUDGET = 50;
export async function runScheduledTrackedBacklinks() {
  await service.processPending();
  if (!(await getOptionalEnvValue("DATAFORSEO_API_KEY"))) return;
  const deadline = Date.now() + 2 * 60_000;
  const signal = AbortSignal.timeout(2 * 60_000);
  const hosted = await isHostedServerAuthMode();
  const paidChecks = new Map<string, Promise<boolean>>();
  let admitted = 0;
  for (const { config, organizationId } of await repo.dueConfigs(
    new Date().toISOString(),
  )) {
    if (Date.now() >= deadline || admitted >= TASK_BUDGET) break;
    if (config.scheduleInterval === "off" || !config.nextCheckAt) continue;
    const slot = config.nextCheckAt;
    await repo.updateConfig(config.projectId, {
      lastProcessedAt: new Date().toISOString(),
    });
    const advance = () =>
      repo.claimSchedule(
        config,
        computeNextCheckAt(
          config.scheduleInterval === "off"
            ? "weekly"
            : config.scheduleInterval,
          slot,
        ),
      );
    const advanceAndSkip = async (reason: string) => {
      if (await advance())
        await repo.updateConfig(config.projectId, { lastSkipReason: reason });
    };
    try {
      if (hosted) {
        let paid = paidChecks.get(organizationId);
        if (!paid) {
          paid = customerHasPaidPlan(organizationId);
          paidChecks.set(organizationId, paid);
        }
        if (!(await paid)) {
          await advanceAndSkip("A paid plan is required for automatic checks.");
          continue;
        }
      }
      const current = await service.estimate(signal);
      if (
        !current ||
        current.costUsdPerCheck > config.maxCostUsdPerCheck + 1e-8
      ) {
        if (await advance())
          await repo.updateConfig(config.projectId, {
            lastSkipReason:
              "The check price changed. Review and save automatic check settings to approve the new estimate.",
          });
        continue;
      }
      const customer = {
        organizationId,
        projectId: config.projectId,
        userId: "system",
        userEmail: "system@openseo.so",
      };
      // Persist progress on each link. A project larger than one tick stays
      // due and resumes next tick, without posting the same link twice.
      for (const link of await repo.scheduledLinks(
        config.projectId,
        slot,
        Math.min(5, TASK_BUDGET - admitted),
      )) {
        if (Date.now() >= deadline || admitted >= TASK_BUDGET) break;
        const claimed = await repo.claimScheduledLink(link, slot);
        if (!claimed) continue;
        admitted++;
        const result = await service.queue(claimed, "scheduled", customer, {
          signal,
        });
        if (result === "budget") {
          await advanceAndSkip("Monthly check limit reached.");
          break;
        }
      }
      if (!(await repo.scheduledLinks(config.projectId, slot, 1)).length)
        await advance();
    } catch (error) {
      console.error("[tracked-backlinks] scheduled check failed", {
        projectId: config.projectId,
        error,
      });
    }
  }
}
