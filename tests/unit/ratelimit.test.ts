import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import type { Request, Response } from 'express';

import { plans } from '../../src/config/plans.js';
import { RATE_LIMIT_WINDOW, SESSION_TTL } from '../../src/constants.js';
import {
    clientKey,
    createRateLimiter,
    networkKey,
    type RateLimiterOptions,
    sweep,
} from '../../src/middleware/ratelimit.js';
import type { IpLimits } from '../../src/types/storage.js';

interface Outcome {
    passed: boolean;
    status: number;
    headers: Record<string, string>;
    body: { message?: string; error?: string; status?: number };
}

// 10:15:00 UTC, so the hourly window ends 45 minutes later
const START = Date.UTC(2026, 0, 1, 10, 15, 0);
const HOURLY = plans.default!.hourly;
const BURST = plans.default!.burst;

/**
 * Builds a limiter on a private store with a clock the test moves by hand.
 *
 * @param options - Limiter options overriding the defaults used here
 * @returns The request helper, the clock setter and the private hourly store
 */
function setup(options: RateLimiterOptions = {}): {
    send: (ip: string, authorization?: string, peer?: string) => Outcome;
    flood: (ips: (i: number) => string, count: number) => Outcome[];
    at: (time: number) => void;
    limits: IpLimits;
} {
    let time = START;
    const limits: IpLimits = options.limits ?? Object.create(null);
    const limiter = createRateLimiter({ now: () => time, burst: false, ...options, limits });

    const send = (ip: string, authorization?: string, peer?: string): Outcome => {
        const outcome: Outcome = { passed: false, status: 200, headers: {}, body: {} };
        const headers = authorization ? { authorization } : {};
        const req = { ip, socket: { remoteAddress: peer }, headers } as unknown as Request;
        const res = {
            setHeader: (name: string, value: unknown) => {
                outcome.headers[name.toLowerCase()] = String(value);
                return res;
            },
            status: (code: number) => {
                outcome.status = code;
                return res;
            },
            send: (text: string) => {
                outcome.body = JSON.parse(text) as Outcome['body'];
                return res;
            },
        } as unknown as Response;

        limiter(req, res, () => {
            outcome.passed = true;
        });
        return outcome;
    };

    const flood = (ips: (i: number) => string, count: number): Outcome[] =>
        Array.from({ length: count }, (_, i) => send(ips(i)));

    return { send, flood, at: (value: number) => (time = value), limits };
}

describe('rate limiter: admitted requests', () => {
    test('passes a request and reports the hourly quota', () => {
        const { send } = setup();
        const outcome = send('203.0.113.7');
        assert.equal(outcome.passed, true);
        assert.deepEqual(outcome.headers, {
            'x-ratelimit-limit': String(HOURLY),
            'x-ratelimit-remaining': String(HOURLY - 1),
            'x-ratelimit-reset': String(Date.UTC(2026, 0, 1, 11) / 1000),
        });
    });

    test('counts down the remaining quota per client', () => {
        const { send } = setup();
        send('203.0.113.7');
        send('203.0.113.7');
        assert.equal(send('203.0.113.7').headers['x-ratelimit-remaining'], String(HOURLY - 3));
        assert.equal(send('203.0.113.8').headers['x-ratelimit-remaining'], String(HOURLY - 1));
    });

    test('starts a fresh quota when the hour changes', () => {
        const { send, at } = setup();
        send('203.0.113.7');
        at(Date.UTC(2026, 0, 1, 11, 0, 1));
        assert.equal(send('203.0.113.7').headers['x-ratelimit-remaining'], String(HOURLY - 1));
    });
});

