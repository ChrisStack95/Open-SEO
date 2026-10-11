import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getAiAccessAuditStatus,
  getAiAccessAuditResults,
  startAiAccessAudit,
} from "@/serverFunctions/aiAccessAudit";
import { aiAccessAuditResultsSchema } from "@/types/schemas/ai-access-audit";

export const Route = createFileRoute("/_app/p/$projectId/ai-access-audit")({
  validateSearch: z.object({ auditId: z.string().optional().catch(undefined) }),
  component: AiAccessAuditPage,
});

function AiAccessAuditPage() {
  const { projectId } = Route.useParams();
  const { auditId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [url, setUrl] = useState("");
  const status = useQuery({
    queryKey: ["ai-access-status", projectId, auditId],
    queryFn: () => getAiAccessAuditStatus({ data: { projectId, auditId } }),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 3000 : false,
  });
  const results = useQuery({
    queryKey: ["ai-access-results", projectId, status.data?.id],
    queryFn: () =>
      getAiAccessAuditResults({
        data: { projectId, auditId: status.data!.id },
      }),
    enabled: status.data?.status === "completed",
  });
  const start = useMutation({
    mutationFn: (siteUrl: string) =>
      startAiAccessAudit({ data: { projectId, url: siteUrl } }),
    onSuccess: (started) => {
      void navigate({ search: { auditId: started.auditId } });
    },
  });
  const audit = status.data;
  const findings = results.data?.results
    ? aiAccessAuditResultsSchema.safeParse(JSON.parse(results.data.results))
    : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start.mutate(url.trim());
  }

  return (
    <div className="overflow-auto px-4 py-6 pb-24 md:px-6 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="AI Access Audit"
          description="Check crawler access and the signals a page exposes. This does not measure mentions in AI answers."
        />
        <Card>
          <CardHeader>
            <CardTitle>Check a site</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={submit}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
                Website URL
                <Input
                  type="url"
                  required
                  placeholder="https://example.com"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={start.isPending}>
                {start.isPending ? "Starting…" : "Run audit"}
              </Button>
            </form>
            {start.error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {getStandardErrorMessage(start.error)}
              </p>
            )}
          </CardContent>
        </Card>
        {status.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading latest audit…
          </p>
        )}
        {status.error && (
          <p role="alert" className="text-sm text-destructive">
            {getStandardErrorMessage(status.error)}
          </p>
        )}
        {!status.isPending && !status.error && !audit && (
          <p className="text-sm text-muted-foreground">
            No AI access audit yet. Enter a public URL to begin.
          </p>
        )}
        {audit && (
          <Card>
            <CardHeader>
              <CardTitle className="break-all">{audit.startUrl}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p role="status" className="text-sm">
                Status: {audit.status}
                {audit.status === "running"
                  ? " — checking crawler access…"
                  : ""}
              </p>
              {audit.status === "failed" && (
                <p role="alert" className="text-sm text-destructive">
                  Audit failed:{" "}
                  {audit.errorDetail ?? audit.errorCode ?? "Unknown error"}
                </p>
              )}
              {results.isPending && audit.status === "completed" && (
                <p className="text-sm text-muted-foreground">
                  Loading findings…
                </p>
              )}
              {results.error && (
                <p role="alert" className="text-sm text-destructive">
                  {getStandardErrorMessage(results.error)}
                </p>
              )}
              {findings && !findings.success && (
                <p role="alert" className="text-sm text-destructive">
                  The saved audit results could not be read.
                </p>
              )}
              {findings?.success && <AuditFindings data={findings.data} />}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function AuditFindings({
  data,
}: {
  data: z.infer<typeof aiAccessAuditResultsSchema>;
}) {
  const scores = [
    ["JavaScript rendering", data.js.score],
    ["llms.txt", data.llmTxt.score],
    ["Robots", data.robots.score],
    ["Structured data", data.schema.score],
  ] as const;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Overall score</p>
        <p className="text-3xl font-semibold tabular-nums">
          {data.overallScore}/100
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scores.map(([label, score]) => (
          <div key={label} className="rounded-lg border p-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{score}/100</dd>
          </div>
        ))}
      </dl>
      {data.js.riskFactors.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Rendering risks</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {data.js.riskFactors.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="font-semibold">Crawler access</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">Bot</th>
                <th className="p-2">Robots</th>
                <th className="p-2">HTTP</th>
                <th className="p-2">Page signal</th>
              </tr>
            </thead>
            <tbody>
              {data.botCrawl.map((bot) => (
                <tr key={bot.name} className="border-b">
                  <th scope="row" className="p-2 font-medium">
                    {bot.name}
                  </th>
                  <td className="p-2">
                    {bot.robotsAllowed == null
                      ? "Unknown"
                      : bot.robotsAllowed
                        ? "Allowed"
                        : "Blocked"}
                  </td>
                  <td className="p-2">{bot.status ?? "—"}</td>
                  <td className="p-2">
                    {bot.error ??
                      (bot.noindex ? "Noindex" : bot.title || "No title")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Other signals</h2>
        <ul className="space-y-1 text-sm">
          <li>robots.txt: {data.robots.found ? "Found" : "Not found"}</li>
          <li>Structured data: {data.schema.schemas.length} item(s)</li>
          <li>
            Page text: {data.pageMeta.textLength.toLocaleString()} characters
          </li>
          {Object.entries(data.llmTxt.files).map(([name, file]) => (
            <li key={name}>
              {name}:{" "}
              {file.found
                ? `Found (${file.quality?.charCount ?? 0} characters)`
                : "Not found"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
