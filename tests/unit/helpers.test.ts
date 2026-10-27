import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { checkRateLimit, checkString, isTimestamp } from '../../src/utils/helpers.js';

describe('checkRateLimit (5.4.0 fixes)', () => {
    test('allows exactly the limit, rejects the next request', () => {
        const limits: Record<string, number[]> = {};
        for (let i = 0; i < 50; i++) {
            assert.doesNotThrow(() => checkRateLimit(limits, 'user', 1000 + i));
        }
        assert.throws(() => checkRateLimit(limits, 'user', 1100), /Rate limit exceeded/);
    });

    test('evicts users whose requests are all outside the window', () => {
        const limits: Record<string, number[]> = {};
        checkRateLimit(limits, 'old-user', 1000);
        checkRateLimit(limits, 'fresh-user', 20_000);
        assert.equal(limits['old-user'], undefined);
        assert.ok(limits['fresh-user']);
    });
});

describe('checkRateLimit prototype keys (security)', () => {
    test('a "constructor" user starts with an empty history on a plain object store', () => {
        const limits: Record<string, number[]> = {};
        assert.equal(checkRateLimit(limits, 'constructor', 1000), false);
        assert.deepEqual(limits['constructor'], [1000]);
    });

    test('a "hasOwnProperty" user is limited like any other', () => {
        const limits: Record<string, number[]> = {};
        for (let i = 0; i < 50; i++) checkRateLimit(limits, 'hasOwnProperty', 1000 + i);
        assert.throws(() => checkRateLimit(limits, 'hasOwnProperty', 1100), /Rate limit exceeded/);
    });
});

describe('checkString', () => {
    test('skips empty values so the caller reports them', () => {
        for (const value of [undefined, null, '', 0, false]) {
            assert.doesNotThrow(() => checkString(value, 'token', 4));
        }
    });

    test('accepts a string up to the limit', () => {
        assert.doesNotThrow(() => checkString('abcd', 'token', 4));
    });

    test('rejects a longer string with a capitalized field name', () => {
        assert.throws(() => checkString('abcde', 'session ID', 4), /^Error: Session ID cannot exceed 4 characters$/);
    });

    test('rejects objects, arrays and functions', () => {
        for (const value of [['a'], { a: 1 }, () => 1]) {
            assert.throws(() => checkString(value, 'game ID', 64), /^Error: Please provide a valid game ID$/);
        }
    });

    test('accepts numbers and booleans, as JSON clients sent them before', () => {
        for (const value of [42, 1767323045678, true]) {
            assert.doesNotThrow(() => checkString(value, 'session ID', 64), String(value));
        }
    });

    test('measures numbers as text', () => {
        assert.throws(() => checkString(123456, 'game ID', 5), /^Error: Game ID cannot exceed 5 characters$/);
    });
});

describe('isTimestamp', () => {
    test('accepts finite numbers, booleans and any short string, stored as the client sent them', () => {
        for (const value of [0, 1767323045678, true, '1767323045678', '2026-01-02T03:04:05.678Z', '10:30', 'hier']) {
            assert.equal(isTimestamp(value), true, String(value));
        }
    });

    test('accepts a localized Date.toString() output', () => {
        assert.equal(
            isTimestamp('Sat Oct 24 2026 13:37:00 GMT+0200 (heure d\u2019\u00e9t\u00e9 d\u2019Europe centrale)'),
            true,
        );
    });

    test('rejects objects, arrays, non-finite numbers and strings over 128 characters', () => {
        for (const value of [NaN, Infinity, {}, ['2026'], null, undefined, 'x'.repeat(129)]) {
            assert.equal(isTimestamp(value), false, String(value));
        }
        assert.equal(isTimestamp('x'.repeat(128)), true);
    });
});
