import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  checkTrackedBacklinks,
  deleteTrackedBacklink,
} from "@/serverFunctions/trackedBacklinks";
import type {
  TrackedBacklink,
  TrackedBacklinksOverview,
} from "@/shared/tracked-backlinks";
import { formatBacklinkCheckCost } from "./TrackedBacklinksSchedule";

export function TrackedBacklinkCheckDialog({
  projectId,
  ids,
  data,
  onClose,
  onStarted,
  onChanged,
}: {
  projectId: string;
  ids: string[];
  data: TrackedBacklinksOverview;
  onClose: () => void;
  onStarted: () => void;
  onChanged: () => void;
}) {
  const check = useMutation({
    mutationFn: () =>
      checkTrackedBacklinks({
        data: {
          projectId,
          ids,
          maxCostUsd: Number(
            (ids.length * (data.estimate?.costUsdPerCheck ?? 0)).toFixed(8),
          ),
        },
      }),
    onSuccess: (result) => {
      onStarted();
      onClose();
      toast.success(
        `${result.started} backlink ${result.started === 1 ? "check" : "checks"} started`,
      );
    },
    onSettled: onChanged,
  });
  const remaining = Math.max(
    0,
    data.usage.monthlyCheckLimit - data.usage.checksUsed,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !check.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!check.isPending}>
        <DialogHeader>
          <DialogTitle>Review backlink checks</DialogTitle>
          <DialogDescription>
            Start paid verification for {ids.length}{" "}
            {ids.length === 1 ? "backlink" : "backlinks"}. Results can take a
            few minutes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
          <p>
            Estimated cost:{" "}
            <strong>
              {data.estimate
                ? formatBacklinkCheckCost(data.estimate, ids.length)
                : "Unavailable"}
            </strong>
            .
          </p>
          <p className="text-muted-foreground">
            Submitting authorizes this paid check. Each submitted source page
            uses one check from your monthly allowance.
          </p>
        </div>
        {ids.length > remaining && (
          <p className="text-sm text-destructive">
            Only {remaining.toLocaleString()} checks remain this month. Select
            fewer backlinks or increase your monthly check limit.
          </p>
        )}
        {check.error && (
          <QueryError
            error={check.error}
            fallback="Could not start backlink checks."
            variant="inline"
          />
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={check.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            disabled={
              check.isPending ||
              !ids.length ||
              ids.length > remaining ||
              !data.providerConfigured ||
              !data.estimate
            }
            onClick={() => check.mutate()}
          >
            {check.isPending && <Loader2 className="animate-spin" />}Start paid
            checks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TrackedBacklinkDeleteDialog({
  projectId,
  link,
  onClose,
  onDeleted,
}: {
  projectId: string;
  link: TrackedBacklink;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: () =>
      deleteTrackedBacklink({ data: { projectId, id: link.id } }),
    onSuccess: () => {
      onDeleted();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!remove.isPending}>
        <DialogHeader>
          <DialogTitle>Delete backlink?</DialogTitle>
          <DialogDescription>
            This removes the tracked backlink and its verification history.
          </DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm text-muted-foreground">
          {link.sourceUrl}
        </p>
        {remove.error && (
          <QueryError
            error={remove.error}
            fallback="Could not delete this backlink."
            variant="inline"
          />
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={remove.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending && <Loader2 className="animate-spin" />}Delete
            backlink
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
