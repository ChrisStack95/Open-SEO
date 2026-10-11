---
name: redirect-mapping
description: Use when mapping old site URLs to new destinations during a migration or mapping retired products to collection pages.
---

# Redirect mapping

Call `map_redirects` with `projectId`, `mode`, `oldPages`, and `newPages`. Each page input accepts a Screaming Frog CSV with `Address`, `Title 1`, `H1-1`, and `H2-1` headers or one URL per line. Retirement targets need a `Collection` column marked `true` or `/collections/` in their path.

Review `tier` and `score` for every result. Only `high` identifies a confident suggestion; `review` and `no_match` require human judgment. Confirm destination pages exist before publishing any redirect. The tool does not create redirects or fetch URLs. It makes deterministic suggestions without an AI tie-breaker.
