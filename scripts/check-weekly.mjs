// Weekly-count checks, run across several timezones.
//
// The bug this guards against: a stored 'YYYY-MM-DD' parsed with `new Date()`
// is UTC midnight, while the week boundary is local midnight. West of UTC that
// pushes a Monday session into the previous Sunday and drops it from the tally.
// It is invisible in UTC, which is exactly why it needs an explicit test.
//
// Run with `npm run check:weekly`. The script re-executes itself once per
// timezone via TZ, because TZ is read when the process starts.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles', // UTC-7/8, where the bug bites hardest
  'America/New_York', // UTC-4/5
  'Europe/London', // UTC+0/1
  'Asia/Tokyo', // UTC+9
  'Pacific/Kiritimati', // UTC+14, the far edge
  'Pacific/Midway', // UTC-11, the other far edge
];

const self = fileURLToPath(import.meta.url);

// Parent process: fan out over timezones and report.
if (!process.env.__WEEKLY_TZ_CHILD) {
  let failed = 0;
  for (const tz of TIMEZONES) {
    try {
      const out = execFileSync(process.execPath, [self], {
        env: { ...process.env, TZ: tz, __WEEKLY_TZ_CHILD: '1' },
        encoding: 'utf8',
      });
      process.stdout.write(out);
    } catch (err) {
      process.stdout.write(err.stdout ?? '');
      process.stderr.write(err.stderr ?? '');
      failed++;
    }
  }
  console.log(`\n${failed === 0 ? 'All checks passed.' : `${failed} TIMEZONE(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

// Child process: run the assertions in whatever TZ was handed to us.
const { weeklyCounts, startOfWeek, endOfWeek, parseLocalDate, todayISO } = await import(
  '../src/lib/weekly.js'
);

const tz = process.env.TZ;
let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  [${tz}] ASSERT FAILED: ${msg}`);
    failures++;
  }
};

// Week of Mon 2026-08-03 .. Sun 2026-08-09, viewed on Friday.
const friday = new Date('2026-08-07T09:00:00');

// --- the reported bug -----------------------------------------------------
{
  const history = [
    { type: 'Cardio', date: '2026-08-07' }, // Fri
    { type: 'Lift', date: '2026-08-05' }, // Wed
    { type: 'Cardio', date: '2026-08-03' }, // Mon — the one that used to vanish
  ];
  const counts = weeklyCounts(history, friday);
  assert(counts.Cardio === 2, `Mon+Fri cardio should count 2, got ${counts.Cardio}`);
  assert(counts.Lift === 1, `one lift should count 1, got ${counts.Lift}`);
}

// --- every day of the week counts, including both edges -------------------
{
  const days = ['03', '04', '05', '06', '07', '08', '09'];
  const history = days.map((d) => ({ type: 'Lift', date: `2026-08-${d}` }));
  const counts = weeklyCounts(history, friday);
  assert(counts.Lift === 7, `all 7 days of the week should count, got ${counts.Lift}`);

  // Viewed from the Monday itself, and from the Sunday.
  for (const ref of ['2026-08-03T06:00:00', '2026-08-09T23:30:00']) {
    const c = weeklyCounts(history, new Date(ref));
    assert(c.Lift === 7, `from ${ref}: expected 7, got ${c.Lift}`);
  }
}

// --- neighbouring weeks are excluded --------------------------------------
{
  const history = [
    { type: 'Cardio', date: '2026-08-02' }, // Sun, previous week
    { type: 'Cardio', date: '2026-08-03' }, // Mon, this week
    { type: 'Cardio', date: '2026-08-09' }, // Sun, this week
    { type: 'Cardio', date: '2026-08-10' }, // Mon, next week
  ];
  const counts = weeklyCounts(history, friday);
  assert(counts.Cardio === 2, `only the two in-week sessions should count, got ${counts.Cardio}`);
}

// --- boundaries are local midnight, half-open -----------------------------
{
  const start = startOfWeek(friday);
  const end = endOfWeek(friday);
  assert(start.getDay() === 1, `week should start on Monday, got day ${start.getDay()}`);
  assert(start.getHours() === 0 && start.getMinutes() === 0, 'week should start at local midnight');
  assert(end - start === 7 * 24 * 3600 * 1000, 'week should span exactly 7 days');
  assert(
    parseLocalDate('2026-08-03').getDate() === 3,
    'a stored date must parse to the same calendar day locally',
  );
  // todayISO must round-trip through parseLocalDate.
  const iso = todayISO(friday);
  assert(iso === '2026-08-07', `todayISO should be 2026-08-07, got ${iso}`);
  assert(parseLocalDate(iso).getDate() === 7, 'todayISO must round-trip through parseLocalDate');
}

// --- malformed entries are skipped rather than throwing -------------------
{
  const counts = weeklyCounts(
    [{ type: 'Lift' }, null, { type: 'Cardio', date: '2026-08-05' }],
    friday,
  );
  assert(counts.Cardio === 1, 'a dateless or null entry must not break the tally');
}

if (failures === 0) console.log(`  ${tz.padEnd(22)} ok`);
process.exit(failures === 0 ? 0 : 1);
