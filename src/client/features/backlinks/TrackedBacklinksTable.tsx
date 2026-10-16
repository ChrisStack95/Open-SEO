import { History, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { TrackedBacklink } from "@/shared/tracked-backlinks";

export function BacklinkStatus({
  status,
}: {
  status: TrackedBacklink["status"];
}) {
  const labels = {
    unchecked: "Unchecked",
    pending: "Pending",
    found: "Found",
    not_found: "Not found in HTML",
    unverified: "Unverified",
  };
  const variants = {
    unchecked: "secondary",
    pending: "info",
    found: "success",
    not_found: "destructive",
    unverified: "warning",
  } as const;
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

export function backlinkCheckTime(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function TrackedBacklinksTable({
  links,
  selectedIds,
  nextCheckAt,
  automaticEnabled,
  updating,
  onSelectionChange,
  onEdit,
  onDelete,
  onPause,
  onHistory,
}: {
  links: TrackedBacklink[];
  selectedIds: string[];
  nextCheckAt: string | null;
  automaticEnabled: boolean;
  updating: boolean;
  onSelectionChange: (ids: string[]) => void;
  onEdit: (link: TrackedBacklink) => void;
  onDelete: (link: TrackedBacklink) => void;
  onPause: (link: TrackedBacklink) => void;
  onHistory: (link: TrackedBacklink) => void;
}) {
  const selectable = links.filter(
    (link) => !link.checking && link.status !== "pending",
  );
  const selectionBatch = selectable.slice(0, 100);
  const allSelected =
    selectionBatch.length > 0 &&
    selectionBatch.every((link) => selectedIds.includes(link.id));
  const someSelected = selectable.some((link) => selectedIds.includes(link.id));
  return (
    <Table className="min-w-[1040px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 pl-4">
            <Checkbox
              aria-label={
                selectable.length > 100
                  ? "Select first 100 backlinks"
                  : "Select all backlinks"
              }
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              disabled={!selectable.length}
              onCheckedChange={(checked) =>
                onSelectionChange(
                  checked ? selectionBatch.map((link) => link.id) : [],
                )
              }
            />
          </TableHead>
          <TableHead className="w-[34%]">Backlink</TableHead>
          <TableHead>Verification</TableHead>
          <TableHead>Anchor / rel</TableHead>
          <TableHead>Last / next check</TableHead>
          <TableHead className="text-right pr-4">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((link) => (
          <TableRow key={link.id}>
            <TableCell className="pl-4 align-top pt-4">
              <Checkbox
                aria-label={`Select backlink from ${link.sourceUrl}`}
                checked={selectedIds.includes(link.id)}
                disabled={
                  link.checking ||
                  link.status === "pending" ||
                  (selectedIds.length >= 100 && !selectedIds.includes(link.id))
                }
                onCheckedChange={(checked) =>
                  onSelectionChange(
                    checked
                      ? [...selectedIds, link.id]
                      : selectedIds.filter((id) => id !== link.id),
                  )
                }
              />
            </TableCell>
            <TableCell className="space-y-2 py-4 align-top">
              <div className="space-y-1">
                <SafeExternalLink
                  url={link.sourceUrl}
                  label={link.sourceUrl}
                  className="flex items-start gap-1.5 break-all font-medium hover:underline"
                />
                <div className="flex items-start gap-1 text-xs text-muted-foreground">
                  <span className="shrink-0">To</span>
                  <SafeExternalLink
                    url={link.targetUrl}
                    label={link.targetUrl}
                    className="flex items-start gap-1 break-all hover:underline"
                  />
                </div>
              </div>
              {link.acquiredOn && (
                <p className="text-xs text-muted-foreground">
                  Acquired {link.acquiredOn}
                </p>
              )}
              {link.notes && (
                <p className="max-w-md whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {link.notes}
                </p>
              )}
            </TableCell>
            <TableCell className="align-top py-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <BacklinkStatus status={link.status} />
                {link.checking && link.status !== "pending" && (
                  <Badge variant="info">Finishing check</Badge>
                )}
                {link.paused && <Badge variant="outline">Paused</Badge>}
              </div>
              {link.error && (
                <p className="mt-2 max-w-48 text-xs text-muted-foreground">
                  {link.error}
                </p>
              )}
              {link.latestChange && (
                <div className="mt-2">
                  <Badge
                    variant={
                      link.latestChange.kind === "not_observed"
                        ? "warning"
                        : "info"
                    }
                    title={`Changed ${backlinkCheckTime(link.latestChange.at)} — view history for details`}
                  >
                    {link.latestChange.kind === "not_observed"
                      ? "No longer observed"
                      : link.latestChange.kind === "recovered"
                        ? "Link observed again"
                        : "Anchor or rel changed"}
                  </Badge>
                </div>
              )}
            </TableCell>
            <TableCell className="align-top py-4">
              <p className="max-w-48 break-words">{link.anchor ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {link.rel ?? "—"}
              </p>
            </TableCell>
            <TableCell className="align-top py-4 text-xs">
              <p>{backlinkCheckTime(link.lastCheckedAt)}</p>
              <p className="mt-1 text-muted-foreground">
                {link.paused
                  ? "Automatic checks paused"
                  : automaticEnabled && nextCheckAt
                    ? `Next: ${backlinkCheckTime(nextCheckAt)}`
                    : "Manual checks only"}
              </p>
            </TableCell>
            <TableCell className="pr-4 align-top py-3">
              <div className="flex justify-end gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit backlink"
                  title="Edit backlink"
                  disabled={updating || link.checking}
                  onClick={() => onEdit(link)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    link.paused
                      ? "Resume automatic checks"
                      : "Pause automatic checks"
                  }
                  title={
                    link.paused
                      ? "Resume automatic checks"
                      : "Pause automatic checks"
                  }
                  disabled={updating}
                  onClick={() => onPause(link)}
                >
                  {link.paused ? <Play /> : <Pause />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="View history"
                  title="View history"
                  onClick={() => onHistory(link)}
                >
                  <History />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete backlink"
                  title="Delete backlink"
                  disabled={
                    updating || link.checking || link.status === "pending"
                  }
                  onClick={() => onDelete(link)}
                >
                  <Trash2 />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
