---
name: striking-distance-audit
description: "Prioritize Semrush keywords ranking in positions 4–20 using pasted CSV/TSV and optional Screaming Frog crawl data."
---

# Striking-distance audit

Ask for a Semrush rankings CSV/TSV with `Keyword`, `Position`, `Search Volume`, and `URL`, plus `projectId`. Optionally request a Screaming Frog Internal_All CSV/TSV with `Address`, `Status Code`, `Indexability`, `Title 1`, `Meta Description 1`, and `H1-1`. Each pasted file is limited to 2 MB. Excel and Google Sheets links must be exported to CSV/TSV first; this tool never fetches URLs.

Call `analyze_striking_distance` with the supplied data and explicit brand rules if known: brand name, title suffix, forbidden terms, preferred vocabulary and meta length cap. The default threshold is 50 search-volume searches and positions 4–20 inclusive. Top-three keywords are protected from primary selection; review protected counts before changing a page. The title and description are short deterministic drafts, not original-source AI recommendations: verify accuracy, tone, context and length before publishing. Where crawl data is absent, explain that current page metadata could not be checked.
