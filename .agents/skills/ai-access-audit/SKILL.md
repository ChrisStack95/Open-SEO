---
name: ai-access-audit
description: Use when a user asks whether AI crawlers can access a website, why an AI bot cannot crawl it, or for an audit of robots.txt, llms.txt, JavaScript rendering, and structured data for AI access.
---

# AI Access Audit

Inspect what the site exposes to AI crawlers. This diagnoses access signals, not whether the brand is mentioned or cited in AI answers; use `ai-visibility-audit` for the latter.

1. Resolve the OpenSEO project with `list_projects` if needed. Use the current project when one is already selected. Confirm the public URL to check; do not substitute a competitor's site.
2. Call `run_ai_access_audit` with `projectId` and `url`. Save its `auditId`. Poll `get_ai_access_audit_status` with that ID until `completed` or `failed`. Do not launch another audit merely because the first is still running.
3. Call `get_ai_access_audit_results` with the same project and audit ID. If results are null, report the current status rather than inventing findings. If it failed, report the recorded error and distinguish incomplete checks from passes.
4. Report the overall and component scores with the specific observed signals: AI crawler robots permissions, blocked resources, llms.txt content, JavaScript rendering risks, schema markup, and page metadata where present. Prioritize actionable access restrictions over cosmetic signals. A robots allowance is not proof that a crawler actually fetched or indexed the page; a low score is not evidence that AI answer engines never mention the brand.
5. For access concerns, identify the affected bot and path and suggest a change to verify with a re-run. For mention or citation questions, use `ai-visibility-audit` separately and compare observed answers rather than extrapolating from access alone.

The audit is project-scoped. Never reuse an audit ID across projects. Read-only status and result calls default to the latest project audit when no ID is given, but keep the returned ID for a consistent report.
