import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Link2, Plus, RefreshCw } from "lucide-react";
import { QueryError, QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import {
  getTrackedBacklinks,
  updateTrackedBacklink,
} from "@/serverFunctions/trackedBacklinks";
import type { TrackedBacklink } from "@/shared/tracked-backlinks";
import { TrackedBacklinkEditor } from "./TrackedBacklinkEditor";
import { TrackedBacklinkHistory } from "./TrackedBacklinkHistory";
import { TrackedBacklinksSchedule } from "./TrackedBacklinksSchedule";
import {
  TrackedBacklinkCheckDialog,
  TrackedBacklinkDeleteDialog,
} from "./TrackedBacklinkActions";
import { TrackedBacklinksTable } from "./TrackedBacklinksTable";

export function TrackedBacklinksPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<TrackedBacklink | "new" | null>(null);
  const [historyLink, setHistoryLink] = useState<TrackedBacklink | null>(null);
  const [deleting, setDeleting] = useState<TrackedBacklink | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);
  const queryKey = ["trackedBacklinks", projectId];
  const query = useQuery({
    queryKey,
    queryFn: () => getTrackedBacklinks({ data: { projectId } }),
    refetchInterval: (state) =>
      state.state.data?.links.some(
        (link) => link.checking || link.status === "pending",
      )
        ? 10000
        : false,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({
      queryKey: ["trackedBacklinkPairs", projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["trackedBacklinkHistory", projectId],
    });
  };
  const pause = useMutation({
    mutationFn: (link: TrackedBacklink) =>
      updateTrackedBacklink({
        data: {
          projectId,
          id: link.id,
          sourceUrl: link.sourceUrl,
          targetUrl: link.targetUrl,
          acquiredOn: link.acquiredOn,
          notes: link.notes,
          paused: !link.paused,
        },
      }),
    onSuccess: refresh,
  });

  return (
    <QueryState query={query} errorFallback="Could not load tracked backlinks.">
      {(data) => {
        const activeLinks = data.links.filter(
          (link) => !link.paused && !link.checking && link.status !== "pending",
        );
        const selected = selectedIds.filter((id) =>
          data.links.some(
            (link) =>
              link.id === id && !link.checking && link.status !== "pending",
          ),
        );
        const idsToCheck = selected.length
          ? selected
          : activeLinks.slice(0, 100).map((link) => link.id);
        const remaining = Math.max(
          0,
          data.usage.monthlyCheckLimit - data.usage.checksUsed,
        );
        const liveHistoryLink =
          data.links.find((link) => link.id === historyLink?.id) ?? historyLink;
        return (
          <div className="space-y-4">
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Automatic checks
                    </p>
                    <p className="mt-1 font-medium">
                      {data.config.scheduleInterval === "off"
                        ? "Off"
                        : data.config.scheduleInterval === "daily"
                          ? "Daily"
                          : "Weekly"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Checks this month · {data.usage.month}
                    </p>
                    <p className="mt-1 font-medium">
                      {data.usage.checksUsed.toLocaleString()}{" "}
                      <span className="font-normal text-muted-foreground">
                        / {data.usage.monthlyCheckLimit.toLocaleString()}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Tracked backlinks
                    </p>
                    <p className="mt-1 font-medium">
                      {data.links.length}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {data.links.filter((link) => link.paused).length}{" "}
                        paused
                      </span>
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => setScheduleOpen(true)}>
                  <CalendarClock />
                  Automatic checks
                </Button>
              </CardContent>
            </Card>
            {!data.providerConfigured && (
              <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                You can save backlinks now. An administrator needs to configure
                DataForSEO before verification checks can run.
              </p>
            )}
            {data.providerConfigured && !data.estimate && (
              <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                {data.estimateUnavailableReason ??
                  "Check pricing is unavailable. You can manage backlinks while verification is unavailable."}
              </p>
            )}
            {data.config.lastSkipReason && (
              <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                Last automatic check: {data.config.lastSkipReason}
              </p>
            )}
            {pause.error && (
              <QueryError
                error={pause.error}
                fallback="Could not update this backlink."
                variant="inline"
              />
            )}
            <Card className="gap-0 py-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">Tracked backlinks</h2>
                  <Badge variant="secondary">{data.links.length}</Badge>
                  {selected.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {selected.length} selected
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={
                      !data.providerConfigured ||
                      !data.estimate ||
                      !idsToCheck.length ||
                      remaining === 0
                    }
                    onClick={() => {
                      setReviewIds(idsToCheck);
                    }}
                  >
                    <RefreshCw />
                    {selected.length
                      ? "Check selected"
                      : activeLinks.length > 100
                        ? "Check first 100"
                        : "Check all"}
                  </Button>
                  <Button onClick={() => setEditor("new")}>
                    <Plus />
                    Add backlink
                  </Button>
                </div>
              </div>
              {data.links.length ? (
                <TrackedBacklinksTable
                  links={data.links}
                  selectedIds={selected}
                  nextCheckAt={data.config.nextCheckAt}
                  automaticEnabled={data.config.scheduleInterval !== "off"}
                  updating={pause.isPending}
                  onSelectionChange={setSelectedIds}
                  onEdit={setEditor}
                  onDelete={(link) => {
                    setDeleting(link);
                  }}
                  onPause={(link) => pause.mutate(link)}
                  onHistory={setHistoryLink}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                  <div className="rounded-full bg-muted p-3">
                    <Link2 className="size-6 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-medium">
                      Keep track of the backlinks you acquire
                    </h3>
                    <p className="max-w-md text-sm text-muted-foreground">
                      Save a source and target URL, then verify the link, anchor
                      text, and rel attributes over time.
                    </p>
                  </div>
                </div>
              )}
              <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <p>
                  Verification checks the source page’s HTML using DataForSEO
                  OnPage. Links added only by JavaScript are not checked.
                  Unverified means the page could not be checked; it does not
                  mean the link was removed.
                </p>
                <p>
                  Check all skips paused links. Select a paused link to check it
                  manually. You can check up to 100 backlinks at a time.{" "}
                  {remaining === 0
                    ? "Your monthly check limit has been reached."
                    : `${remaining.toLocaleString()} checks remaining this month.`}
                </p>
              </div>
            </Card>
            {editor !== null && (
              <TrackedBacklinkEditor
                projectId={projectId}
                link={editor === "new" ? undefined : editor}
                onClose={() => setEditor(null)}
                onSaved={refresh}
              />
            )}
            {scheduleOpen && (
              <TrackedBacklinksSchedule
                projectId={projectId}
                data={data}
                onClose={() => setScheduleOpen(false)}
                onSaved={refresh}
              />
            )}
            {liveHistoryLink && (
              <TrackedBacklinkHistory
                projectId={projectId}
                link={liveHistoryLink}
                onClose={() => setHistoryLink(null)}
              />
            )}
            {reviewIds && (
              <TrackedBacklinkCheckDialog
                projectId={projectId}
                ids={reviewIds}
                data={data}
                onClose={() => setReviewIds(null)}
                onStarted={() => setSelectedIds([])}
                onChanged={refresh}
              />
            )}
            {deleting && (
              <TrackedBacklinkDeleteDialog
                projectId={projectId}
                link={deleting}
                onClose={() => setDeleting(null)}
                onDeleted={refresh}
              />
            )}
          </div>
        );
      }}
    </QueryState>
  );
}
