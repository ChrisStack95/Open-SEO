---
name: dead-page-checker
description: Use when identifying empty collections, thin content, or pages needing human review before deletion.
---

# Dead page checker

Call `check_dead_pages` with `projectId` and up to 50 `pages` with URLs and a `bucket` (`collection`, `page`, or `blog`). Set `fetchPages: true` to measure live pages, or supply `status`, `productCount`, `mainLength`, and `wordCount` from a previous crawl for offline analysis. The fetch mode reads at most 2 MB per response and may flag blocked pages as `fetch_issue`; do not infer their content is empty. Review all classifications and the `reviewReasons` field. Never delete a page solely because this tool labels it `empty_collection` or `thin`. The tool does not make changes to the site.
