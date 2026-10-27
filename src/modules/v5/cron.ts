import { MAX_CRON_DURATION, MAX_CRON_GAP, MAX_CRON_ITERATIONS, MAX_CRON_RESULTS } from '../../constants.js';
import type { CronResult } from '../v4/cron.js';
import { VALID_TIMEZONES } from '../v4/time.js';

type Timezone = (typeof VALID_TIMEZONES)[number];

interface Components {
    year: number;
    minute: number;
    hour: number;
    dom: number;
    month: number;
    dow: number;
}

// Bounds of the minute, hour, day of month, month and day of week fields, where 0 and 7 are both Sunday
const FIELD_RANGES = [
    { min: 0, max: 59 },
    { min: 0, max: 23 },
    { min: 1, max: 31 },
    { min: 1, max: 12 },
    { min: 0, max: 7 },
] as const;

// Longest length of each month, February counted as 29 days
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const DOW_NAMES: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
};

const DOW_DISPLAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parses one cron field into the set of values it matches.
 *
 * @param field - Raw field text: a wildcard, a step, a range, a value or a comma-separated list of those
 * @param range - Inclusive bounds allowed for this field
 * @returns Every value matched by the field
 * @throws Error if a value, range or step is invalid
 */
function parseField(field: string, range: { min: number; max: number }): Set<number> {
    const result = new Set<number>();

    for (const part of field.split(',')) {
        if (part === '*') {
            for (let i = range.min; i <= range.max; i++) result.add(i);
        } else if (part.startsWith('*/')) {
            const step = parseInt(part.slice(2), 10);
            if (isNaN(step) || step < 1) throw new Error(`Invalid step in "${part}"`);
            for (let i = range.min; i <= range.max; i += step) result.add(i);
        } else if (part.includes('-')) {
            const [s, e] = part.split('-');
            const start = parseInt(s!, 10);
            const end = parseInt(e!, 10);
            if (isNaN(start) || isNaN(end) || start < range.min || end > range.max || start > end) {
                throw new Error(`Invalid range "${part}" (valid: ${range.min}-${range.max})`);
            }
            for (let i = start; i <= end; i++) result.add(i);
        } else {
            const val = parseInt(part, 10);
            if (isNaN(val) || val < range.min || val > range.max) {
                throw new Error(`Invalid value "${part}" (valid: ${range.min}-${range.max})`);
            }
            result.add(val);
        }
    }

    return result;
}

/**
 * Reads the local calendar fields of an instant in the formatter's timezone.
 *
 * @param date - Instant to read
 * @param formatter - Formatter bound to the target timezone
 * @returns Local year, minute, hour, day of month, month (1-12) and day of week (0 = Sunday)
 */
function getComponents(date: Date, formatter: Intl.DateTimeFormat): Components {
    const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
    const year = parseInt(parts.year!, 10);
    return {
        year: parts.era === 'BC' ? 1 - year : year,
        minute: parseInt(parts.minute!, 10),
        hour: parseInt(parts.hour!, 10) % 24,
        dom: parseInt(parts.day!, 10),
        month: parseInt(parts.month!, 10),
        dow: DOW_NAMES[parts.weekday!] ?? 0,
    };
}

/**
 * Builds a UTC timestamp from calendar fields, without the 1900 offset Date.UTC applies to years 0-99.
 *
 * @param year - Full year, possibly zero or negative
 * @param month - Month from 1 to 12
 * @param day - Day of month
 * @param hour - Hour of day
 * @param minute - Minute of hour
 * @returns Milliseconds since the epoch
 */
function utc(year: number, month: number, day: number, hour: number = 0, minute: number = 0): number {
    const d = new Date(0);
    d.setUTCFullYear(year, month - 1, day);
    d.setUTCHours(hour, minute, 0, 0);
    return d.getTime();
}

/**
 * Counts the days of a month in the proleptic Gregorian calendar.
 *
 * @param year - Full year
 * @param month - Month from 1 to 12
 * @returns Number of days, 28 to 31
 */
function daysInMonth(year: number, month: number): number {
    if (month !== 2) return MONTH_DAYS[month - 1]!;
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
}

/**
 * Finds the first instant of a local calendar day in the formatter's timezone.
 *
 * @param year - Local year
 * @param month - Local month from 1 to 12
 * @param day - Local day of month
 * @param formatter - Formatter bound to the target timezone
 * @returns Timestamp of local midnight, or of the first whole hour of that day when midnight does not exist
 */
