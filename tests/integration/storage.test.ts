import { strict as assert } from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import app from '../../src/app.js';

let server: Server;
let baseUrl: string;

before(() => {
    return new Promise<void>((resolve) => {
        server = app.listen(0, () => {
            baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            resolve();
        });
    });
});

after(() => {
    return new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
});

/**
 * Sends a request to the test server and parses its JSON answer.
 *
 * @param method - HTTP verb, GET or POST in these tests
 * @param path - Path from the server root, version included (e.g. `/v6/chat`)
 * @param body - JSON payload; when omitted, neither a body nor a Content-Type header is sent
 * @returns Status code and parsed JSON body of the response
 */
async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as unknown };
}

/**
 * Reads the public chat room through GET /v6/chat.
 *
 * @returns The stored public messages, empty when the room is empty
 */
async function publicMessages() {
    const { status, body } = await call('GET', '/v6/chat');
    return status === 200 ? (body as { username: string; message: string; timestamp: unknown }[]) : [];
}

describe('tic-tac-toe game IDs named after Object.prototype keys', () => {
    for (const game of ['constructor', '__proto__', 'hasOwnProperty']) {
        test(`v6 game "${game}" plays like any other game and keeps the list working`, async () => {
            const play = await call('POST', '/v6/tic-tac-toe/play', {
                username: 'proto-ann',
                move: '1-1',
                session: 'proto-ann-s',
                game,
            });
            assert.equal(play.status, 200);
            assert.deepEqual(play.body, { message: 'Move sent successfully' });

            const list = await call('POST', '/v6/tic-tac-toe/list', {});
            assert.equal(list.status, 200);
            const games = (list.body as { games: { id: string; moves: number }[] }).games;
            assert.deepEqual(
                games.filter((g) => g.id === game).map((g) => g.moves),
                [1],
            );

            const fetched = await call('POST', '/v6/tic-tac-toe/fetch', { username: 'proto-ann', game });
            assert.equal(fetched.status, 200);
            assert.equal((fetched.body as { id: string }).id, game);

            const forfeit = await call('POST', '/v6/tic-tac-toe/forfeit', {
                username: 'proto-ann',
                session: 'proto-ann-s',
                game,
            });
            assert.equal(forfeit.status, 200);
        });
    }

    test('v4 game "constructor" plays and the v4 list still answers', async () => {
        const play = await call('POST', '/v4/tic-tac-toe', {
            username: 'proto-bob',
            move: '2-2',
            session: 'proto-bob-s',
            game: 'constructor',
        });
        assert.equal(play.status, 200);
        assert.deepEqual(play.body, { message: 'Move sent successfully' });

        const list = await call('POST', '/v4/tic-tac-toe/list', {});
        assert.equal(list.status, 200);
        assert.ok((list.body as { games: { id: string }[] }).games.some((g) => g.id === 'constructor'));
    });

    test('an unknown "toString" game cannot be forfeited', async () => {
        const { status, body } = await call('POST', '/v6/tic-tac-toe/forfeit', {
            username: 'proto-ann',
            session: 'proto-ann-s',
            game: 'toString',
        });
        assert.equal(status, 400);
        assert.equal((body as { error: string }).error, 'Game not found');
    });
});

describe('chat tokens named after Object.prototype keys', () => {
    for (const version of ['v4', 'v5', 'v6']) {
        for (const token of ['constructor', 'hasOwnProperty', '__proto__']) {
            test(`${version} private chat "${token}" is unknown until someone writes to it`, async () => {
                const { status, body } = await call('POST', `/${version}/chat/private`, {
                    username: 'proto-reader',
                    token,
                });
                assert.equal(status, 400);
                assert.equal((body as { error: string }).error, 'Invalid or expired token.');
            });
        }
    }

    test('a "constructor" private chat works like any other token', async () => {
        const sent = await call('POST', '/v6/chat', {
            username: 'proto-cat',
            message: 'hidden',
            session: 'proto-cat-s',
            token: 'constructor',
        });
        assert.equal(sent.status, 200);

        const { status, body } = await call('POST', '/v6/chat/private', {
            username: 'proto-cat',
            token: 'constructor',
        });
        assert.equal(status, 200);
        assert.deepEqual(
            (body as { message: string }[]).map((m) => m.message),
            ['hidden'],
        );
    });

    test('a "__proto__" username keeps its own session', async () => {
        const first = await call('POST', '/v6/chat', { username: '__proto__', message: 'one', session: 'p1' });
        assert.equal(first.status, 200);
        const second = await call('POST', '/v6/chat', { username: '__proto__', message: 'two', session: 'p2' });
        assert.equal(second.status, 400);
        assert.equal((second.body as { error: string }).error, 'Session ID mismatch');
    });
});

