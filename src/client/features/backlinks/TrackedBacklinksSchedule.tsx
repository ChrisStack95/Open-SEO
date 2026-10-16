import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { updateTrackedBacklinkConfig } from "@/serverFunctions/trackedBacklinks";
import type { getTrackedBacklinks } from "@/serverFunctions/trackedBacklinks";
import { isHostedClientAuthMode } from "@/lib/auth-mode";

type TrackingData = Awaited<ReturnType<typeof getTrackedBacklinks>>;
const SCHEDULE_ITEMS = [
  { value: "off", label: "Off — manual checks only" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

export function formatBacklinkCheckCost(
  estimate: NonNullable<TrackingData["estimate"]>,
  count = 1,
) {
  if (isHostedClientAuthMode())
    return `${(estimate.costCreditsPerCheck * count).toLocaleString()} credits`;
  const usd = estimate.costUsdPerCheck * count;
  return `$${usd.toFixed(usd < 0.01 ? 6 : 2)}`;
}

export function TrackedBacklinksSchedule({
  projectId,
  data,
  onClose,
  onSaved,
}: {
  projectId: string;
  data: TrackingData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useMutation({
    mutationFn: (values: {
      scheduleInterval: "off" | "daily" | "weekly";
      monthlyCheckLimit: number;
    }) =>
      updateTrackedBacklinkConfig({
        data: {
          projectId,
          ...values,
          maxCostUsdPerCheck:
            data.estimate?.costUsdPerCheck ?? data.config.maxCostUsdPerCheck,
        },
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const activeCount = data.links.filter((link) => !link.paused).length;
  const form = useForm({
    defaultValues: {
      scheduleInterval: data.config.scheduleInterval,
      monthlyCheckLimit: data.config.monthlyCheckLimit,
    },
    onSubmit: ({ value }) => {
      save.mutate(value);
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>Automatic backlink checks</DialogTitle>
          <DialogDescription>
            Check unpaused backlinks with DataForSEO OnPage. Automatic checks
            start disabled and use the same monthly allowance as manual checks.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="scheduleInterval">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="backlinks-cadence">Check frequency</Label>
                <Select
                  items={SCHEDULE_ITEMS}
                  value={field.state.value}
                  onValueChange={(value) => {
                    if (
                      value === "off" ||
                      value === "daily" ||
                      value === "weekly"
                    )
                      field.handleChange(value);
                  }}
                >
                  <SelectTrigger id="backlinks-cadence" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          <form.Field name="monthlyCheckLimit">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="backlinks-check-limit">
                  Monthly check limit
                </Label>
                <Input
                  id="backlinks-check-limit"
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  required
                  value={
                    Number.isFinite(field.state.value) ? field.state.value : ""
                  }
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.target.valueAsNumber)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Checks stop at this limit until the next calendar month (UTC).
                  Set 0 to prevent new checks.
                </p>
              </div>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values}>
            {(values) => {
              const monthlyChecks = Math.min(
                Number.isFinite(values.monthlyCheckLimit)
                  ? values.monthlyCheckLimit
                  : 0,
                activeCount *
                  (values.scheduleInterval === "daily"
                    ? 31
                    : values.scheduleInterval === "weekly"
                      ? 5
                      : 0),
              );
              return (
                <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4 text-sm">
                  <p>
                    {activeCount} {activeCount === 1 ? "backlink" : "backlinks"}{" "}
                    eligible for automatic checks.
                  </p>
                  {data.estimate ? (
                    <p>
                      Estimated cost per check:{" "}
                      <strong>{formatBacklinkCheckCost(data.estimate)}</strong>.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      {data.estimateUnavailableReason ??
                        "Check pricing is currently unavailable. Automatic checks cannot be enabled until pricing is available."}
                    </p>
                  )}
                  {values.scheduleInterval !== "off" && data.estimate && (
                    <>
                      <p>
                        At the current list size, approximately{" "}
                        <strong>{monthlyChecks.toLocaleString()} checks</strong>{" "}
                        per month, estimated at{" "}
                        <strong>
                          {formatBacklinkCheckCost(
                            data.estimate,
                            monthlyChecks,
                          )}
                        </strong>
                        .
                      </p>
                      <p className="text-muted-foreground">
                        Saving authorizes paid automatic checks at this
                        frequency and displayed price per check, within your
                        monthly check limit. Adding or resuming links can
                        increase usage up to that limit. The monthly amount is
                        an estimate; automatic checks pause if the price per
                        check increases.
                      </p>
                    </>
                  )}
                </div>
              );
            }}
          </form.Subscribe>
          {!data.providerConfigured && (
            <p className="text-sm text-muted-foreground">
              An administrator needs to configure DataForSEO before checks can
              run.
            </p>
          )}
          {save.error && (
            <QueryError
              error={save.error}
              fallback="Could not save automatic check settings."
              variant="inline"
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <form.Subscribe selector={(state) => state.values.scheduleInterval}>
              {(interval) => (
                <Button
                  type="submit"
                  disabled={
                    save.isPending || (interval !== "off" && !data.estimate)
                  }
                >
                  {save.isPending && <Loader2 className="animate-spin" />}
                  Save settings
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
