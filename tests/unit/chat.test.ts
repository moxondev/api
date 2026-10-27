import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import chat from '../../src/modules/v4/chat.js';
import chatV5 from '../../src/modules/v5/chat.js';
import type { ChatStorage } from '../../src/types/storage.js';

function makeStorage(): ChatStorage {
    return { messages: [], privateChats: {}, sessions: {}, rateLimits: {} };
}

describe('chat', () => {
    test('sends a public message', () => {
        const storage = makeStorage();
        const result = chat('message', { username: 'alice', message: 'hello', session: 'a1', storage });
        assert.ok((result as { message: string }).message.includes('sent'));
    });

    test('fetches public messages', () => {
        const storage = makeStorage();
        chat('message', { username: 'alice', message: 'test', session: 'a1', storage });
        const result = chat('fetch', { username: 'bob', storage });
        assert.ok(Array.isArray(result));
        assert.equal((result as { message: string }[])[0]!.message, 'test');
    });

    test('sends and retrieves private messages', () => {
        const storage = makeStorage();
        chat('message', { username: 'alice', message: 'secret', session: 'a1', token: 'tok1', storage });
        const result = chat('private', { username: 'bob', token: 'tok1', storage });
        assert.ok(Array.isArray(result));
    });

    test('clears a private chat', () => {
        const storage = makeStorage();
        chat('message', { username: 'alice', message: 'secret', session: 'a1', token: 'tok2', storage });
        const result = chat('clear', { username: 'alice', session: 'a1', token: 'tok2', storage });
        assert.ok((result as { message: string }).message.includes('cleared'));
    });

    test('throws on missing username', () => {
        assert.throws(
            () => chat('message', { username: '', message: 'hi', session: 's', storage: makeStorage() }),
            /username/,
        );
    });

    test('throws on invalid action', () => {
        assert.throws(() => chat('delete', { username: 'alice', storage: makeStorage() }), /Invalid action/);
    });

    test('throws on fetch with no messages', () => {
        assert.throws(() => chat('fetch', { username: 'alice', storage: makeStorage() }), /No messages/);
    });
});

describe('chat v5 (5.4.0 fixes)', () => {
    test('expired session is evicted so the username can start a new session', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const storage = makeStorage();
        chatV5('message', { username: 'eve', message: 'a', session: 's1', storage });
        t.mock.timers.tick(3_600_001);
        const result = chatV5('message', { username: 'eve', message: 'b', session: 's2', storage });
        assert.ok((result as { message: string }).message.includes('sent'));
    });

    test('old private message expiry does not wipe newer messages', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const storage = makeStorage();
        chatV5('message', { username: 'eve', message: 'm1', session: 's1', token: 'tok', storage });
        t.mock.timers.tick(3_599_000);
        chatV5('message', { username: 'eve', message: 'm2', session: 's1', token: 'tok', storage });
        t.mock.timers.tick(2_000);
        const msgs = chatV5('private', { username: 'eve', token: 'tok', storage }) as { message: string }[];
        assert.equal(msgs.length, 1);
        assert.equal(msgs[0]!.message, 'm2');
    });
});

describe('chat prototype keys (security)', () => {
    for (const [name, mod] of [
        ['v4', chat],
        ['v5', chatV5],
    ] as const) {
        test(`${name} private lookup ignores inherited keys on a plain object store`, () => {
            const storage = makeStorage();
            for (const token of ['constructor', 'hasOwnProperty', 'toString']) {
                assert.throws(() => mod('private', { username: 'eve', token, storage }), /Invalid or expired token/);
                assert.throws(
                    () => mod('clear', { username: 'eve', session: 's', token, storage }),
                    /Invalid or expired token/,
                );
            }
        });

        test(`${name} a "constructor" token is an ordinary private chat`, () => {
            const storage = makeStorage();
            mod('message', { username: 'eve', message: 'm1', session: 's', token: 'constructor', storage });
            const msgs = mod('private', { username: 'eve', token: 'constructor', storage }) as { message: string }[];
            assert.deepEqual(
                msgs.map((m) => m.message),
                ['m1'],
            );
        });

        test(`${name} a "__proto__" username does not touch Object.prototype`, () => {
            const storage = makeStorage();
            const result = mod('message', { username: '__proto__', message: 'hi', session: 's', storage });
            assert.deepEqual(result, { message: 'Message sent successfully' });
            assert.equal(Object.hasOwn(Object.prototype, 'last'), false);
            assert.equal(Object.hasOwn(Object.prototype, 'user'), false);
        });

        test(`${name} usernames named after prototype keys are rate limited like any other`, () => {
            const storage = makeStorage();
            for (const username of ['constructor', 'hasOwnProperty']) {
                for (let i = 0; i < 50; i++) mod('message', { username, message: 'x', session: 's', storage });
                assert.throws(
                    () => mod('message', { username, message: 'x', session: 's', storage }),
                    /Rate limit exceeded/,
                );
            }
        });
    }
});

