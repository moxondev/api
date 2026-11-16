import { strict as assert } from 'node:assert';
import { describe, test, type TestContext } from 'node:test';

import { MAX_CRON_DURATION, MAX_CRON_DURATION_V4 } from '../../src/constants.js';
import cron from '../../src/modules/v4/cron.js';
import cronV5, { cronSearch } from '../../src/modules/v5/cron.js';

// Fixed reference point: a known Monday at 08:45 UTC
const FROM = '2026-01-05T08:45:00Z'; // Monday

describe('cron', () => {
    describe('every minute', () => {
        test('* * * * * returns 5 consecutive minutes', (t) => {
            freezeClock(t);
            const r = cron('* * * * *', 5, FROM);
            assert.equal(r.next.length, 5);
            // First result should be the next minute after FROM
            assert.ok(r.next[0]!.startsWith('2026-01-05T08:46'));
        });

        test('description is "Every minute"', (t) => {
            freezeClock(t);
            const r = cron('* * * * *', 1, FROM);
            assert.equal(r.description, 'Every minute');
        });
    });

    describe('every N minutes', () => {
        test('*/15 * * * * returns results 15 minutes apart', (t) => {
            freezeClock(t);
            const r = cron('*/15 * * * *', 3, FROM);
            assert.equal(r.next.length, 3);
            assert.ok(r.next[0]!.includes('T09:00'));
            assert.ok(r.next[1]!.includes('T09:15'));
            assert.ok(r.next[2]!.includes('T09:30'));
        });

        test('description mentions every 15 minutes', (t) => {
            freezeClock(t);
            const r = cron('*/15 * * * *', 1, FROM);
            assert.match(r.description, /Every 15 minutes/);
        });
    });

    describe('at fixed time', () => {
        test('0 9 * * 1-5 fires at 09:00 on weekdays', (t) => {
            freezeClock(t);
            const r = cron('0 9 * * 1-5', 3, FROM);
            // Next Monday 09:00 is same day
            assert.ok(r.next[0]!.includes('T09:00'));

            // All results should be on weekdays (Mon-Fri)
            for (const date of r.next) {
                const d = new Date(date);
                const dow = d.getUTCDay();
                assert.ok(dow >= 1 && dow <= 5, `Expected weekday, got ${dow}`);
            }
        });

        test('description includes Monday through Friday', (t) => {
            freezeClock(t);
            const r = cron('0 9 * * 1-5', 1, FROM);
            assert.match(r.description, /Monday through Friday/);
        });
    });

    describe('plan example', () => {
        test('*/15 9-17 * * 1-5 fires between 09:00 and 17:45 on weekdays', (t) => {
            freezeClock(t);
            const r = cron('*/15 9-17 * * 1-5', 5, FROM);
            assert.equal(r.next.length, 5);
            for (const date of r.next) {
                const d = new Date(date);
                const hour = d.getUTCHours();
                assert.ok(hour >= 9 && hour <= 17);
                const dow = d.getUTCDay();
                assert.ok(dow >= 1 && dow <= 5);
            }
        });

        test('description includes "Every 15 minutes"', (t) => {
            freezeClock(t);
            const r = cron('*/15 9-17 * * 1-5', 1, FROM);
            assert.match(r.description, /Every 15 minutes/);
        });
    });

    describe('count', () => {
        test('count=10 returns 10 results', (t) => {
            freezeClock(t);
            const r = cron('* * * * *', 10, FROM);
            assert.equal(r.next.length, 10);
        });

        test('count=1 returns 1 result', (t) => {
            freezeClock(t);
            const r = cron('*/30 * * * *', 1, FROM);
            assert.equal(r.next.length, 1);
        });
    });

    describe('errors', () => {
        test('missing expr throws', () => {
            assert.throws(() => cron(''), /expression/);
        });

        test('too few fields throws', () => {
            assert.throws(() => cron('* * * *'), /5 fields/);
        });

        test('invalid range throws', () => {
            assert.throws(() => cron('60-70 * * * *'), /valid: 0-59/);
        });

        test('invalid timezone throws', () => {
            assert.throws(() => cron('* * * * *', 5, undefined, 'Mars/Olympus'), /timezone/);
        });

        test('count out of range throws', () => {
            assert.throws(() => cron('* * * * *', 21), /Count/);
        });
    });
});

// Start of 2026 in UTC, used by the timezone regressions below
const YEAR_START = '2026-01-01T00:00:00Z';

// Instant every test pins the clock to: the searches read Date.now() only for their wall-clock deadline
const CLOCK = 1_800_000_000_000;

