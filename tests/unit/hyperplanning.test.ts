import { strict as assert } from 'node:assert';
import { createServer, request } from 'node:http';
import { type AddressInfo, BlockList } from 'node:net';
import { describe, test } from 'node:test';

import { ICS_FETCH_TIMEOUT, MAX_ICS_BYTES, MAX_ICS_EVENTS } from '../../src/constants.js';
import hyperplanning, { fetchCalendar } from '../../src/modules/v4/hyperplanning.js';
import { fetchRemote, type RemoteFetcher, type RemoteOptions } from '../../src/utils/remote.js';

const sampleIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-1@test
DTSTAMP:20990101T000000Z
DTSTART:20990101T080000Z
DTEND:20990101T090000Z
SUMMARY:Mathematics - CM
DESCRIPTION:Matière : Mathematics\\nEnseignant : Mr Smith\\nPromotions : G1, G2\\nSalle : Room 101
END:VEVENT
END:VCALENDAR`;

/**
 * Builds a calendar of future events, every other one carrying a RECURRENCE-ID like an edited occurrence.
 *
 * @param count - Number of VEVENT blocks
 * @returns ICS text of about 150 bytes per event
 */
function bulkIcs(count: number): string {
    const events = Array.from(
        { length: count },
        (_, i) =>
            `BEGIN:VEVENT\r\nUID:${i % 50}\r\nDTSTART:20991201T080000Z\r\nDTEND:20991201T090000Z\r\n` +
            `${i % 2 ? 'RECURRENCE-ID:20991201T080000Z\r\n' : ''}SUMMARY:x\r\nEND:VEVENT\r\n`,
    );
    return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('')}END:VCALENDAR\r\n`;
}

/**
 * Builds a fetcher that answers every URL with the same response, without any network access.
 *
 * @param body - Response body
 * @param ok - Whether the response status is in the 2xx range
 * @param contentType - Content-Type header of the response
 * @returns Fetcher running the module's response check before returning the body
 */
function mockFetch(body: string | Buffer, ok = true, contentType = 'text/calendar'): RemoteFetcher {
    return async (_url, options) => {
        options.check?.({ status: ok ? 200 : 404, ok, contentType });
        return Buffer.from(body);
    };
}

/**
 * Builds a fetcher that runs the real helper with extra options merged over the module's ones.
 *
 * @param extra - Options added to the ones the module passes
 * @returns Fetcher wrapping fetchRemote
 */
function realFetch(extra: Partial<RemoteOptions>): RemoteFetcher {
    return (url, options) => fetchRemote(url, { ...options, ...extra });
}

describe('hyperplanning', () => {
    test('parses valid ICS with default detail', async () => {
        const events = await fetchCalendar('https://fake.test/cal.ics', undefined, mockFetch(sampleIcs));
        assert.equal(events.length, 1);
        assert.equal(events[0]!.summary, 'Mathematics - CM');
        assert.ok(events[0]!.start);
        assert.ok(events[0]!.end);
    });

    test('detail=list returns split summary', async () => {
        const events = await fetchCalendar('https://fake.test/cal.ics', 'list', mockFetch(sampleIcs));
        assert.deepEqual(events[0]!.summary, ['Mathematics', 'CM']);
    });

    test('detail=full extracts subject/teacher/classes', async () => {
        const events = await fetchCalendar('https://fake.test/cal.ics', 'full', mockFetch(sampleIcs));
        const e = events[0]!;
        assert.equal(e.subject, 'Mathematics');
        assert.equal(e.teacher, 'Mr Smith');
        assert.deepEqual(e.classes, ['G1', 'G2']);
    });

    test('decodes the body as UTF-8 and drops a byte order mark, like Response.text()', async () => {
        const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sampleIcs, 'utf8')]);
        const events = await fetchCalendar('https://fake.test/cal.ics', 'full', mockFetch(body));
        assert.equal(events[0]!.subject, 'Mathematics');
    });

    test('throws on non-OK response', async () => {
        await assert.rejects(
            () => fetchCalendar('https://fake.test/cal.ics', undefined, mockFetch('', false)),
            /Invalid ICS/,
        );
    });

    test('throws on wrong content-type', async () => {
        await assert.rejects(
            () => fetchCalendar('https://fake.test/cal.ics', undefined, mockFetch(sampleIcs, true, 'text/html')),
            /Invalid ICS/,
        );
    });

    test('filters out past events', async () => {
        const pastIcs = sampleIcs.replaceAll('20990101', '19990101');
        const events = await fetchCalendar('https://fake.test/cal.ics', undefined, mockFetch(pastIcs));
        assert.equal(events.length, 0);
    });

    test('fetches with a 1MB body limit and the 10 s timeout', async () => {
        let seen: RemoteOptions | undefined;
        const fetcher: RemoteFetcher = async (url, options) => {
            seen = options;
            return mockFetch(sampleIcs)(url, options);
        };
        await fetchCalendar('https://fake.test/cal.ics', undefined, fetcher);
        assert.equal(seen?.maxBytes, MAX_ICS_BYTES);
        assert.equal(MAX_ICS_BYTES, 1024 * 1024);
        assert.equal(seen?.timeout, ICS_FETCH_TIMEOUT);
        assert.equal(ICS_FETCH_TIMEOUT, 10_000);
    });

    test('throws on HTTP URL', async () => {
        await assert.rejects(() => hyperplanning('http://fake.test/cal.ics'), /Only HTTPS/);
    });

    test('throws on private IP', async () => {
        await assert.rejects(() => hyperplanning('https://127.0.0.1/cal.ics'), /private/);
        await assert.rejects(() => hyperplanning('https://192.168.1.1/cal.ics'), /private/);
        await assert.rejects(() => hyperplanning('https://10.0.0.1/cal.ics'), /private/);
        await assert.rejects(() => hyperplanning('https://169.254.169.254/latest'), /private/);
    });

    test('throws on localhost', async () => {
        await assert.rejects(() => hyperplanning('https://localhost/cal.ics'), /private/);
    });

    test('throws on invalid URL', async () => {
        await assert.rejects(() => hyperplanning('not-a-url'), /Invalid URL/);
    });
});

