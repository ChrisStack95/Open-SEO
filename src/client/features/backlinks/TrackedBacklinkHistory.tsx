import { useQuery } from "@tanstack/react-query";
import { sort } from "remeda";
import { QueryState } from "@/client/components/QueryState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Badge } from "@/client/components/ui/badge";
import { getTrackedBacklinkHistory } from "@/serverFunctions/trackedBacklinks";
import type { TrackedBacklink } from "@/shared/tracked-backlinks";
import { BacklinkStatus, backlinkCheckTime } from "./TrackedBacklinksTable";

export function TrackedBacklinkHistory({
  projectId,
  link,
  onClose,
}: {
  projectId: string;
  link: TrackedBacklink;
  onClose: () => void;
}) {
  const history = useQuery({
    queryKey: ["trackedBacklinkHistory", projectId, link.id],
    queryFn: () =>
      getTrackedBacklinkHistory({ data: { projectId, id: link.id } }),
    refetchInterval: link.checking || link.status === "pending" ? 10000 : false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Backlink history</DialogTitle>
          <DialogDescription className="break-all">
            {link.sourceUrl}
          </DialogDescription>
        </DialogHeader>
        <QueryState
          query={history}
          errorFallback="Could not load backlink history."
        >
          {(checks) => {
            const ordered = sort(checks, (a, b) =>
              b.createdAt.localeCompare(a.createdAt),
            );
            return ordered.length ? (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                {ordered.map((check, index) => {
                  const previous = ordered
                    .slice(index + 1)
                    .find(
                      (item) =>
                        item.completedAt &&
                        (item.status === "found" ||
                          item.status === "not_found") &&
                        item.sourceUrl === check.sourceUrl &&
                        item.targetUrl === check.targetUrl,
                    );
                  const changed =
                    previous &&
                    check.completedAt &&
                    (check.status === "found" || check.status === "not_found");
                  return (
                    <div
                      key={check.id}
                      className="space-y-2 rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {changed && previous.status !== check.status && (
                            <>
                              <BacklinkStatus status={previous.status} />
                              <span className="text-muted-foreground">→</span>
                            </>
                          )}
                          <BacklinkStatus status={check.status} />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {backlinkCheckTime(
                            check.completedAt ?? check.createdAt,
                          )}
                        </span>
                      </div>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        {(check.sourceUrl !== link.sourceUrl ||
                          check.targetUrl !== link.targetUrl) && (
                          <>
                            <dt className="text-muted-foreground">Source</dt>
                            <dd className="break-all">{check.sourceUrl}</dd>
                            <dt className="text-muted-foreground">Target</dt>
                            <dd className="break-all">{check.targetUrl}</dd>
                          </>
                        )}
                        <dt className="text-muted-foreground">Anchor</dt>
                        <dd className="break-words">{check.anchor ?? "—"}</dd>
                        <dt className="text-muted-foreground">Rel</dt>
                        <dd className="break-words">{check.rel ?? "—"}</dd>
                      </dl>
                      {changed &&
                        check.status === "found" &&
                        previous.status === "found" &&
                        (previous.anchor !== check.anchor ||
                          previous.rel !== check.rel) && (
                          <Badge variant="outline">Anchor or rel changed</Badge>
                        )}
                      {check.error && (
                        <p className="text-xs text-muted-foreground">
                          {check.error}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No checks yet. Run a check to start this backlink’s history.
              </p>
            );
          }}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}