describe('rate limiter: refusals', () => {
    test('answers 401 for an unknown bearer token', () => {
        const outcome = setup().send('203.0.113.7', 'Bearer nope');
        assert.equal(outcome.passed, false);
        assert.equal(outcome.status, 401);
        assert.deepEqual(outcome.body, { message: 'Unauthorized', error: 'Invalid token.', status: 401 });
    });

    test('counts a forwarded address that is not an IP, such as a prototype key, as the socket peer', () => {
        const { send, limits } = setup({ limits: {} });
        for (const ip of ['__proto__', 'constructor', 'prototype', 'toString', 'not an ip']) {
            assert.equal(send(ip, undefined, '198.51.100.9').passed, true, ip);
        }
        assert.deepEqual(Object.keys(limits), ['198.51.100.9']);
        assert.equal(Object.keys(Object.prototype).length, 0);
    });

    test('a forged /64 key cannot spend the quota of that network', () => {
        const { flood, send } = setup();
        send('2001:db8:1:2::1');
        flood(() => '2001:db8:1:2::/64', 100).forEach((o) => assert.equal(o.passed, true));
        assert.equal(send('2001:db8:1:2::1').headers['x-ratelimit-remaining'], String(HOURLY - 2));
    });

    test('burst: answers 429 past the burst size, with a Retry-After of the window', () => {
        const { flood, send, at } = setup({ burst: true });
        assert.ok(flood(() => '203.0.113.7', BURST).every((o) => o.passed));

        const refused = send('203.0.113.7');
        assert.equal(refused.passed, false);
        assert.equal(refused.status, 429);
        assert.equal(refused.headers['retry-after'], String(RATE_LIMIT_WINDOW / 1000));
        assert.deepEqual(refused.body, {
            message: 'Too Many Requests',
            error: 'Too many requests, please slow down.',
            status: 429,
        });

        assert.equal(send('203.0.113.8').passed, true);
        at(START + RATE_LIMIT_WINDOW);
        assert.equal(send('203.0.113.7').passed, true);
    });

    test('burst: stays off when disabled', () => {
        assert.ok(
            setup({ burst: false })
                .flood(() => '203.0.113.7', BURST * 2)
                .every((o) => o.passed),
        );
    });

    test('hourly: answers 429 past the quota, with a Retry-After to the end of the hour', () => {
        const { flood, send, at } = setup();
        assert.ok(flood(() => '203.0.113.7', HOURLY).every((o) => o.passed));

        const refused = send('203.0.113.7');
        assert.equal(refused.passed, false);
        assert.equal(refused.status, 429);
        assert.equal(refused.headers['retry-after'], String(45 * 60));
        assert.equal(refused.headers['x-ratelimit-remaining'], '0');
        assert.deepEqual(refused.body, {
            message: 'Too Many Requests',
            error: `You have exceeded the limit of ${HOURLY} requests per hour.`,
            status: 429,
        });

        at(Date.UTC(2026, 0, 1, 11, 0, 1));
        assert.equal(send('203.0.113.7').passed, true);
    });

    test('global: answers 429 once the instance budget is spent, with a Retry-After to its reset', () => {
        const { flood, send, at } = setup({ global: 0 });
        assert.ok(flood((i) => `10.0.${i >> 8}.${i & 255}`, HOURLY).every((o) => o.passed));

        at(START + 60_000);
        const refused = send('203.0.113.7');
        assert.equal(refused.passed, false);
        assert.equal(refused.status, 429);
        assert.equal(refused.headers['retry-after'], String(SESSION_TTL / 1000 - 60));
        assert.equal(refused.headers['x-ratelimit-remaining'], undefined);
        assert.deepEqual(refused.body, {
            message: 'Too Many Requests',
            error: 'Global rate limit exceeded.',
            status: 429,
        });

        at(START + SESSION_TTL + 1);
        assert.equal(send('203.0.113.7').passed, true);
    });

    test('global: the budget never drops below the plan quota', () => {
        const { flood } = setup({ global: 10 });
        assert.ok(flood((i) => `10.0.${i >> 8}.${i & 255}`, HOURLY).every((o) => o.passed));
    });
});

describe('rate limiter: refused requests do not use the global budget', () => {
    test('a client refused by the burst check leaves the budget to others', () => {
        const { flood, send } = setup({ burst: true, global: 0 });
        const outcomes = flood(() => '203.0.113.66', HOURLY + 1000);
        assert.equal(outcomes.filter((o) => o.passed).length, BURST);

        const other = send('203.0.113.7');
        assert.equal(other.passed, true);
        assert.equal(other.status, 200);
    });

    test('a client refused by the hourly check leaves the budget to others', () => {
        const global = HOURLY + 1000;
        const { flood, send } = setup({ global });
        assert.equal(flood(() => '203.0.113.66', HOURLY + 500).filter((o) => o.passed).length, HOURLY);

        const others = flood((i) => `10.1.${i >> 8}.${i & 255}`, global - HOURLY);
        assert.ok(others.every((o) => o.passed));
        assert.equal(send('203.0.113.7').body.error, 'Global rate limit exceeded.');
    });

    test('a request refused globally is not counted against its client', () => {
        const { flood, send, limits } = setup({ global: 0 });
        flood((i) => `10.0.${i >> 8}.${i & 255}`, HOURLY);
        assert.equal(send('203.0.113.7').status, 429);
        assert.equal(Object.hasOwn(limits, '203.0.113.7'), false);
    });
});

