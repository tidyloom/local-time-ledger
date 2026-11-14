# Changelog

## Unreleased

- Pro: manual session editor. `Edit Sessions (Pro)` lets you pick a day and a session, then correct its start or end, edit a note and a client label, split it in two, merge it with the previous or next session of the same project, or delete it. Times that end before they start, sessions under one minute, sessions in the future and overlaps with another session of the same project are refused with a message.
- Pro: `Undo Last Session Edit (Pro)` takes back the most recent edits, one at a time (the last 50 are kept in a local journal file next to your ledger).
- Edits rewrite only the month files they touch, through a temporary file and a rename, and keep lines the extension does not understand. Everything stays on your machine and there are no new network calls.
- Ledger lines can now carry an optional `note` and `client` text. Old lines and old versions of the format keep working. The client label is stored with the session.
- Pro: billable tags in the session editor. `Set billable or not billable` tags a session as billable, not billable or back to the default, and a split can tag each part on its own. Sessions merge only when both count the same way. Tag changes can be undone like any other edit.
- Pro: the timesheet export shows billable hours and billable amounts per client next to total time. CSV rows get a client column and billable hours and minutes at the end, and Markdown and HTML get a "Billable time per client" section. Only billable time is priced, a session's client label takes priority over the project's client, and currencies are never added together. The client label from the session editor is now used by the export.
- New setting `localTimeLedger.billableDefault` (`withClient`, `always` or `never`, default `withClient`) for sessions without a billable tag. With the default, time in projects that have an hourly rate stays billable, so existing exports keep the same amounts.
- Ledger lines can carry an optional `billable` value (true or false). Lines without it, including every line written by earlier versions, keep working.
- Free features are unchanged.

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