// Clock reads allowed for a search that must end at once without searching (invalid dates, no loop pass at all)
const IMMEDIATE_READS = 10;

// Clock reads allowed for a cheap search, a few dozen passes measured, far below any budget
const QUICK_READS = 200;

// Clock reads allowed to prove a schedule never fires, about 1200 measured
const PROOF_READS = 5000;

/**
 * Freezes Date.now() for the running test, so the cron deadlines can never fire and a search only ends by its own
 * logic. Every search pass reads the clock exactly once, so the mock's call count measures the work done without
 * depending on how fast the machine is. The mock is restored by the test context when the test ends.
 *
 * @param t - Context of the running test
 * @returns The mocked Date.now(), whose call count is the number of clock reads so far
 */
function freezeClock(t: TestContext) {
    return t.mock.method(Date, 'now', () => CLOCK);
}

/**
 * Makes Date.now() advance by a fixed step on every read, so a deadline passes after a known number of search passes
 * whatever the machine does. The first read, the one that sets the deadline, returns CLOCK.
 *
 * @param t - Context of the running test
 * @param step - Milliseconds added by each read
 * @returns Nothing, the mock is restored by the test context when the test ends
 */
function tickClock(t: TestContext, step: number): void {
    let reads = 0;
    t.mock.method(Date, 'now', () => CLOCK + step * reads++);
}

// Times that never exist: each falls in the hour skipped when DST starts, every year
const DST_GAPS: [string, string][] = [
    ['30 2 25-31 3 0', 'Europe/Paris'],
    ['0 2 8-14 3 0', 'America/New_York'],
    ['0 2 1-7 10 0', 'Australia/Sydney'],
    ['30 2 29 3 0', 'Europe/Paris'],
];

describe('cron deadlines', () => {
    // Each clock read moves time forward by this much, so a deadline D lets through ceil(D / STEP) - 1 search passes
    const STEP = 100;

    test('the v5 search stops at its deadline and reports it is not complete', (t) => {
        // A frozen clock never reaches the deadline, so the same search finds every date it was asked for
        const frozen = freezeClock(t);
        const all = cronSearch('* * * * *', 5, FROM, 'UTC');
        assert.equal(all.result.next.length, 5);
        frozen.mock.restore();

        tickClock(t, STEP);
        const passes = Math.ceil(MAX_CRON_DURATION / STEP) - 1;
        const cut = cronSearch('* * * * *', 5, FROM, 'UTC');

        // One date per pass, and the cut-off search must not claim it listed everything
        assert.deepEqual(cut.result.next, all.result.next.slice(0, passes));
        assert.equal(cut.complete, false);
    });

    test('the v4 search stops at its own, longer deadline when v5 could not settle it', (t) => {
        const frozen = freezeClock(t);
        const all = cron('* * * * *', 20, FROM).next;
        assert.equal(all.length, 20);
        frozen.mock.restore();

        // The v5 pass is cut after its own budget, then v4 gets a fresh MAX_CRON_DURATION_V4 from the next read
        tickClock(t, STEP);
        const cut = cron('* * * * *', 20, FROM).next;
        assert.deepEqual(cut, all.slice(0, Math.ceil(MAX_CRON_DURATION_V4 / STEP) - 1));
    });
});

