import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BrandLookupPage } from "@/client/features/ai-search/BrandLookupPage";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
import { brandLookupSearchSchema } from "@/types/schemas/ai-search";

export const Route = createFileRoute("/_app/p/$projectId/brand-lookup")({
  validateSearch: brandLookupSearchSchema,
  // The project switcher keeps this page; filter drafts must not follow.
  remountDeps: ({ params }) => params.projectId,
  component: BrandLookupRoute,
});

function BrandLookupRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  // `c` is already an opaque competitor string array via the schema transform.
  const { q = "", c = [], scope, loc } = Route.useSearch();
  const projectMarket = useProjectMarket(projectId);
  // The URL override wins; otherwise the project's market. Undefined until the
  // projects query resolves, which gates the lookup so no paid call goes out
  // against a country the user never chose.
  const locationCode = loc ?? projectMarket?.locationCode;

  return (
    <BrandLookupPage
      projectId={projectId}
      initialQuery={q}
      initialCompetitors={c}
      initialScope={scope}
      locationCode={locationCode}
      onLocationChange={(nextLocationCode) => {
        void navigate({
          search: (prev) => ({
            ...prev,
            // Drop the param when it matches the project's own market, so the
            // common case keeps a clean URL.
            loc:
              nextLocationCode === projectMarket?.locationCode
                ? undefined
                : nextLocationCode,
          }),
          replace: true,
        });
      }}
      onSearchChange={(nextQuery, nextCompetitors, nextScope) => {
        void navigate({
          search: (prev) => ({
            ...prev,
            q: nextQuery.trim() || undefined,
            // One serialization site: comma-join the competitor list.
            c:
              nextCompetitors.length > 0
                ? nextCompetitors.join(",")
                : undefined,
            // The page passes a scope only when it differs from the default
            // derived from `q`.
            scope: nextScope,
          }),
          replace: true,
        });
      }}
    />
  );
}