describe('chat input bounds', () => {
    const cases: [string, Record<string, unknown>, string][] = [
        ['a 1001-char message', { message: 'm'.repeat(1001) }, 'Message cannot exceed 1000 characters'],
        ['a 101-char username', { username: 'u'.repeat(101) }, 'Username cannot exceed 100 characters'],
        ['a 257-char session', { session: 's'.repeat(257) }, 'Session ID cannot exceed 256 characters'],
        ['a 257-char token', { token: 't'.repeat(257) }, 'Token cannot exceed 256 characters'],
        ['an object message', { message: { text: 'hi' } }, 'Please provide a valid message'],
        ['an array username', { username: ['bounds'] }, 'Please provide a valid username'],
    ];

    for (const version of ['v4', 'v5', 'v6']) {
        for (const [label, override, expected] of cases) {
            test(`${version} rejects ${label} with a 400`, async () => {
                const { status, body } = await call('POST', `/${version}/chat`, {
                    username: `bounds-${version}`,
                    message: 'hello',
                    session: `bounds-${version}-s`,
                    ...override,
                });
                assert.equal(status, 400);
                assert.equal((body as { error: string }).error, expected);
            });
        }

        test(`${version} still accepts the longest allowed values`, async () => {
            const { status, body } = await call('POST', `/${version}/chat`, {
                username: `edge-${version}`.padEnd(100, 'x'),
                message: 'm'.repeat(1000),
                session: 's'.repeat(256),
                token: `edge-${version}`.padEnd(256, 't'),
            });
            assert.equal(status, 200);
            assert.deepEqual(body, { message: 'Message sent successfully' });
        });

        test(`${version} still accepts a numeric session, token and message`, async () => {
            const sent = await call('POST', `/${version}/chat`, {
                username: `num-${version}`,
                message: 42,
                session: 12345,
                token: version === 'v4' ? 7774 : version === 'v5' ? 7775 : 7776,
            });
            assert.equal(sent.status, 200);
            assert.deepEqual(sent.body, { message: 'Message sent successfully' });
        });
    }

    test('a numeric session and game ID still play on v4 and v6', async () => {
        const v4 = await call('POST', '/v4/tic-tac-toe', { username: 'num4', move: '1-1', session: 999, game: 4244 });
        const v6 = await call('POST', '/v6/tic-tac-toe/play', {
            username: 'num6',
            move: '1-1',
            session: 999,
            game: 4246,
        });
        for (const { status, body } of [v4, v6]) {
            assert.equal(status, 200);
            assert.deepEqual(body, { message: 'Move sent successfully' });
        }
    });

    test('a 257-char game ID is rejected on v4 and v6', async () => {
        const game = 'G'.repeat(257);
        const v4 = await call('POST', '/v4/tic-tac-toe', { username: 'gid', move: '1-1', session: 'gid-s', game });
        const v6 = await call('POST', '/v6/tic-tac-toe/play', { username: 'gid', move: '1-1', session: 'gid-s', game });
        for (const { status, body } of [v4, v6]) {
            assert.equal(status, 400);
            assert.equal((body as { error: string }).error, 'Game ID cannot exceed 256 characters');
        }
    });

    test('a client ISO timestamp is stored as sent', async () => {
        const timestamp = '2026-01-02T03:04:05.678Z';
        await call('POST', '/v6/chat', { username: 'ts-ok', message: 'ts-ok-msg', session: 'ts-ok-s', timestamp });
        const stored = (await publicMessages()).find((m) => m.message === 'ts-ok-msg');
        assert.deepEqual(stored, { username: 'ts-ok', message: 'ts-ok-msg', timestamp });
    });

    test('a free-form client timestamp such as 10:30 is stored as sent', async () => {
        await call('POST', '/v6/chat', {
            username: 'ts-free',
            message: 'ts-free-msg',
            session: 'ts-free-s',
            timestamp: '10:30',
        });
        const stored = (await publicMessages()).find((m) => m.message === 'ts-free-msg');
        assert.deepEqual(stored, { username: 'ts-free', message: 'ts-free-msg', timestamp: '10:30' });
    });

    test('an object or oversized timestamp is replaced by the server time', async () => {
        for (const [i, timestamp] of [{ evil: true }, '2026'.repeat(100)].entries()) {
            const message = `ts-bad-${i}`;
            const sent = await call('POST', '/v6/chat', {
                username: 'ts-bad',
                message,
                session: 'ts-bad-s',
                timestamp,
            });
            assert.equal(sent.status, 200);
            const stored = (await publicMessages()).find((m) => m.message === message);
            assert.equal(typeof stored?.timestamp, 'string');
            assert.ok(!Number.isNaN(Date.parse(stored!.timestamp as string)));
            assert.notEqual(stored!.timestamp, timestamp);
        }
    });
});

describe('public chat room size', () => {
    test('GET /chat returns at most the last 200 messages', async () => {
        for (let i = 0; i < 205; i++) {
            const { status } = await call('POST', '/v6/chat', {
                username: `flood-${i}`,
                message: `flood-${i}`,
                session: `flood-${i}-s`,
            });
            assert.equal(status, 200);
        }
        for (const version of ['v4', 'v5', 'v6']) {
            const { status, body } = await call('GET', `/${version}/chat`);
            assert.equal(status, 200);
            const messages = body as { message: string }[];
            assert.equal(messages.length, 200);
            assert.equal(messages[messages.length - 1]!.message, 'flood-204');
            assert.ok(!messages.some((m) => m.message === 'flood-4'));
        }
    });
});