describe('cron v4 time budget', () => {
    // The clock is frozen, so the clock reads count the passes of each search
    test('never-matching 0 0 31 2 * returns no dates at once', (t) => {
        const now = freezeClock(t);
        const value = cron('0 0 31 2 *', 1, YEAR_START);
        assert.deepEqual(value.next, []);
        assert.ok(now.mock.callCount() < IMMEDIATE_READS, `${now.mock.callCount()} clock reads`);
    });

    test('times skipped by DST return no dates at once', (t) => {
        const now = freezeClock(t);
        for (const [expr, timezone] of DST_GAPS) {
            now.mock.resetCalls();
            const value = cron(expr, 1, YEAR_START, timezone);
            assert.deepEqual(value.next, [], expr);

            // The old search spun to its 1 s budget here, which is hundreds of thousands of passes
            assert.ok(
                now.mock.callCount() < PROOF_READS,
                `${expr} in ${timezone}: ${now.mock.callCount()} clock reads`,
            );
        }
    });

    test('a UTC+ month skip that replays the same span stops at once with the v4 result', (t) => {
        const now = freezeClock(t);
        for (const timezone of ['Europe/Paris', 'Asia/Tokyo']) {
            now.mock.resetCalls();
            const value = cron('0 12 1 6 *', 2, YEAR_START, timezone);
            assert.deepEqual(value.next, [], timezone);
            assert.ok(now.mock.callCount() < QUICK_READS, `${timezone}: ${now.mock.callCount()} clock reads`);
        }
        assert.deepEqual(cron('0 0 28 2 *', 3, YEAR_START, 'Europe/Paris').next, ['2026-02-27T23:00:00.000Z']);
    });

    test('a replayed span that holds dates still repeats them, as v4 always did', (t) => {
        freezeClock(t);
        assert.deepEqual(cron('0 21 * 5 *', 5, '2026-05-29T00:00:00Z', 'Asia/Tokyo').next, [
            '2026-05-29T12:00:00.000Z',
            '2026-05-30T12:00:00.000Z',
            '2026-05-31T12:00:00.000Z',
            '2026-05-31T12:00:00.000Z',
            '2026-05-31T12:00:00.000Z',
        ]);
    });

    test('rare but valid dates are all still found', (t) => {
        freezeClock(t);
        const r = cron('0 0 29 2 *', 20, YEAR_START);
        assert.equal(r.next.length, 20);
        assert.equal(r.next[19], '2108-02-29T00:00:00.000Z');
    });

    test('valid expressions keep their output', (t) => {
        freezeClock(t);
        assert.deepEqual(cron('0 12 1 6 *', 2, YEAR_START).next, [
            '2026-06-01T12:00:00.000Z',
            '2027-06-01T12:00:00.000Z',
        ]);
        assert.deepEqual(cron('0 0 28 2 *', 3, YEAR_START, 'America/New_York').next, [
            '2026-02-28T05:00:00.000Z',
            '2027-02-28T05:00:00.000Z',
            '2028-02-28T05:00:00.000Z',
        ]);
    });
});

