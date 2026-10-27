# Local Time Ledger

Most coding time trackers need an account and send your activity to someone else's server. Local Time Ledger tracks your coding time per project automatically and keeps every record in a plain file on your own machine.

It works in VSCodium, Cursor, Windsurf (Devin Desktop) and VS Code. There is no account, no sign up and no cloud. Everything below under Features is free and stays free. An optional paid Pro edition adds all time history and timesheet export.

## Features

- **Automatic tracking per project.** Time is recorded for the open workspace while you edit, move the cursor, scroll, save, switch files, use the terminal or start a debug session. Nothing to start or stop.
- **Idle detection.** When there is no activity for 5 minutes (you can change this), the current stretch ends at your last activity. Idle time is never counted. Time also stops when the editor window loses focus.
- **Status bar timer.** Shows your total for today. Hover for this project today and this week. Click to open the report.
- **Today and this week view.** A "Time Ledger" panel in the Explorer shows today, this week (Monday to Sunday) and the last 30 days, with totals per project and per day.
- **30 days of history.** The report command opens a Markdown report with today, this week and the last 30 days, broken down by project, language and day.
- **Several windows at once.** Overlapping time from two windows is counted once.
- **Pause and resume.** Stop tracking for a while with one command.

## Commands

- `Local Time Ledger: Show Report`
- `Local Time Ledger: Open Data Folder`
- `Local Time Ledger: Pause Tracking` and `Local Time Ledger: Resume Tracking`
- `Local Time Ledger: Refresh`

Pro commands:

- `Local Time Ledger: Export Timesheet (Pro)`
- `Local Time Ledger: Enter Pro License Key`
- `Local Time Ledger: Re-check Pro License`
- `Local Time Ledger: Remove Pro License`
- `Local Time Ledger: About Pro` (opens the Pro page in your browser)

## Settings

- `localTimeLedger.idleMinutes` (default 5, from 1 to 60): minutes without activity before a stretch of work ends.
- `localTimeLedger.showStatusBar` (default true): show today's time in the status bar.
- `localTimeLedger.projectName` (default empty): the name recorded for this workspace. Empty means the workspace name.

## Your data

Records live in the editor's local storage for this extension, in a `ledger` folder. Run `Local Time Ledger: Open Data Folder` to see it. On Linux with VSCodium that is usually `~/.config/VSCodium/User/globalStorage/tidyloom.local-time-ledger/ledger/`.

There is one file per month, named `ledger-YYYY-MM.jsonl`. Each line is one stretch of work:

```json
{"v":1,"start":"2026-01-05T09:00:00.000Z","end":"2026-01-05T09:25:00.000Z","project":"demo","language":"typescript"}
```

- `start` and `end` are UTC timestamps.
- `project` is the workspace name (or your `projectName` setting).
- `language` is the editor language of the active file.

No file names, file contents, paths or keystrokes are recorded. You can open these files in any editor, fix a wrong entry, delete lines or whole months, and back them up or copy them wherever you like. Lines that cannot be read are skipped, so a hand edit never breaks the extension. The folder also contains a short `FORMAT.txt` that explains the format.

The free views show the last 30 days. Older files are never deleted, so if you add Pro later, all of your earlier history shows up.

## Free and Pro

The free edition is the full tracker described under Features, with the last 30 days in the views and the report. It needs no key, has no time limit and shows no reminders. Nothing in it will move behind the paywall.

### Pro adds

- **All time history.** The Time Ledger panel and the report show every day you have tracked, not only the last 30 days.
- **Timesheet export to CSV, Markdown and printable HTML.** Pick a range (this week, last week, this month, last month, last 30 days, all time or custom dates), all projects or one project, and a format. Each row is one day and one project, with decimal hours for invoices. The HTML page is self contained and has print styles, so you can print it or save it as PDF from your browser. CSV cells are protected against spreadsheet formula injection.

Pro is a one-time purchase of 19 USD on Gumroad: <https://tidyloomdev.gumroad.com/l/hsflch>. One purchase covers up to 3 machines. Gumroad sends a license key with the receipt. Refunds are available within 14 days.

### Activating Pro

1. Run `Local Time Ledger: Enter Pro License Key` and paste the key.
2. A dialog shows what will be sent. Choose `Check Key` to continue or close it to stop. Nothing is sent before you confirm.
3. If Gumroad confirms the key, Pro is active on this machine right away. No restart is needed.

The result of the check (product id, license key, Gumroad sale id, use count and the time of the check) is stored in the editor's local storage for this extension on this machine. It is not synced. No name or email is stored. `Local Time Ledger: Re-check Pro License` checks the stored key again, for example after a refund question. If Gumroad cannot be reached, Pro stays active. `Local Time Ledger: Remove Pro License` deletes the stored license and switches back to the free edition. Your time data is never touched by any of these commands.

## Privacy and network

Local Time Ledger makes no network calls on its own. It has no telemetry, no analytics, no crash reporting, no update checks and no background license checks. Your time data never leaves your machine unless you copy it yourself.

There is exactly one exception, and it only happens when you run it yourself:

> **Pro activation sends the Pro product id and the license key you entered to api.gumroad.com, only when you run `Local Time Ledger: Enter Pro License Key` or `Local Time Ledger: Re-check Pro License`.**

That is one HTTPS POST request to `https://api.gumroad.com/v2/licenses/verify` with three form fields: `product_id`, `license_key` and `increment_uses_count` (true when you activate, false when you re-check, so a re-check does not use up a machine). Gumroad's reply says whether the key is valid and whether the purchase was refunded, disputed or charged back. Nothing about your projects, files or tracked time is sent. If you never enter a key, the extension never makes a network call.

The shipped code is plain, readable JavaScript with no minification, so you can check this yourself. The network call lives in one small file, and the build fails its own tests if any other network API, or any other request, appears in the bundle.

## License

MIT. See [LICENSE](LICENSE).
