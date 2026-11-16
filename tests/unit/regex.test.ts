import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { REGEX_TIMEOUT } from '../../src/constants.js';
import regex, { type RegexResult } from '../../src/modules/v4/regex.js';

// The 25 ms watchdog can fire on a loaded machine, evaluate() retries only that error
const MAX_ATTEMPTS = 5;

/**
 * Runs the regex module and retries when the wall-clock watchdog fired on an evaluation that is not meant to time out.
 *
 * @param pattern - The regex pattern to test
 * @param text - The text to match against
 * @param flags - Optional regex flags, forwarded as is
 * @returns The result of the first attempt that was not interrupted by the watchdog
 * @throws Error if every attempt timed out, or on any other error, which is never retried
 */
function evaluate(pattern: string, text: string, flags?: string): RegexResult {
    for (let attempt = 1; ; attempt++) {
        try {
            return regex(pattern, text, flags);
        } catch (err) {
            if (attempt >= MAX_ATTEMPTS || !/took too long/.test((err as Error).message)) throw err;
        }
    }
}

describe('regex', () => {
    describe('basic matching', () => {
        test('finds a simple match', () => {
            const r = evaluate('hello', 'hello world');
            assert.equal(r.valid, true);
            assert.equal(r.count, 1);
            assert.equal(r.matches[0]!.match, 'hello');
            assert.equal(r.matches[0]!.index, 0);
        });

        test('finds multiple matches', () => {
            const r = evaluate('\\d+', 'abc 42 def 7');
            assert.equal(r.count, 2);
            assert.equal(r.matches[0]!.match, '42');
            assert.equal(r.matches[1]!.match, '7');
        });

        test('no match returns empty array', () => {
            const r = evaluate('xyz', 'hello world');
            assert.equal(r.valid, true);
            assert.equal(r.count, 0);
            assert.deepEqual(r.matches, []);
        });
    });

    describe('flags', () => {
        test('flag i enables case-insensitive matching', () => {
            const r = evaluate('hello', 'HELLO world', 'i');
            assert.equal(r.count, 1);
            assert.equal(r.matches[0]!.match, 'HELLO');
        });

        test('invalid flag x is silently ignored', () => {
            const r = evaluate('hello', 'hello world', 'x');
            assert.equal(r.valid, true);
            assert.equal(r.count, 1);
        });

        test('g flag is always present', () => {
            const r = evaluate('a', 'aaa', '');
            assert.ok(r.flags.includes('g'));
        });
    });

    describe('capture groups', () => {
        test('numbered groups are returned', () => {
            const r = evaluate('(\\d{4})-(\\d{2})', '2026-05');
            assert.deepEqual(r.matches[0]!.groups, ['2026', '05']);
        });

        test('named groups are returned', () => {
            const r = evaluate('(?<year>\\d{4})-(?<month>\\d{2})', '2026-05');
            assert.equal(r.matches[0]!.namedGroups.year, '2026');
            assert.equal(r.matches[0]!.namedGroups.month, '05');
        });

        test('no groups returns empty arrays', () => {
            const r = evaluate('hello', 'hello');
            assert.deepEqual(r.matches[0]!.groups, []);
            assert.deepEqual(r.matches[0]!.namedGroups, {});
        });
    });

    describe('invalid pattern', () => {
        test('invalid regex returns valid: false', () => {
            const r = evaluate('[invalid', 'hello');
            assert.equal(r.valid, false);
            assert.equal(r.count, 0);
            assert.deepEqual(r.matches, []);
        });
    });

    describe('result shape', () => {
        test('matches are plain objects of the caller realm', () => {
            const r = evaluate('(?<w>\\w)(\\d)', 'a1 b2');
            assert.equal(Object.getPrototypeOf(r.matches), Array.prototype);
            assert.equal(Object.getPrototypeOf(r.matches[0]), Object.prototype);
            assert.equal(Object.getPrototypeOf(r.matches[0]!.groups), Array.prototype);
            assert.equal(Object.getPrototypeOf(r.matches[0]!.namedGroups), Object.prototype);
            assert.deepEqual(r.matches, [
                { match: 'a1', index: 0, groups: ['a', '1'], namedGroups: { w: 'a' } },
                { match: 'b2', index: 3, groups: ['b', '2'], namedGroups: { w: 'b' } },
            ]);
        });

        test('an unmatched named group keeps its key', () => {
            const r = evaluate('(?<a>x)|(?<b>y)', 'y');
            assert.deepEqual(r.matches[0]!.namedGroups, { a: undefined, b: 'y' });
            assert.deepEqual(r.matches[0]!.groups, ['', 'y']);
        });

        test('a __proto__ group name stays an own key', () => {
            const r = evaluate('(?<__proto__>a)', 'a');
            assert.ok(Object.hasOwn(r.matches[0]!.namedGroups, '__proto__'));
            assert.equal(Object.getPrototypeOf(r.matches[0]!.namedGroups), Object.prototype);
        });

        test('zero-length matches still advance', () => {
            const r = evaluate('x*', 'abc');
            assert.equal(r.count, 4);
            assert.deepEqual(
                r.matches.map((m) => m.index),
                [0, 1, 2, 3],
            );
        });

        test('matches are capped at 100', () => {
            assert.equal(evaluate('.', 'a'.repeat(500)).count, 100);
        });
    });

    describe('catastrophic backtracking', () => {
        test('a nested quantifier is interrupted instead of blocking', () => {
            const start = Date.now();
            assert.throws(() => regex('(a+)+$', 'a'.repeat(32) + 'b'), {
                message: 'Pattern took too long to evaluate',
            });
            assert.ok(Date.now() - start < 1000);
        });

        test('an alternation blowup is interrupted too', () => {
            assert.throws(() => regex('^(a|a)*$', 'a'.repeat(40) + 'b', 'i'), /took too long/);
        });

        test('patterns still work after a timeout', () => {
            assert.throws(() => regex('(a+)+$', 'a'.repeat(32) + 'b'), /took too long/);
            const r = evaluate('\\d+', 'abc 42');
            assert.equal(r.count, 1);
            assert.equal(r.matches[0]!.match, '42');
        });

        test('a catastrophic pattern costs at most the 25 ms timeout', () => {
            assert.equal(REGEX_TIMEOUT, 25);
            const start = performance.now();
            assert.throws(() => regex('(a+)+$', 'a'.repeat(34) + 'b'), /took too long/);
            assert.ok(performance.now() - start < 250, `took ${performance.now() - start} ms`);
        });

        test('ordinary and Unicode property patterns on 1000 characters finish well within the timeout', () => {
            const text = 'Lorem ipsum dolor sit amet, caf\u00e9 123 '.repeat(30).slice(0, 1000);
            assert.equal(evaluate('[\\p{L}\\p{N}]+', text, 'gu').count, 100);
            assert.equal(evaluate('(\\w+\\s?)+', text).valid, true);
            assert.equal(evaluate('^.*$', text, 'ms').count, 1);
        });

        test('an invalid pattern is still reported as valid: false', () => {
            assert.deepEqual(evaluate('(?<n>a)(?<n>b)', 'ab'), {
                valid: false,
                pattern: '(?<n>a)(?<n>b)',
                flags: 'g',
                matches: [],
                count: 0,
            });
        });
    });

    describe('errors', () => {
        test('a pattern or text that is not a string, such as a repeated query key, throws', () => {
            const text = ['a'.repeat(700), 'b'.repeat(700)];
            assert.throws(() => regex(['(?=(.*))', ''] as never, 'abc'), /^Error: Please provide a pattern/);
            assert.throws(() => regex('(?=(.*))', text as never), /^Error: Please provide a text/);
            assert.throws(() => regex({ source: 'a' } as never, 'abc'), /^Error: Please provide a pattern/);
        });

        test('missing pattern throws', () => {
            assert.throws(() => regex('', 'hello'), /pattern/);
        });

        test('missing text throws', () => {
            assert.throws(() => regex('hello', ''), /text/);
        });

        test('pattern too long throws', () => {
            assert.throws(() => regex('a'.repeat(201), 'hello'), /200/);
        });

        test('text too long throws', () => {
            assert.throws(() => regex('hello', 'a'.repeat(1001)), /1000/);
        });
    });
});