function localMidnight(year: number, month: number, day: number, formatter: Intl.DateTimeFormat): number {
    const guess = utc(year, month, day);
    const p = getComponents(new Date(guess), formatter);
    const ms = 2 * guess - utc(p.year, p.month, p.dom, p.hour, p.minute);
    const q = getComponents(new Date(ms), formatter);
    if (q.year === year && q.month === month && q.dom === day && q.hour === 0 && q.minute === 0) return ms;

    // The guess fell after a change later that day: the offset at the first estimate is the one in force at midnight
    const retry = ms + guess - utc(q.year, q.month, q.dom, q.hour, q.minute);
    const r = getComponents(new Date(retry), formatter);
    if (r.year === year && r.month === month && r.dom === day && r.hour === 0 && r.minute === 0) return retry;

    // The offset changed between the guess and midnight: walk hourly from the earliest possible start
    const key = (c: Components) => (c.year * 100 + c.month) * 100 + c.dom;
    const target = (year * 100 + month) * 100 + day;
    let t = guess - 14 * 3600000;
    for (let i = 0; i < 48 && key(getComponents(new Date(t), formatter)) < target; i++) t += 3600000;
    return t;
}

/**
 * Finds the next local day, after the given one, whose month, day of month and day of week are all allowed.
 *
 * @param year - Current local year
 * @param month - Current local month from 1 to 12
 * @param dom - Current local day of month, or 0 to include the first day of the month
 * @param domSet - Allowed days of month
 * @param monthSet - Allowed months
 * @param dowSet - Allowed days of week, 0 being Sunday
 * @param formatter - Formatter bound to the target timezone
 * @returns Timestamp of that day's local midnight, or null if none exists within 400 years
 */
function nextDay(
    year: number,
    month: number,
    dom: number,
    domSet: Set<number>,
    monthSet: Set<number>,
    dowSet: Set<number>,
    formatter: Intl.DateTimeFormat,
): number | null {
    let y = year;
    let m = month;
    let from = dom;

    for (let i = 0; i < 400 * 12; i++) {
        if (monthSet.has(m)) {
            const last = daysInMonth(y, m);

            // A calendar date falls on the same weekday in every timezone
            const first = new Date(utc(y, m, 1)).getUTCDay();
            for (let d = from + 1; d <= last; d++) {
                if (domSet.has(d) && dowSet.has((first + d - 1) % 7)) return localMidnight(y, m, d, formatter);
            }
        }
        m++;
        if (m > 12) {
            m = 1;
            y++;
        }
        from = 0;
    }

    return null;
}

/**
 * Formats a number on two digits.
 *
 * @param n - Number to format
 * @returns Number padded with a leading zero
 */
function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/**
 * Turns a day-of-week field into a readable label.
 *
 * @param field - Raw day-of-week field
 * @returns Day name, weekday range label, or the raw field when it has no label
 */
function formatDow(field: string): string {
    if (field === '1-5') return 'Monday through Friday';
    if (field === '0' || field === '7') return 'Sunday';
    if (field === '6') return 'Saturday';
    const n = parseInt(field, 10);
    if (!isNaN(n)) return DOW_DISPLAY[n % 7] ?? field;
    return field;
}

/**
 * Builds a human-readable description of a cron expression.
 *
 * @param fields - The 5 raw fields of the expression
 * @returns English sentence describing the schedule
 */
function describe(fields: string[]): string {
    const [mF, hF, domF, monthF, dowF] = fields as [string, string, string, string, string];

    const isAll = (f: string) => f === '*';
    const isFixed = (f: string) => /^\d+$/.test(f);
    const isStep = (f: string) => /^\*\/\d+$/.test(f);

    if (isAll(mF) && isAll(hF) && isAll(domF) && isAll(monthF) && isAll(dowF)) {
        return 'Every minute';
    }

    if (isStep(mF) && isAll(hF) && isAll(domF) && isAll(monthF) && isAll(dowF)) {
        const n = mF.slice(2);
        return `Every ${n} minute${n === '1' ? '' : 's'}`;
    }

    if (mF === '0' && isAll(hF) && isAll(domF) && isAll(monthF) && isAll(dowF)) {
        return 'Every hour';
    }

    if (mF === '0' && isStep(hF) && isAll(domF) && isAll(monthF) && isAll(dowF)) {
        const n = hF.slice(2);
        return `Every ${n} hour${n === '1' ? '' : 's'}`;
    }

    if (isFixed(mF) && isFixed(hF) && isAll(domF) && isAll(monthF) && isAll(dowF)) {
        return `At ${pad(parseInt(hF))}:${pad(parseInt(mF))} daily`;
    }

    if (isFixed(mF) && isFixed(hF) && isAll(domF) && isAll(monthF) && !isAll(dowF)) {
        return `At ${pad(parseInt(hF))}:${pad(parseInt(mF))}, ${formatDow(dowF)}`;
    }

    if (isFixed(mF) && isFixed(hF) && isFixed(domF) && isAll(monthF) && isAll(dowF)) {
        return `At ${pad(parseInt(hF))}:${pad(parseInt(mF))}, on day ${domF} of the month`;
    }

    if (isStep(mF) && !isAll(hF) && isAll(domF) && isAll(monthF)) {
        const n = mF.slice(2);
        const parts = [`Every ${n} minute${n === '1' ? '' : 's'}`];
        if (hF.includes('-')) {
            const [h1, h2] = hF.split('-');
            parts.push(`between ${pad(parseInt(h1!))}:00 and ${pad(parseInt(h2!))}:59`);
        }
        if (!isAll(dowF)) parts.push(formatDow(dowF));
        return parts.join(', ');
    }

    return `At cron schedule: ${fields.join(' ')}`;
}

