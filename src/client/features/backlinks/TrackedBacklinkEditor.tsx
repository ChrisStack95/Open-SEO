import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { QueryError } from "@/client/components/QueryState";
import {
  createTrackedBacklink,
  updateTrackedBacklink,
} from "@/serverFunctions/trackedBacklinks";
import type { TrackedBacklink } from "@/shared/tracked-backlinks";

export function TrackedBacklinkEditor({
  projectId,
  link,
  onClose,
  onSaved,
}: {
  projectId: string;
  link?: TrackedBacklink;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useMutation({
    mutationFn: (values: {
      sourceUrl: string;
      targetUrl: string;
      acquiredOn: string;
      notes: string;
    }) => {
      const data = {
        projectId,
        sourceUrl: values.sourceUrl.trim(),
        targetUrl: values.targetUrl.trim(),
        acquiredOn: values.acquiredOn || null,
        notes: values.notes.trim(),
      };
      return link
        ? updateTrackedBacklink({
            data: { ...data, id: link.id, paused: link.paused },
          })
        : createTrackedBacklink({ data });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const form = useForm({
    defaultValues: {
      sourceUrl: link?.sourceUrl ?? "",
      targetUrl: link?.targetUrl ?? "",
      acquiredOn: link?.acquiredOn ?? "",
      notes: link?.notes ?? "",
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
          <DialogTitle>{link ? "Edit backlink" : "Add a backlink"}</DialogTitle>
          <DialogDescription>
            Add the page containing your backlink and the page it should link
            to. Saving a link is free; checks are billed separately.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="sourceUrl">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="tracked-source-url">Source page URL</Label>
                <Input
                  id="tracked-source-url"
                  type="url"
                  required
                  maxLength={1000}
                  placeholder="https://example.com/article"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="targetUrl">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="tracked-target-url">Target page URL</Label>
                <Input
                  id="tracked-target-url"
                  type="url"
                  required
                  maxLength={1000}
                  placeholder="https://yoursite.com/page"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="acquiredOn">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="tracked-acquired">
                  Acquired date{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="tracked-acquired"
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="notes">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="tracked-notes">
                  Notes{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="tracked-notes"
                  rows={3}
                  maxLength={5000}
                  placeholder="Placement, contact, or campaign details"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </div>
            )}
          </form.Field>
          {save.error && (
            <QueryError
              error={save.error}
              fallback="Could not save this backlink."
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
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {link ? "Save backlink" : "Add backlink"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
