---
name: seo-log-auditor
description: "Analyze pasted nginx access logs for claimed Googlebot crawl frequency, HTTP status waste, and directory-level crawl distribution."
---

# SEO log auditor

Ask for raw nginx combined-format access-log lines and the relevant `projectId`. Do not fetch logs or assume that a Googlebot user agent proves the request came from Google. Avoid sharing personal IP addresses from the original logs in the response.

Call `audit_googlebot_logs` with `accessLogs` (up to 5 MB). Explain total Googlebot-family hits, non-200 ratio (non-200 hits divided by total hits), status classes, daily crawl frequency and directories with disproportionate failures. If the parser reports skipped lines, mention them and request a supported nginx combined export. This tool only analyzes supplied text; it does not verify bot IPs or compare against a sitemap.
