import { waitUntil } from "cloudflare:workers";
import { BacklinkCostReadRepository } from "../repositories/BacklinkCostReadRepository";
import {
  TrackedBacklinksRepository as repo,
  type CheckRow,
} from "../repositories/TrackedBacklinksRepository";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { fetchBacklinkVerificationTaskCost } from "@/server/lib/dataforseo/on-page-billing";
import {
  postBacklinkVerificationTask,
  fetchBacklinkVerificationResult,
} from "@/server/lib/dataforseo/on-page";
import {
  getOrCreateOrganizationCustomer,
  reserveUsageCredits,
  settleUsageCredits,
  type UsageCreditHold,
  type BillingCustomerContext,
} from "@/server/billing/subscription";
import { creditsForProviderUsd } from "@/shared/billing";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";

// Autumn's longest lock is 24 hours. Keep a minute for clock skew and
// persist the lock before dispatching the non-idempotent task_post.
const BACKLINK_HOLD_TTL_MS = 24 * 60 * 60_000 - 60_000;
export async function assertBacklinkBillingReady(
  customer: BillingCustomerContext,
) {
  if (!(await isHostedServerAuthMode())) return;
  // Stop admitting new spend before an unresolved hold can expire. The
  // existing durable record remains available for actual-cost reconciliation.
  const before = new Date(Date.now() - 23 * 60 * 60_000).toISOString();
  if (await repo.hasOverdueBilling(customer.organizationId, before)) {
    throw new AppError(
      "CONFLICT",
      "Backlink checks are paused while an earlier provider charge is reconciled. Contact support to resume checks.",
    );
  }
}

function checkHold(check: CheckRow): UsageCreditHold | null {
  if (
    !check.billingLockId ||
    !check.billingFeatureId ||
    check.billingEstimatedCredits === null
  )
    return null;
  return {
    lockId: check.billingLockId,
    featureId: check.billingFeatureId,
    estimatedCredits: check.billingEstimatedCredits,
    callIndexes: [0],
  };
}
async function reconcileBacklinkBilling(
  check: CheckRow,
  customer: BillingCustomerContext,
  signal?: AbortSignal,
) {
  const hold = checkHold(check);
  if (!hold || check.billingSettledAt) return;
  // cost=0 on task_post/summary is not the final crawl cost. id_list is
  // authoritative, and the persisted tag recovers ambiguous submissions.
  let costUsd = check.billingActualCostUsd;
  if (costUsd === null) {
    const billed = await fetchBacklinkVerificationTaskCost({
      beforeRead: () =>
        waitForBacklinkCostRead(customer.organizationId, signal),
      taskId: check.taskId ?? undefined,
      tag: check.id,
      createdAt: new Date(check.createdAt),
      signal,
    });
    if (!billed) return;
    costUsd = billed.costUsd;
    // Keep the provider's authoritative amount even if finalization fails or
    // its task history expires before reconciliation can be retried.
    await repo.recordBillingCost(check.id, costUsd);
  }
  // Never interpret a missing expired lock as a successful charge. Leave a
  // margin for the finalize retry; overdue work keeps admission paused.
  if (
    Date.now() >=
    Date.parse(check.createdAt) + BACKLINK_HOLD_TTL_MS - 120_000
  )
    return;
  const landed = await settleUsageCredits({
    customer,
    hold,
    creditFeature: "backlinks",
    costs: [{ costUsd, path: ["v3", "on_page", "task_post"] }],
  });
  if (landed) await repo.billingSettled(check.id, costUsd);
}
export async function submitBacklinkCheck(
  check: CheckRow,
  customer: BillingCustomerContext,
  signal?: AbortSignal,
) {
  const claimed = await repo.claimSubmission(check.id);
  if (!claimed) return;
  const work = (async () => {
    let dispatched = false;
    let hold: UsageCreditHold | null = null;
    try {
      await assertBacklinkBillingReady(customer);
      const raw = await dataforseoPricing.onPage.backlinkVerificationTask({
        sourceUrl: check.sourceUrl,
        signal,
      });
      if (
        check.billingEstimatedCostUsd === null ||
        raw > check.billingEstimatedCostUsd + 1e-12
      )
        throw new AppError(
          "VALIDATION_ERROR",
          "Provider pricing changed. Review the estimate before checking again.",
        );
      if (await isHostedServerAuthMode()) {
        const billingCustomer = await getOrCreateOrganizationCustomer(customer);
        const reserved = await reserveUsageCredits({
          customer,
          customerId: billingCustomer.id,
          callCredits: [creditsForProviderUsd(raw)],
          creditFeature: "backlinks",
          ttlMs: BACKLINK_HOLD_TTL_MS,
        });
        hold = reserved.holds[0];
        await repo.saveBillingHold(check.id, hold, raw);
      }
      dispatched = true;
      const result = await postBacklinkVerificationTask({
        sourceUrl: check.sourceUrl,
        tag: check.id,
        signal,
      });
      await repo.submitted(check.id, result.data.taskId);
    } catch (error) {
      // A network error may hide an accepted paid crawl. Keep that hold and
      // reconcile it by tag; never replay a non-idempotent submission.
      if (!dispatched) {
        if (
          hold &&
          (await settleUsageCredits({
            customer,
            hold,
            creditFeature: "backlinks",
            costs: [],
          }))
        )
          await repo.billingSettled(check.id, 0);
        await repo.release(check.projectId, check.createdAt.slice(0, 7));
      }
      await repo.finish(check, {
        status: "unverified",
        error: !dispatched
          ? error instanceof AppError
            ? error.message
            : "The check could not start. No check was submitted."
          : "The check could not be confirmed. It was not automatically retried.",
      });
      throw error;
    }
  })();
  // Keep dispatch and persistence alive when the requesting browser leaves.
  try {
    waitUntil(work.catch(() => undefined));
  } catch {
    /* cron/test context */
  }
  await work;
}

