# AI Access Audit

## What it does

Audits how accessible a site is to AI systems — search crawlers, LLM crawlers,
and AI answer engines — and scores the result. For a given start URL it checks
four pillars: JavaScript rendering (frameworks that require JS, content
heuristics like titles/headings/nav/prices), llms.txt and friends (llms.txt,
llms-full.txt, llms-rank.txt, ai.txt), robots.txt (AI-bot rules,
sensitive-path protection, blocked resources, sitemaps), and structured data
(JSON-LD completeness and coverage). Each pillar produces a 0–100 score; the
overall score weights them (robots 30%, schema 30%, JS 25%, llms.txt 15%) and
benchmarks flag weak pillars. A crawl with the real user agents of 15 AI
crawlers reports which of them can actually reach the page.

Ported from the standalone AI Access Checker tool; the scoring ladders,
benchmarks, bot list, and weighting match it.

## How it works

An audit is started from a project (MCP tool, server function, or the project
page); the URL is validated through the same redirect-resolving policy the site
audit uses. A durable workflow then fetches the page once (SSRF-guarded,
bounded reads), derives the JS, structured-data, and page-meta pillar inputs
from that single fetch, fetches robots.txt, the llms.txt-family paths, and
.well-known files in parallel, crawls the page as each AI bot
(concurrency-capped, short timeouts), and scores everything in a pure finalize
step that persists scores, findings, and status. Progress is polled by audit
id; results include per-pillar scores, findings, benchmark comparisons, and
per-bot crawl outcomes.

## Alternatives considered

- Synchronous server function instead of a workflow: the combined fetches and
  15-bot crawl exceed subrequest and wall-time limits on Workers.
- Queues: workflows already give retries, steps, and event completion without
  adding a scheduler.
- Normalized per-finding tables: the findings document is read as a whole and
  the scores are the normalized part, so a JSON results column keeps the
  schema small; status and scores stay real columns for querying.
- protego for robots parsing: robots-parser is already a shipped dependency.
- Per-pillar homepage fetches (as the original tool does): one shared fetch
  keeps the audit cheaper and the pillars consistent.
