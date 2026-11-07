/**
 * Builds README screenshots for 0.3.0 without a live editor GUI.
 * Timesheet: real renderTimesheetHtml output from compiled unit code.
 * Status bar and Today view: HTML mocks matching VS Code Dark+ chrome and the
 * real formatDuration / tree labels from src/view.ts and src/extension.ts.
 * Captures with Chrome headless under the caller's DISPLAY (use xvfb-run).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const media = join(root, 'media');
const tmp = join(root, '.screenshot-tmp');
mkdirSync(media, { recursive: true });
mkdirSync(tmp, { recursive: true });

const require = createRequire(import.meta.url);
const exportPath = join(root, 'out/core/export.js');
const timePath = join(root, 'out/core/time.js');
const billingPath = join(root, 'out/core/billing.js');
if (!existsSync(exportPath)) {
  console.error('Missing compiled out/core/export.js. Run: npm run compile-tests');
  process.exit(1);
}
const { buildTimesheet, customRange, renderTimesheet } = require(exportPath);
const { HOUR, MINUTE, formatDuration } = require(timePath);
const { parseRates } = require(billingPath);

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

const chrome =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) {
  console.error('Chrome/Chromium not found');
  process.exit(1);
}

function shot(htmlPath, pngPath, width, height) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--window-size=${width},${height}`,
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ];
  const r = spawnSync(chrome, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || 'chrome failed');
    process.exit(r.status || 1);
  }
  console.log('wrote', pngPath);
}

// Demo numbers used in the status bar and tree (same formatDuration as the extension).
const todayMs = 2 * HOUR + 35 * MINUTE;
const weekMs = 11 * HOUR + 20 * MINUTE;
const demoToday = formatDuration(todayMs);
const demoWeek = formatDuration(weekMs);
const demoProject = formatDuration(1 * HOUR + 50 * MINUTE);
const histMs = 18 * HOUR + 5 * MINUTE;
const histLabel = formatDuration(histMs);

const statusHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#1e1e1e;font:12px/22px -apple-system,"Segoe UI",system-ui,sans-serif;color:#cccccc}
.bar{display:flex;align-items:center;justify-content:flex-end;gap:14px;height:22px;padding:0 10px;background:#007acc;color:#fff}
.item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.clock{width:12px;height:12px;border:1.5px solid #fff;border-radius:50%;position:relative;flex:0 0 auto}
.clock:after{content:"";position:absolute;left:5px;top:2px;width:1.5px;height:4px;background:#fff}
.clock:before{content:"";position:absolute;left:5px;top:5px;width:3px;height:1.5px;background:#fff}
.label{opacity:.9;font-size:11px}
</style></head><body>
<div class="bar">
  <span class="item"><span class="label">Ln 42, Col 8</span></span>
  <span class="item"><span class="label">UTF-8</span></span>
  <span class="item"><span class="clock"></span><span> ${demoToday}</span></span>
  <span class="item"><span class="label">TypeScript</span></span>
</div>
</body></html>`;

const treeHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#252526;font:13px/1.4 -apple-system,"Segoe UI",system-ui,sans-serif;color:#cccccc}
.panel{width:280px;min-height:320px;border-right:1px solid #1e1e1e;padding:8px 0 12px}
.title{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#bbbbbb;padding:4px 16px 8px;display:flex;justify-content:space-between}
.row{display:flex;align-items:center;gap:6px;padding:3px 12px 3px 8px}
.row:hover{background:#2a2d2e}
.indent{padding-left:28px}
.chev{width:16px;text-align:center;color:#c5c5c5;font-size:10px}
.icon{width:14px;height:14px;border:1.5px solid #75beff;border-radius:50%;position:relative;flex:0 0 auto}
.icon:after{content:"";position:absolute;left:5.5px;top:2px;width:1.5px;height:5px;background:#75beff}
.icon:before{content:"";position:absolute;left:5.5px;top:6px;width:3.5px;height:1.5px;background:#75beff}
.name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.desc{color:#bbbbbb;font-variant-numeric:tabular-nums;margin-left:8px}
.leaf .name{color:#cccccc}
</style></head><body>
<div class="panel">
  <div class="title"><span>Time Ledger</span><span>↻</span></div>
  <div class="row"><span class="chev">▾</span><span class="icon"></span><span class="name">Today</span><span class="desc">${demoToday}</span></div>
  <div class="row indent leaf"><span class="name">demo-project</span><span class="desc">${demoProject}</span></div>
  <div class="row indent leaf"><span class="name">sample-app</span><span class="desc">${formatDuration(45 * MINUTE)}</span></div>
  <div class="row"><span class="chev">▸</span><span class="icon"></span><span class="name">This week</span><span class="desc">${demoWeek}</span></div>
  <div class="row"><span class="chev">▸</span><span class="icon"></span><span class="name">Last 30 days</span><span class="desc">${histLabel}</span></div>
</div>
</body></html>`;

// Real timesheet HTML with clients and rates (0.3.0 Pro feature).
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime(); // November 2026 local
const seg = (start, end, project) => ({ start, end, project, language: 'typescript' });
const segments = [
  seg(at(3, 9), at(3, 11, 30), 'demo-project'),
  seg(at(3, 13), at(3, 14, 15), 'sample-app'),
  seg(at(4, 9), at(4, 12), 'demo-project'),
  seg(at(5, 10), at(5, 11, 40), 'sample-app'),
  seg(at(5, 14), at(5, 15), 'side-thing'),
  seg(at(6, 9), at(6, 10, 20), 'demo-project'),
];
const range = customRange('2026-11-03', '2026-11-06');
const sheet = buildTimesheet(segments, range);
const { rates } = parseRates({
  'demo-project': { client: 'Example Client', hourlyRate: 60, currency: 'EUR' },
  'sample-app': { client: 'Example Client', hourlyRate: 50, currency: 'EUR' },
});
const timesheetHtml = renderTimesheet(sheet, 'html', at(7, 18, 57), rates);

const statusPath = join(tmp, 'status.html');
const treePath = join(tmp, 'tree.html');
const timesheetPath = join(tmp, 'timesheet.html');
writeFileSync(statusPath, statusHtml);
writeFileSync(treePath, treeHtml);
writeFileSync(timesheetPath, timesheetHtml);

const outStatus = join(media, 'screenshot-status-bar.png');
const outTree = join(media, 'screenshot-today-view.png');
const outSheet = join(media, 'screenshot-timesheet-export.png');

shot(statusPath, outStatus, 720, 40);
shot(treePath, outTree, 320, 360);
shot(timesheetPath, outSheet, 900, 1100);

// Tight crop on status bar strip (remove unused canvas).
spawnSync('convert', [outStatus, '-trim', '+repage', '-bordercolor', '#007acc', '-border', '8x4', outStatus], {
  encoding: 'utf8',
});
spawnSync('convert', [outTree, '-trim', '+repage', '-bordercolor', '#252526', '-border', '8', outTree], {
  encoding: 'utf8',
});
spawnSync('convert', [outSheet, '-trim', '+repage', '-bordercolor', 'white', '-border', '16', outSheet], {
  encoding: 'utf8',
});

console.log('demo durations:', { demoToday, demoWeek, demoProject });
console.log('done');
