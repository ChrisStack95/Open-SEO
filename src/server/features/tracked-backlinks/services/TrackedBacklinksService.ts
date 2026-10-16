import { waitUntil } from "cloudflare:workers";
import type { z } from "zod";
import { withPgClient } from "@/db";
import { getTrackedBacklinkChanges } from "./trackedBacklinkChanges";
import {
  TrackedBacklinksRepository as repo,
  type CheckRow,
  type LinkRow,
} from "../repositories/TrackedBacklinksRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { AppError } from "@/server/lib/errors";
import {
  getOptionalEnvValue,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";
import {
  assertBacklinkBillingReady,
  submitBacklinkCheck as submit,
  processPendingBacklinkChecks as processPending,
} from "./trackedBacklinkBilling";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { customerHasPaidPlan } from "@/server/billing/subscription";
import { applyBillingMarkupUsd, creditsForProviderUsd } from "@/shared/billing";
import { computeNextCheckAt } from "@/shared/rank-tracking";
import type {
  TrackedBacklinksOverview,
  TrackedBacklinkHistory,
} from "@/shared/tracked-backlinks";
import type {
  createTrackedBacklinkSchema,
  updateTrackedBacklinkSchema,
  updateTrackedBacklinkConfigSchema,
  checkTrackedBacklinksSchema,
} from "@/types/schemas/tracked-backlinks";

type ProjectInput = { projectId: string };
type IdInput = ProjectInput & { id: string };
async function authorize(projectId: string, customer: BillingCustomerContext) {
  if (
    !(await ProjectRepository.getProjectForOrganization(
      projectId,
      customer.organizationId,
    ))
  )
    throw new AppError("NOT_FOUND");
}
async function requireLink(input: IdInput) {
  const link = await repo.get(input.projectId, input.id);
  if (!link) throw new AppError("NOT_FOUND");
  return link;
}
async function estimate(signal?: AbortSignal) {
  const raw = await dataforseoPricing.onPage.backlinkVerificationTask({
    sourceUrl: "https://example.com",
    signal,
  });
  const hosted = await isHostedServerAuthMode();
  return {
    costUsdPerCheck: hosted ? applyBillingMarkupUsd(raw) : raw,
    costCreditsPerCheck: hosted ? creditsForProviderUsd(raw) : 0,
  };
}
async function list(
  input: ProjectInput,
  customer: BillingCustomerContext,
): Promise<TrackedBacklinksOverview> {
  await authorize(input.projectId, customer);
  // Collection can involve several provider reads. Keep page loads responsive
  // and give background work its own Postgres scope beyond this request.
  try {
    waitUntil(
      withPgClient(() => processPending(input.projectId)).catch((error) => {
        console.error(
          "[tracked-backlinks] background collection failed",
          error,
        );
      }),
    );
  } catch {
    // No execution context outside Workers; scheduled collection remains.
  }
  const [config, savedLinks, key, changes] = await Promise.all([
    repo.ensureConfig(input.projectId),
    repo.list(input.projectId),
    getOptionalEnvValue("DATAFORSEO_API_KEY"),
    getTrackedBacklinkChanges(input.projectId),
  ]);
  let costs: TrackedBacklinksOverview["estimate"] = null;
  let estimateUnavailableReason: string | null = null;
  try {
    if (key) {
      await assertBacklinkBillingReady(customer);
      costs = await estimate(AbortSignal.timeout(5000));
    }
  } catch (error) {
    estimateUnavailableReason =
      error instanceof AppError && error.code === "CONFLICT"
        ? error.message
        : "Provider pricing could not be verified. Checks are unavailable until pricing is available.";
  }
  const month = new Date().toISOString().slice(0, 7);
  return {
    links: savedLinks.map((link) => ({
      ...link,
      latestChange: changes.get(link.id) ?? null,
    })),
    config,
    usage: {
      month,
      checksUsed: config.usageMonth === month ? config.checksUsed : 0,
      monthlyCheckLimit: config.monthlyCheckLimit,
    },
    estimate: costs,
    estimateUnavailableReason,
    providerConfigured: !!key,
  };
}
async function pairs(input: ProjectInput, customer: BillingCustomerContext) {
  await authorize(input.projectId, customer);
  return (await repo.list(input.projectId)).map(
    ({ id, sourceUrl, targetUrl }) => ({ id, sourceUrl, targetUrl }),
  );
}
async function create(
  input: z.infer<typeof createTrackedBacklinkSchema>,
  customer: BillingCustomerContext,
) {
  await authorize(input.projectId, customer);
  await repo.ensureConfig(input.projectId);
  if ((await repo.list(input.projectId)).length >= 1000)
    throw new AppError(
      "VALIDATION_ERROR",
      "A project can track up to 1,000 backlinks.",
    );
  const link = await repo.create({
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  if (!link)
    throw new AppError(
      "CONFLICT",
      "This source and target pair is already tracked.",
    );
  return link;
}
async function update(
  input: z.infer<typeof updateTrackedBacklinkSchema>,
  customer: BillingCustomerContext,
) {
  await authorize(input.projectId, customer);
  const old = await requireLink(input);
  const urlsChanged =
    old.sourceUrl !== input.sourceUrl || old.targetUrl !== input.targetUrl;
  if (urlsChanged && (await repo.activeCheck(input.id)))
    throw new AppError(
      "CONFLICT",
      "Wait for the pending check before changing URLs.",
    );
  // A known duplicate is a user conflict. Any genuine database failure is
  // allowed to propagate rather than being disguised as a duplicate.
  const duplicate = (await repo.list(input.projectId)).some(
    (link) =>
      link.id !== input.id &&
      link.sourceUrl === input.sourceUrl &&
      link.targetUrl === input.targetUrl,
  );
  if (duplicate) throw new AppError("CONFLICT");
  const { projectId, id, ...values } = input;
  const updated = await repo.update(
    projectId,
    id,
    {
      ...values,
      ...(urlsChanged
        ? {
            status: "unchecked",
            anchor: null,
            rel: null,
            lastCheckedAt: null,
            error: null,
          }
        : {}),
    },
    urlsChanged,
  );
  if (!updated) throw new AppError("CONFLICT");
  return updated;
}
async function remove(input: IdInput, customer: BillingCustomerContext) {
  await authorize(input.projectId, customer);
  await requireLink(input);
  if (await repo.activeCheck(input.id))
    throw new AppError(
      "CONFLICT",
      "Wait for pending checks and billing to finish before deleting this link.",
    );
  if (!(await repo.remove(input.projectId, input.id)))
    throw new AppError("CONFLICT");
}
async function history(
  input: IdInput,
  customer: BillingCustomerContext,
): Promise<TrackedBacklinkHistory[]> {
  await authorize(input.projectId, customer);
  await requireLink(input);
  return repo.history(input.projectId, input.id);
}
async function updateConfig(
  input: z.infer<typeof updateTrackedBacklinkConfigSchema>,
  customer: BillingCustomerContext,
) {
  await authorize(input.projectId, customer);
  const old = await repo.ensureConfig(input.projectId);
  if (input.scheduleInterval !== "off") {
    if (!(await getOptionalEnvValue("DATAFORSEO_API_KEY")))
      throw new AppError(
        "VALIDATION_ERROR",
        "Configure the provider before enabling checks.",
      );
    if (
      (await isHostedServerAuthMode()) &&
      !(await customerHasPaidPlan(customer.organizationId))
    )
      throw new AppError("PAYMENT_REQUIRED");
    const current = await estimate();
    if (current.costUsdPerCheck > input.maxCostUsdPerCheck + 1e-12)
      throw new AppError(
        "VALIDATION_ERROR",
        "The verification estimate exceeds the approved per-check maximum.",
      );
  }
  await repo.updateConfig(input.projectId, {
    scheduleInterval: input.scheduleInterval,
    monthlyCheckLimit: input.monthlyCheckLimit,
    maxCostUsdPerCheck: input.maxCostUsdPerCheck,
    nextCheckAt:
      input.scheduleInterval === "off"
        ? null
        : old.scheduleInterval === input.scheduleInterval && old.nextCheckAt
          ? old.nextCheckAt
          : computeNextCheckAt(input.scheduleInterval),
    lastSkipReason: null,
  });
  return repo.ensureConfig(input.projectId);
}
async function queue(
  link: LinkRow,
  trigger: "manual" | "scheduled",
  customer: BillingCustomerContext,
  options: {
    approvedRawUsd?: number;
    signal?: AbortSignal;
    deferSubmission?: boolean;
  } = {},
) {
  const { approvedRawUsd, signal, deferSubmission = false } = options;
  if (await repo.activeCheck(link.id)) return "pending";
  await assertBacklinkBillingReady(customer);
  const raw =
    approvedRawUsd ??
    (await dataforseoPricing.onPage.backlinkVerificationTask({
      sourceUrl: link.sourceUrl,
      signal,
    }));
  if (trigger === "scheduled") {
    const config = await repo.ensureConfig(link.projectId);
    const displayed = (await isHostedServerAuthMode())
      ? applyBillingMarkupUsd(raw)
      : raw;
    if (displayed > config.maxCostUsdPerCheck + 1e-12)
      throw new AppError(
        "VALIDATION_ERROR",
        "The current verification price exceeds the approved per-check maximum.",
      );
  }
  const now = new Date().toISOString();
  const month = now.slice(0, 7);
  if (!(await repo.reserve(link.projectId, month))) return "budget";
  let check: CheckRow | null;
  try {
    check = await repo.createCheck({
      id: crypto.randomUUID(),
      linkId: link.id,
      projectId: link.projectId,
      sourceUrl: link.sourceUrl,
      targetUrl: link.targetUrl,
      trigger,
      billingEstimatedCostUsd: raw,
      createdAt: now,
      nextPollAt: now,
    });
  } catch (error) {
    await repo.release(link.projectId, month);
    throw error;
  }
  if (!check) {
    await repo.release(link.projectId, month);
    return "pending";
  }
  if (!deferSubmission) await submit(check, customer, signal);
  return "started";
}
async function checkSelected(
  input: z.infer<typeof checkTrackedBacklinksSchema>,
  customer: BillingCustomerContext,
) {
  await authorize(input.projectId, customer);
  if (!(await getOptionalEnvValue("DATAFORSEO_API_KEY")))
    throw new AppError(
      "VALIDATION_ERROR",
      "Configure DataForSEO before checking backlinks.",
    );
  await repo.ensureConfig(input.projectId);
  const selected = await Promise.all(
    input.ids.map((id) => requireLink({ projectId: input.projectId, id })),
  );
  const eligible = selected;
  const raw = await dataforseoPricing.onPage.backlinkVerificationTask({
    sourceUrl: "https://example.com",
  });
  const costs = {
    costUsdPerCheck: (await isHostedServerAuthMode())
      ? applyBillingMarkupUsd(raw)
      : raw,
  };
  if (
    Math.round(costs.costUsdPerCheck * eligible.length * 1e8) >
    Math.round(input.maxCostUsd * 1e8)
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "The estimate exceeds the approved maximum.",
    );
  let started = 0;
  let alreadyPending = 0;
  for (const link of eligible) {
    const result = await queue(link, "manual", customer, {
      approvedRawUsd: raw,
      deferSubmission: true,
    });
    if (result === "budget") {
      await repo.updateConfig(input.projectId, {
        lastSkipReason: "Monthly check limit reached.",
      });
      if (started === 0)
        throw new AppError("VALIDATION_ERROR", "Monthly check limit reached.");
      break;
    }
    if (result === "started") started++;
    else alreadyPending++;
  }
  // Accepted intents are durable; bounded background collection owns the
  // provider calls so a large selection never holds the request open.
  try {
    waitUntil(
      withPgClient(() => processPending(input.projectId)).catch((error) => {
        console.error("[tracked-backlinks] background dispatch failed", error);
      }),
    );
  } catch {
    // Cron resumes queued intents when no Worker execution context exists.
  }
  return { started, alreadyPending };
}
export const TrackedBacklinksService = {
  estimate,
  list,
  pairs,
  create,
  update,
  remove,
  history,
  updateConfig,
  check: checkSelected,
  processPending,
  queue,
};