describe('hyperplanning parse cost', () => {
    test('parses a calendar of edited occurrences in linear time', async () => {
        // Compares how the cost scales, an absolute bound would depend on machine load
        const large = MAX_ICS_EVENTS;
        const small = Math.floor(large / 16);
        const hangGuard = 10_000;
        const smallFetcher = mockFetch(bulkIcs(small));
        const largeFetcher = mockFetch(bulkIcs(large));

        /**
         * Measures one parse of a prepared calendar.
         *
         * @param count - Number of VEVENT blocks in the calendar behind the fetcher
         * @param fetcher - Fetcher answering with that calendar
         * @returns Elapsed milliseconds of the parse
         */
        async function parseTime(count: number, fetcher: RemoteFetcher): Promise<number> {
            const start = performance.now();
            const events = await fetchCalendar('https://fake.test/cal.ics', undefined, fetcher);
            const elapsed = performance.now() - start;
            assert.equal(events.length, count);

            // Absolute bound kept only as a hang guard, far above any loaded machine and below a quadratic parse
            assert.ok(elapsed < hangGuard, `parsing ${count} events took ${elapsed} ms`);
            return elapsed;
        }

        // warm-up, so JIT compilation is not charged to the small size
        await parseTime(small, smallFetcher);
        let fast = Infinity;
        let slow = Infinity;

        // Both sizes are interleaved and the fastest of five runs kept, so a burst of load hits both of them alike
        for (let round = 0; round < 5; round++) {
            fast = Math.min(fast, await parseTime(small, smallFetcher));
            slow = Math.min(slow, await parseTime(large, largeFetcher));
        }

        // Linear costs about 16x (40x on a loaded machine), quadratic about 140x, so 80 sits between
        assert.ok(slow / fast < 80, `${large} events cost ${(slow / fast).toFixed(1)}x ${small} events`);
    });

    test('rejects a calendar with more events than the cap, in the module error style', async () => {
        assert.equal(MAX_ICS_EVENTS, 5000);
        await assert.rejects(
            () => fetchCalendar('https://fake.test/cal.ics', undefined, mockFetch(bulkIcs(MAX_ICS_EVENTS + 1))),
            /^Error: ICS file must have at most 5000 events\.$/,
        );
    });

    test('keeps each edited occurrence as its own event, as before', async () => {
        const ics = sampleIcs.replace(
            'END:VCALENDAR',
            [
                'BEGIN:VEVENT',
                'UID:event-1@test',
                'RECURRENCE-ID:20990101T080000Z',
                'DTSTART:20990102T100000Z',
                'DTEND:20990102T110000Z',
                'SUMMARY:Physics - TD',
                'END:VEVENT',
                'END:VCALENDAR',
            ].join('\n'),
        );
        const events = await fetchCalendar('https://fake.test/cal.ics', 'list', mockFetch(ics));
        assert.deepEqual(
            events.map((e) => e.summary),
            [
                ['Mathematics', 'CM'],
                ['Physics', 'TD'],
            ],
        );
        assert.ok(events[0]!.start < events[1]!.start);
    });

    test('ignores extra positional arguments, so it can be passed to Array.prototype.map', async () => {
        const loose = hyperplanning as (...args: unknown[]) => Promise<unknown>;
        await assert.rejects(() => loose('https://127.0.0.1/cal.ics', undefined, 0, []), /private/);
    });
});

describe('hyperplanning SSRF protection', () => {
    test('blocks the private hosts the old hostname list let through', async () => {
        for (const url of [
            'https://127.0.0.2/cal.ics',
            'https://[::ffff:127.0.0.1]/cal.ics',
            'https://[::]/cal.ics',
            'https://localhost./cal.ics',
            'https://100.64.0.1/cal.ics',
            'https://[fd00::1]/cal.ics',
            'https://metadata.google.internal./computeMetadata/v1/',
        ]) {
            await assert.rejects(
                () => hyperplanning(url),
                /^Error: Access to private\/internal hosts is not allowed\.$/,
            );
        }
    });

    test('blocks a public-looking hostname that resolves to a private address', async () => {
        const fetcher = realFetch({ resolve: async () => [{ address: '169.254.169.254', family: 4 }] });
        await assert.rejects(() => fetchCalendar('https://rebind.test/cal.ics', undefined, fetcher), /private/);
    });

    test('stops reading an ICS body past 1MB', async () => {
        const server = createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/calendar' });
            res.end(Buffer.alloc(MAX_ICS_BYTES + 1, 'A'));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;
        const fetcher = realFetch({
            blocklist: new BlockList(),
            resolve: async () => [{ address: '127.0.0.1', family: 4 }],
            request: (url, options, callback) =>
                request({ ...options, agent: undefined, hostname: url.hostname, port, path: url.pathname }, callback),
        });
        try {
            await assert.rejects(
                () => fetchCalendar('https://big.test/cal.ics', undefined, fetcher),
                /^Error: ICS file must be under 1MB\.$/,
            );
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