describe('cron v5', () => {
    describe('UTC+ timezones', () => {
        test('0 12 1 6 * in Europe/Paris returns both June dates quickly', (t) => {
            const now = freezeClock(t);
            const value = cronV5('0 12 1 6 *', 2, YEAR_START, 'Europe/Paris');
            assert.deepEqual(value.next, ['2026-06-01T10:00:00.000Z', '2027-06-01T10:00:00.000Z']);
            assert.ok(now.mock.callCount() < QUICK_READS, `${now.mock.callCount()} clock reads`);
        });

        test('0 12 1 6 * in Asia/Tokyo returns both June dates quickly', (t) => {
            const now = freezeClock(t);
            const value = cronV5('0 12 1 6 *', 2, YEAR_START, 'Asia/Tokyo');
            assert.deepEqual(value.next, ['2026-06-01T03:00:00.000Z', '2027-06-01T03:00:00.000Z']);
            assert.ok(now.mock.callCount() < QUICK_READS, `${now.mock.callCount()} clock reads`);
        });

        test('0 0 28 2 * in Europe/Paris returns 3 dates', (t) => {
            freezeClock(t);
            assert.deepEqual(cronV5('0 0 28 2 *', 3, YEAR_START, 'Europe/Paris').next, [
                '2026-02-27T23:00:00.000Z',
                '2027-02-27T23:00:00.000Z',
                '2028-02-27T23:00:00.000Z',
            ]);
        });

        test('local midnight of the day DST starts in Australia/Sydney', (t) => {
            freezeClock(t);
            assert.deepEqual(cronV5('0 0 1-7 10 0', 2, YEAR_START, 'Australia/Sydney').next, [
                '2026-10-03T14:00:00.000Z',
                '2027-10-02T14:00:00.000Z',
            ]);
        });

        test('0 0 1 * * in Australia/Sydney returns local midnights', (t) => {
            freezeClock(t);
            assert.deepEqual(cronV5('0 0 1 * *', 3, YEAR_START, 'Australia/Sydney').next, [
                '2026-01-31T13:00:00.000Z',
                '2026-02-28T13:00:00.000Z',
                '2026-03-31T13:00:00.000Z',
            ]);
        });

        test('local midnight right after a DST change is not skipped', (t) => {
            freezeClock(t);
            const r = cronV5('0 0 * * 1', 2, '2026-03-27T00:00:00Z', 'Europe/Paris');
            assert.deepEqual(r.next, ['2026-03-29T22:00:00.000Z', '2026-04-05T22:00:00.000Z']);
        });

        test('dates are strictly increasing', (t) => {
            freezeClock(t);
            const r = cronV5('*/20 0,23 1,28-31 * *', 20, YEAR_START, 'Asia/Tokyo');
            assert.equal(r.next.length, 20);
            for (let i = 1; i < r.next.length; i++) assert.ok(r.next[i]! > r.next[i - 1]!);
        });
    });

    describe('never-matching expressions', () => {
        test('times skipped by DST return no dates, proven rather than timed out', (t) => {
            // With the clock frozen the 250 ms deadline cannot fire, so complete can only come from the proof itself
            freezeClock(t);
            for (const [expr, timezone] of DST_GAPS) {
                const { result, complete } = cronSearch(expr, 1, YEAR_START, timezone);
                assert.deepEqual(result.next, [], expr);
                assert.equal(complete, true, `${expr} in ${timezone} ran out of time`);
            }
        });

        test('cronSearch tells when the listed dates are all there will ever be', (t) => {
            freezeClock(t);
            assert.equal(cronSearch('0 0 31 2 *', 5, YEAR_START, 'UTC').complete, true);
            assert.equal(cronSearch('30 2 25-31 3 0', 5, YEAR_START, 'Europe/Paris').complete, true);
            assert.equal(cronSearch('0 0 * * *', 5, YEAR_START, 'UTC').complete, false);
            assert.deepEqual(cronSearch('0 0 1 1 *', 2, YEAR_START, 'UTC').result, cronV5('0 0 1 1 *', 2, YEAR_START));
        });

        test('0 0 31 2 * returns no dates immediately', (t) => {
            const now = freezeClock(t);
            const value = cronV5('0 0 31 2 *', 20, YEAR_START, 'Europe/Paris');
            assert.deepEqual(value.next, []);
            assert.ok(now.mock.callCount() < IMMEDIATE_READS, `${now.mock.callCount()} clock reads`);
        });

        test('0 0 30,31 2 * returns no dates immediately', (t) => {
            const now = freezeClock(t);
            const value = cronV5('0 0 30,31 2 *', 1, YEAR_START);
            assert.deepEqual(value.next, []);
            assert.ok(now.mock.callCount() < IMMEDIATE_READS, `${now.mock.callCount()} clock reads`);
        });

        test('response shape matches v4', (t) => {
            freezeClock(t);
            assert.deepEqual(cronV5('0 0 31 2 *', 1, YEAR_START), {
                expression: '0 0 31 2 *',
                description: 'At cron schedule: 0 0 31 2 *',
                next: [],
                timezone: 'UTC',
            });
        });

        test('February 29 is still reachable', (t) => {
            freezeClock(t);
            assert.deepEqual(cronV5('0 0 29 2 *', 2, YEAR_START).next, [
                '2028-02-29T00:00:00.000Z',
                '2032-02-29T00:00:00.000Z',
            ]);
        });

        test('0 0 29 2 1 finds 20 Monday leap days', (t) => {
            freezeClock(t);
            const r = cronV5('0 0 29 2 1', 20, '2026-01-05T08:45:00Z');
            assert.equal(r.next.length, 20);
            assert.equal(r.next[0], '2044-02-29T00:00:00.000Z');
            assert.equal(r.next[19], '2568-02-29T00:00:00.000Z');
        });
    });

    describe('same output as v4 in UTC', () => {
        const cases = [
            '* * * * *',
            '*/15 * * * *',
            '0 * * * *',
            '0 */6 * * *',
            '0 9 * * 1-5',
            '*/15 9-17 * * 1-5',
            '0 0 1 * *',
            '0 12 1 6 *',
            '0 0 30 4,6 *',
            '0 0 13 * 5',
            '59 23 31 12 *',
            '5,10 3 1-3 1,7 0',
        ];

        for (const expr of cases) {
            test(expr, (t) => {
                freezeClock(t);
                assert.deepEqual(cronV5(expr, 20, FROM), cron(expr, 20, FROM));
            });
        }

        test('years below 100 are kept as is', (t) => {
            freezeClock(t);
            const from = '0050-06-15T00:00:00Z';
            assert.deepEqual(cronV5('0 0 1 1 *', 2, from), cron('0 0 1 1 *', 2, from));
            assert.equal(cronV5('0 0 1 1 *', 1, from).next[0], '0051-01-01T00:00:00.000Z');
        });
    });

    describe('errors match v4', () => {
        const inputs: [string, number?, string?, string?][] = [
            [''],
            ['* * * *'],
            ['60-70 * * * *'],
            ['*/0 * * * *'],
            ['* * * * *', 5, undefined, 'Mars/Olympus'],
            ['* * * * *', 21],
            ['* * * * *', 5, 'not-a-date'],
        ];

        for (const args of inputs) {
            test(JSON.stringify(args), () => {
                let expected = '';
                try {
                    cron(...args);
                } catch (err) {
                    expected = (err as Error).message;
                }
                assert.ok(expected);
                assert.throws(() => cronV5(...args), { message: expected });
            });
        }
    });
});