export async function processPendingBacklinkChecks(projectId?: string) {
  const budgetMs = projectId ? 30_000 : 120_000;
  const deadline = Date.now() + budgetMs;
  const signal = AbortSignal.timeout(budgetMs);
  const due = await repo.dueChecks(new Date().toISOString(), projectId);
  for (const { check, organizationId } of due.slice(0, projectId ? 5 : 50)) {
    if (Date.now() >= deadline) break;
    try {
      const customer = {
        organizationId,
        projectId: check.projectId,
        userId: "system",
        userEmail: "system@openseo.so",
      };
      if (check.state === "queued") {
        await submitBacklinkCheck(check, customer, signal);
        continue;
      }
      if (!(await repo.claimPoll(check))) continue;
      if (check.state === "completed") {
        await reconcileBacklinkBilling(check, customer, signal);
        continue;
      }
      if (check.state === "submitting") {
        await repo.finish(check, {
          status: "unverified",
          error:
            "Submission could not be confirmed. It was not automatically retried.",
        });
        continue;
      }
      if (!check.taskId) {
        await repo.finish(check, {
          status: "unverified",
          error: "The provider returned no task ID.",
        });
        continue;
      }
      if (Date.now() - Date.parse(check.createdAt) > 24 * 60 * 60_000) {
        await repo.finish(check, {
          status: "unverified",
          error: "The provider did not finish within 24 hours.",
        });
        continue;
      }
      // Re-check collection is free before every poll, including long-lived
      // tasks whose account pricing may have changed since dispatch.
      await dataforseoPricing.onPage.backlinkVerificationTask({
        sourceUrl: check.sourceUrl,
        signal,
      });
      const result = await fetchBacklinkVerificationResult({
        taskId: check.taskId,
        sourceUrl: check.sourceUrl,
        targetUrl: check.targetUrl,
        signal,
      });
      if (result.status === "completed") {
        await reconcileBacklinkBilling(check, customer, signal);
        await repo.finish(check, {
          status:
            result.found === true
              ? "found"
              : result.found === false
                ? "not_found"
                : "unverified",
          anchor: result.anchor,
          rel: result.rel,
          error: result.message,
        });
      }
    } catch (error) {
      // Polls are free reads and may be retried. The lease prevents repeated
      // page refreshes from hammering the provider or launching another task.
      console.error("[tracked-backlinks] check processing failed", {
        checkId: check.id,
        error,
      });
    }
  }
}

/** Keep every id_list page inside its account-wide ten-per-minute quota. */
export async function waitForBacklinkCostRead(
  organizationId: string,
  signal?: AbortSignal,
) {
  // Standalone callers get the same short deadline as a page refresh. Polling
  // passes its shared deadline so pagination cannot extend request lifetime.
  const deadline = signal ?? AbortSignal.timeout(30_000);
  for (;;) {
    deadline.throwIfAborted();
    if (await BacklinkCostReadRepository.claim(organizationId)) {
      deadline.throwIfAborted();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(deadline.reason);
      };
      const timer = setTimeout(() => {
        deadline.removeEventListener("abort", onAbort);
        resolve();
      }, 500);
      deadline.addEventListener("abort", onAbort, { once: true });
      // Catch an abort between the claim and listener installation.
      if (deadline.aborted) onAbort();
    });
  }
}