describe('rate limiter: client keys', () => {
    test('IPv6 addresses of one /64 share a burst window', () => {
        const { flood, send } = setup({ burst: true });
        assert.ok(flood((i) => `2001:db8:0:0:${i.toString(16)}::1`, BURST).every((o) => o.passed));
        assert.equal(send('2001:db8::ffff:1').status, 429);
        assert.equal(send('2001:db8:0:1::1').passed, true);
    });

    test('IPv6 addresses of one /64 share an hourly quota', () => {
        const { send, limits } = setup();
        send('2001:db8::1');
        assert.equal(send('2001:0DB8:0000:0000:abcd::2').headers['x-ratelimit-remaining'], String(HOURLY - 2));
        assert.deepEqual(Object.keys(limits), ['2001:db8:0:0::/64']);
    });

    test('an IPv4-mapped IPv6 address shares the quota of its IPv4 form', () => {
        const { flood, send, limits } = setup({ burst: true });
        assert.ok(flood(() => '::ffff:198.51.100.7', BURST).every((o) => o.passed));
        assert.equal(send('198.51.100.7').status, 429);
        assert.deepEqual(Object.keys(limits), ['198.51.100.7']);
    });

    test('the /64s of one /48 share a network quota of four plan quotas', () => {
        const { flood, send, at } = setup();
        const admitted = flood((i) => `2001:db8:0:${(i % 256).toString(16)}::1`, 4 * HOURLY + 100);
        assert.equal(admitted.filter((o) => o.passed).length, 4 * HOURLY);

        const refused = send('2001:db8:0:ff00::1');
        assert.equal(refused.status, 429);
        assert.equal(refused.headers['retry-after'], String(45 * 60));
        assert.deepEqual(refused.body, {
            message: 'Too Many Requests',
            error: 'Too many requests from your network.',
            status: 429,
        });
        assert.equal(send('2001:db8:1::1').passed, true);
        assert.equal(send('203.0.113.7').passed, true);

        at(Date.UTC(2026, 0, 1, 11, 0, 1));
        assert.equal(send('2001:db8:0:ff00::1').passed, true);
    });

    test('256 /64s of one /56 cannot spend the global budget of everybody else', () => {
        const { flood, send } = setup({ global: 5 * HOURLY });
        flood((i) => `2001:db8:0:${(i % 256).toString(16)}::1`, 6 * HOURLY);
        const outsider = send('203.0.113.7');
        assert.equal(outsider.passed, true);
        assert.equal(outsider.status, 200);
    });

    test('networkKey groups IPv6 addresses by /48 and leaves IPv4 alone', () => {
        assert.equal(networkKey('2001:db8:1:2::1'), '2001:db8:1::/48');
        assert.equal(networkKey('2001:db8:1:ffff:1::1'), '2001:db8:1::/48');
        assert.equal(networkKey('fe80::1%eth0'), 'fe80:0:0::/48');
        for (const ip of ['203.0.113.7', '::ffff:203.0.113.7', 'not an ip', '']) assert.equal(networkKey(ip), null, ip);
    });

    test('clientKey keeps IPv4 addresses as they are', () => {
        assert.equal(clientKey('203.0.113.7'), '203.0.113.7');
    });

    test('clientKey unwraps every spelling of an IPv4-mapped address', () => {
        for (const ip of ['::ffff:203.0.113.7', '::FFFF:cb00:7107', '0:0:0:0:0:ffff:203.0.113.7', '::ffff:CB00:7107']) {
            assert.equal(clientKey(ip), '203.0.113.7', ip);
        }
    });

    test('clientKey truncates IPv6 addresses to their /64', () => {
        assert.equal(clientKey('2001:db8::1'), '2001:db8:0:0::/64');
        assert.equal(clientKey('2001:0db8:0000:0000:ffff:0000:0000:0001'), '2001:db8:0:0::/64');
        assert.equal(clientKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
        assert.equal(clientKey('2001:db8:1:2::'), '2001:db8:1:2::/64');
        assert.equal(clientKey('2001:db8:1:2:3:4:1.2.3.4'), '2001:db8:1:2::/64');
        assert.equal(clientKey('::1'), '0:0:0:0::/64');
        assert.equal(clientKey('::'), '0:0:0:0::/64');
        assert.equal(clientKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
    });

    test('clientKey leaves anything that is not an IP address untouched', () => {
        for (const value of ['', 'constructor', '__proto__', '1.2.3.4:5678', 'not::an::ip', '::ffff:999.0.0.1']) {
            assert.equal(clientKey(value), value, value);
        }
    });
});

describe('rate limiter: sweep', () => {
    test('drops clients only seen in a past hour and keeps the current one', () => {
        const limits: IpLimits = { old: { '9': { '59': 3 } }, empty: {}, live: { '10': { '15': 1 } } };
        sweep(limits, new Map(), START);
        assert.deepEqual(Object.keys(limits), ['live']);
    });

    test('drops burst timestamps outside the window', () => {
        const bursts = new Map([
            ['stale', [START - RATE_LIMIT_WINDOW]],
            ['mixed', [START - RATE_LIMIT_WINDOW, START - 1]],
        ]);
        sweep(Object.create(null), bursts, START);
        assert.deepEqual([...bursts], [['mixed', [START - 1]]]);
    });

    test('drops network counters from a past hour', () => {
        const hour = Math.floor(START / 3600000);
        const networks = new Map([
            ['2001:db8:1::/48', { hour: hour - 1, count: 5 }],
            ['2001:db8:2::/48', { hour, count: 3 }],
        ]);
        sweep(Object.create(null), new Map(), START, networks);
        assert.deepEqual([...networks.keys()], ['2001:db8:2::/48']);
    });
});
