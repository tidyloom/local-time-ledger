# Changelog

## 0.2.0 (2026-10-27)

First release with the optional Pro edition. Every free feature works as before, with no key.

- Pro: all time history in the Time Ledger panel and the report. The free edition keeps the last 30 days.
- Pro: `Export Timesheet (Pro)` writes a timesheet as CSV, Markdown or printable HTML, for a preset or custom date range and for all projects or one project.
- New commands `Enter Pro License Key`, `Re-check Pro License`, `Remove Pro License` and `About Pro`.
- Network: activating or re-checking a license sends the Pro product id and the license key to api.gumroad.com, only when you run one of those two commands and confirm. There are no other network calls. The README lists exactly what is sent.
- Faster per day totals for long histories.
- The report title is now `Show Report`. The report shows which edition is active.

## 0.1.0 (2026-10-26)

- Automatic time tracking per workspace from editor activity.
- Idle detection with a configurable limit (default 5 minutes). Time stops when the window loses focus.
- Status bar timer for today, with this project and this week in the tooltip.
- Time Ledger panel in the Explorer with today, this week and the last 30 days.
- Markdown report by project, language and day.
- Data stored locally as JSON Lines, one file per month, documented and safe to edit by hand.
- No network calls and no telemetry.
