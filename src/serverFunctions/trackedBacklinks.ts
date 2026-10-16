import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "./middleware";
import { TrackedBacklinksService as service } from "@/server/features/tracked-backlinks/services/TrackedBacklinksService";
import {
  trackedBacklinkProjectSchema,
  trackedBacklinkIdSchema,
  createTrackedBacklinkSchema,
  updateTrackedBacklinkSchema,
  updateTrackedBacklinkConfigSchema,
  checkTrackedBacklinksSchema,
} from "@/types/schemas/tracked-backlinks";

export const getTrackedBacklinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(trackedBacklinkProjectSchema)
  .handler(({ context }) =>
    service.list({ projectId: context.projectId }, context),
  );
export const createTrackedBacklink = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createTrackedBacklinkSchema)
  .handler(({ data, context }) =>
    service.create({ ...data, projectId: context.projectId }, context),
  );
export const updateTrackedBacklink = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateTrackedBacklinkSchema)
  .handler(({ data, context }) =>
    service.update({ ...data, projectId: context.projectId }, context),
  );
export const deleteTrackedBacklink = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(trackedBacklinkIdSchema)
  .handler(({ data, context }) =>
    service.remove({ ...data, projectId: context.projectId }, context),
  );
export const getTrackedBacklinkHistory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(trackedBacklinkIdSchema)
  .handler(({ data, context }) =>
    service.history({ ...data, projectId: context.projectId }, context),
  );
export const updateTrackedBacklinkConfig = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateTrackedBacklinkConfigSchema)
  .handler(({ data, context }) =>
    service.updateConfig({ ...data, projectId: context.projectId }, context),
  );
export const checkTrackedBacklinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(checkTrackedBacklinksSchema)
  .handler(({ data, context }) =>
    service.check({ ...data, projectId: context.projectId }, context),
  );

export const getTrackedBacklinkPairs = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(trackedBacklinkProjectSchema)
  .handler(({ context }) =>
    service.pairs({ projectId: context.projectId }, context),
  );