describe('chat input bounds (security)', () => {
    for (const [name, mod] of [
        ['v4', chat],
        ['v5', chatV5],
    ] as const) {
        test(`${name} rejects oversized and object fields`, () => {
            const storage = makeStorage();
            const base = { username: 'eve', message: 'hi', session: 's', storage };
            const cases: [Record<string, unknown>, RegExp][] = [
                [{ message: 'm'.repeat(1001) }, /^Error: Message cannot exceed 1000 characters$/],
                [{ username: 'u'.repeat(101) }, /^Error: Username cannot exceed 100 characters$/],
                [{ session: 's'.repeat(257) }, /^Error: Session ID cannot exceed 256 characters$/],
                [{ token: 't'.repeat(257) }, /^Error: Token cannot exceed 256 characters$/],
                [{ message: { text: 'hi' } }, /^Error: Please provide a valid message$/],
                [{ username: ['eve'] }, /^Error: Please provide a valid username$/],
                [{ session: { id: 42 } }, /^Error: Please provide a valid session ID$/],
                [{ token: ['t'] }, /^Error: Please provide a valid token$/],
            ];
            for (const [override, expected] of cases) {
                assert.throws(() => mod('message', { ...base, ...override } as never), expected);
            }
            assert.equal(storage.messages.length, 0);
        });

        test(`${name} accepts the longest allowed values`, () => {
            const result = mod('message', {
                username: 'u'.repeat(100),
                message: 'm'.repeat(1000),
                session: 's'.repeat(256),
                token: 't'.repeat(256),
                storage: makeStorage(),
            });
            assert.deepEqual(result, { message: 'Message sent successfully' });
        });

        test(`${name} still accepts numeric session, token and message values`, () => {
            const storage = makeStorage();
            const params = { username: 'eve', message: 42, session: 12345, token: 777, storage } as never;
            assert.deepEqual(mod('message', params), { message: 'Message sent successfully' });
            const thread = mod('private', { username: 'eve', token: 777, storage } as never) as { message: unknown }[];
            assert.deepEqual(
                thread.map((m) => m.message),
                [42],
            );
        });

        test(`${name} fetch accepts a reader name keyed by a long IPv6 address`, () => {
            const storage = makeStorage();
            mod('message', { username: 'eve', message: 'hi', session: 's', storage });
            const reader = 'reader:ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255';
            assert.equal((mod('fetch', { username: reader, storage }) as unknown[]).length, 1);
        });

        test(`${name} stores client timestamps as sent and replaces only objects and oversized ones`, () => {
            const storage = makeStorage();
            const kept: unknown[] = [
                '2026-01-02T03:04:05.678Z',
                'Fri, 02 Jan 2026 03:04:05 GMT',
                1767323045678,
                '1767323045678',
                '10:30',
                'not a date',
            ];
            const replaced: unknown[] = [{ evil: true }, ['2026'], '2026'.repeat(40), Infinity];
            for (const timestamp of [...kept, ...replaced]) {
                mod('message', { username: 'eve', message: 'hi', session: 's', timestamp, storage } as never);
            }
            const stored = storage.messages.map((m) => m.timestamp as unknown);
            assert.deepEqual(stored.slice(0, kept.length), kept);
            for (const ts of stored.slice(kept.length)) {
                assert.match(ts as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            }
        });

        test(`${name} keeps only the last 200 messages of a private thread`, () => {
            const storage = makeStorage();
            for (let i = 0; i < 205; i++) {
                mod('message', { username: `user${i}`, message: `m${i}`, session: 's', token: 'room', storage });
            }
            const thread = mod('private', { username: 'reader', token: 'room', storage }) as { message: string }[];
            assert.equal(thread.length, 200);
            assert.equal(thread[0]!.message, 'm5');
            assert.equal(thread[199]!.message, 'm204');
        });

        test(`${name} refuses a new private chat once 1000 are active, and keeps the existing ones open`, () => {
            const storage = makeStorage();
            for (let i = 0; i < 1000; i++) {
                mod('message', { username: `user${i}`, message: 'hi', session: 's', token: `t${i}`, storage });
            }
            assert.throws(
                () => mod('message', { username: 'late', message: 'hi', session: 's', token: 'new', storage }),
                /^Error: Too many active private chats$/,
            );
            assert.equal(Object.hasOwn(storage.privateChats, 'new'), false);
            assert.equal(Object.hasOwn(storage.sessions, 'late'), false);
            const result = mod('message', { username: 'late', message: 'hi', session: 's', token: 't0', storage });
            assert.deepEqual(result, { message: 'Message sent successfully' });
        });

        test(`${name} keeps only the last 200 public messages`, () => {
            const storage = makeStorage();
            for (let i = 0; i < 205; i++) {
                mod('message', { username: `user${i}`, message: `m${i}`, session: 's', storage });
            }
            const msgs = mod('fetch', { username: 'reader', storage }) as { message: string }[];
            assert.equal(msgs.length, 200);
            assert.equal(msgs[0]!.message, 'm5');
            assert.equal(msgs[199]!.message, 'm204');
        });

        test(`${name} the expiry of an evicted message does not remove a newer one`, (t) => {
            t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
            const storage = makeStorage();
            mod('message', { username: 'first', message: 'm0', session: 's', storage });
            t.mock.timers.tick(1_000);
            for (let i = 1; i <= 200; i++) {
                mod('message', { username: `user${i}`, message: `m${i}`, session: 's', storage });
            }
            t.mock.timers.tick(3_599_500);
            const msgs = mod('fetch', { username: 'reader', storage }) as { message: string }[];
            assert.equal(msgs.length, 200);
            assert.equal(msgs[199]!.message, 'm200');
        });
    }
});
