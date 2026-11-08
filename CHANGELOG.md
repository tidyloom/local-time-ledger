# Changelog

## 0.3.0 (2026-11-08)

- Pro: clients and hourly rates in the timesheet export. The `localTimeLedger.clients` setting maps a project to a client, hourly rate and currency. CSV, Markdown and HTML then include billing columns and an amount due section. Time is billed per minute, currencies are never added together, and projects without a rate stay listed as not priced.
- README screenshots of the status bar, the Time Ledger today view and a Pro timesheet export.
- The README now explains that the 3 machine limit is checked only when a key is first activated. Re-checks do not count as a new machine.

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
