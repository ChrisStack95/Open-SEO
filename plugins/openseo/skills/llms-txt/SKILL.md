---
name: llms-txt
description: Use when creating an llms.txt index and companion full-text document from provided website page metadata.
---

# llms.txt generation

Call `generate_llms_txt` with `projectId`, `siteName`, and a `pages` array containing each page's URL, title, description, and optional full content. Supply an accurate site summary when available. The tool filters non-indexable pages, groups pages into sections, and returns both `llmsTxt` and `llmsFullTxt` as text. The full-text output contains only supplied content and may be empty; do not publish an empty companion file or invent summaries. Review the text and page selection before publishing either file at the site root. No live crawl or AI summarization occurs.