/**
 * Parses a cron expression and returns the next scheduled execution dates.
 *
 * @param expr - Cron expression with 5 space-separated fields (minute hour dom month dow)
 * @param count - Number of next executions to return (1-20, default 5)
 * @param from - Starting date in ISO 8601 format (defaults to now)
 * @param timezone - Timezone to evaluate the expression in (default "UTC")
 * @returns Parsed expression with description and list of next execution timestamps
 * @throws Error if the expression is invalid, count is out of range, or timezone is unsupported
 */
export default function cron(expr: string, count: number = 5, from?: string, timezone: string = 'UTC'): CronResult {
    return cronSearch(expr, count, from, timezone).result;
}

/**
 * Runs the cron search and also tells whether it listed every date the schedule will ever have.
 *
 * @param expr - Cron expression with 5 space-separated fields (minute hour dom month dow)
 * @param count - Number of next executions to look for (1-20)
 * @param from - Starting date in ISO 8601 format (defaults to now)
 * @param timezone - Timezone to evaluate the expression in
 * @returns The cron result, and complete set when fewer than count dates exist after from
 * @throws Error if the expression is invalid, count is out of range, or timezone is unsupported
 */
export function cronSearch(
    expr: string,
    count: number,
    from: string | undefined,
    timezone: string,
): { result: CronResult; complete: boolean } {
    if (!expr) throw new Error('Please provide a cron expression (?expr=* * * * *)');

    if (!VALID_TIMEZONES.includes(timezone as Timezone)) {
        throw new Error(`Please provide a valid timezone. Options: ${VALID_TIMEZONES.join(', ')}`);
    }

    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) {
        throw new Error('Cron expression must have exactly 5 fields (minute hour dom month dow)');
    }

    if (count < 1 || count > MAX_CRON_RESULTS) {
        throw new Error(`Count must be between 1 and ${MAX_CRON_RESULTS}`);
    }

    const fromMs = from ? new Date(from).getTime() : Date.now();
    if (from && isNaN(fromMs)) throw new Error('Please provide a valid from date (ISO 8601)');

    const sets = fields.map((f, i) => parseField(f, FIELD_RANGES[i]!));
    const [minuteSet, hourSet, domSet, monthSet, dowSet] = sets as [
        Set<number>,
        Set<number>,
        Set<number>,
        Set<number>,
        Set<number>,
    ];

    if (dowSet.has(7)) {
        dowSet.add(0);
        dowSet.delete(7);
    }

    const result = { expression: expr.trim(), description: describe(fields), next: [] as string[], timezone };

    // A day of month longer than every allowed month (31 2, 30 2) can never match
    const fits = [...monthSet].some((m) => [...domSet].some((d) => d <= MONTH_DAYS[m - 1]!));
    if (!fits) return { result, complete: true };

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        era: 'short',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'long',
        hour12: false,
    });

    let currentMs = (Math.floor(fromMs / 60000) + 1) * 60000;

    const { next } = result;
    const lastHour = Math.max(...hourSet);
    const deadline = Date.now() + MAX_CRON_DURATION;
    let lastMs = fromMs;
    let complete = false;
    let iterations = 0;

    while (next.length < count && iterations < MAX_CRON_ITERATIONS && Date.now() < deadline) {
        // Dates and weekdays repeat every 400 years, so a schedule idle for longer never fires (DST gaps)
        if (currentMs - lastMs > MAX_CRON_GAP) {
            complete = true;
            break;
        }

        const { year, minute, hour, dom, month, dow } = getComponents(new Date(currentMs), formatter);

        // Past the last allowed hour, the rest of the day cannot match either
        const dayOver = hour > lastHour;
        if (!monthSet.has(month) || !domSet.has(dom) || !dowSet.has(dow) || dayOver) {
            const after = monthSet.has(month) ? dom : 0;
            const target = nextDay(year, month, after, domSet, monthSet, dowSet, formatter);
            if (target === null) {
                complete = true;
                break;
            }

            // A jump that does not move forward would loop forever, so fall back to the next minute
            currentMs = Math.max(target, currentMs + 60000);
        } else if (!hourSet.has(hour)) {
            currentMs += (60 - minute) * 60000;
        } else if (!minuteSet.has(minute)) {
            // Offsets never change within an hour in the supported timezones, so this jump is safe
            let m = minute + 1;
            while (m < 60 && !minuteSet.has(m)) m++;
            currentMs += (m - minute) * 60000;
        } else {
            next.push(new Date(currentMs).toISOString());
            lastMs = currentMs;
            currentMs += 60000;
        }

        iterations++;
    }

    return { result, complete };
}
