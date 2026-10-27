import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import tic_tac_toe from '../../src/modules/v4/tic_tac_toe.js';
import ticTacToeV5 from '../../src/modules/v5/tic_tac_toe.js';
import type { TicTacToeStorage } from '../../src/types/storage.js';

function makeStorage(): TicTacToeStorage {
    return { games: {}, sessions: {}, rateLimits: {} };
}

describe('tic_tac_toe', () => {
    test('list returns empty games array', () => {
        const result = tic_tac_toe('list', { storage: makeStorage() });
        assert.ok(Array.isArray(result.games));
    });

    test('play creates a game and makes a move', () => {
        const storage = makeStorage();
        const result = tic_tac_toe('play', { username: 'alice', move: '1-1', session: 'a1', game: 'TEST1', storage });
        assert.ok((result.message as string).includes('Move sent'));
    });

    test('fetch returns game state', () => {
        const storage = makeStorage();
        tic_tac_toe('play', { username: 'alice', move: '1-1', session: 'a1', game: 'TEST2', storage });
        const result = tic_tac_toe('fetch', { username: 'alice', game: 'TEST2', storage });
        assert.equal(result.id, 'TEST2');
    });

    test('forfeit throws on non-player', () => {
        const storage = makeStorage();
        tic_tac_toe('play', { username: 'alice', move: '1-1', session: 'a1', game: 'TEST3', storage });
        assert.throws(
            () => tic_tac_toe('forfeit', { username: 'charlie', session: 'c1', game: 'TEST3', storage }),
            /not a player/,
        );
    });

    test('throws on missing username', () => {
        assert.throws(
            () => tic_tac_toe('play', { move: '1-1', session: 's', game: 'G', storage: makeStorage() }),
            /username/,
        );
    });

    test('throws on missing move', () => {
        assert.throws(
            () => tic_tac_toe('play', { username: 'alice', session: 's', game: 'G', storage: makeStorage() }),
            /move/i,
        );
    });

    test('throws on invalid action', () => {
        assert.throws(() => tic_tac_toe('reset', { username: 'alice', storage: makeStorage() }), /Invalid action/);
    });
});

describe('tic_tac_toe v5 (5.4.0 fixes)', () => {
    test('a player can forfeit without fetching first', () => {
        const storage = makeStorage();
        ticTacToeV5('play', { username: 'zoe', move: '1-1', session: 'z1', game: 'G1', storage });
        const result = ticTacToeV5('forfeit', { username: 'zoe', session: 'z1', game: 'G1', storage });
        assert.ok((result as { message: string }).message.includes('forfeited'));
    });

    test('username casing cannot be used to play both sides', () => {
        const storage = makeStorage();
        ticTacToeV5('play', { username: 'Alice', move: '1-1', session: 'a1', game: 'G2', storage });
        assert.throws(
            () => ticTacToeV5('play', { username: 'ALICE', move: '2-2', session: 'a1', game: 'G2', storage }),
            /wait for the other player/,
        );
    });

    test('an active game is not deleted by the idle cleanup timer', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const storage = makeStorage();
        ticTacToeV5('play', { username: 'ann', move: '1-1', session: 'a1', game: 'G3', storage });
        t.mock.timers.tick(3_599_000);
        ticTacToeV5('play', { username: 'ben', move: '2-2', session: 'b1', game: 'G3', storage });
        t.mock.timers.tick(2_000);
        assert.ok(storage.games['G3']);
    });

    test('an idle game is deleted after the TTL', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const storage = makeStorage();
        ticTacToeV5('play', { username: 'ann', move: '1-1', session: 'a1', game: 'G4', storage });
        t.mock.timers.tick(3_600_001);
        assert.equal(storage.games['G4'], undefined);
    });
});

describe('tic_tac_toe prototype keys (security)', () => {
    for (const [name, mod] of [
        ['v4', tic_tac_toe],
        ['v5', ticTacToeV5],
    ] as const) {
        test(`${name} a "constructor" game no longer breaks the game list`, () => {
            const storage = makeStorage();
            const play = mod('play', { username: 'ann', move: '1-1', session: 'a1', game: 'constructor', storage });
            assert.deepEqual(play, { message: 'Move sent successfully' });
            const list = mod('list', { storage });
            assert.equal(list.count, 1);
            assert.equal((list.games as { id: string }[])[0]!.id, 'constructor');
        });

        test(`${name} fetch of a "hasOwnProperty" game creates a fresh game`, () => {
            const result = mod('fetch', { username: 'ann', game: 'hasOwnProperty', storage: makeStorage() });
            assert.equal(result.id, 'hasOwnProperty');
            assert.deepEqual(result.moves, []);
            assert.deepEqual(result.players, ['ann']);
        });

        test(`${name} an inherited key is not a game to forfeit`, () => {
            assert.throws(
                () => mod('forfeit', { username: 'ann', session: 'a1', game: 'toString', storage: makeStorage() }),
                /^Error: Game not found$/,
            );
        });

        test(`${name} players named after prototype keys get their own symbols`, () => {
            const storage = makeStorage();
            const players = ['constructor', '__proto__'];
            let result: Record<string, unknown> = {};
            ['1-1', '2-1', '1-2', '2-2', '1-3'].forEach((move, i) => {
                const username = players[i % 2]!;
                result = mod('play', { username, move, session: username, game: 'G', storage });
            });
            assert.equal(result.winner, 'constructor');
            assert.equal(result.loser, '__proto__');
            assert.equal(Object.hasOwn(Object.prototype, 'last'), false);
        });

        test(`${name} a "constructor" username gets its own rate limit history`, () => {
            const storage = makeStorage();
            assert.doesNotThrow(() => mod('fetch', { username: 'constructor', game: 'G', storage }));
            assert.deepEqual(Object.keys(storage.rateLimits), ['constructor']);
            assert.equal(storage.rateLimits['constructor']!.length, 1);
        });
    }
});

describe('tic_tac_toe input bounds (security)', () => {
    for (const [name, mod] of [
        ['v4', tic_tac_toe],
        ['v5', ticTacToeV5],
    ] as const) {
        test(`${name} rejects oversized and object identifiers`, () => {
            const storage = makeStorage();
            const base = { username: 'ann', move: '1-1', session: 'a1', game: 'G', storage };
            const cases: [Record<string, unknown>, RegExp][] = [
                [{ game: 'G'.repeat(257) }, /^Error: Game ID cannot exceed 256 characters$/],
                [{ session: 's'.repeat(257) }, /^Error: Session ID cannot exceed 256 characters$/],
                [{ username: 'u'.repeat(101) }, /^Error: Username cannot exceed 100 characters$/],
                [{ game: { id: 'G' } }, /^Error: Please provide a valid game ID$/],
                [{ username: ['ann'] }, /^Error: Please provide a valid username$/],
            ];
            for (const [override, expected] of cases) {
                assert.throws(() => mod('play', { ...base, ...override } as never), expected);
            }
            assert.deepEqual(Object.keys(storage.games), []);
        });

        test(`${name} accepts the longest allowed identifiers`, () => {
            const result = mod('play', {
                username: 'u'.repeat(100),
                move: '1-1',
                session: 's'.repeat(256),
                game: 'G'.repeat(256),
                storage: makeStorage(),
            });
            assert.deepEqual(result, { message: 'Move sent successfully' });
        });

        test(`${name} still accepts numeric session and game IDs`, () => {
            const storage = makeStorage();
            const params = { username: 'ann', move: '1-1', session: 999, game: 4242, storage } as never;
            assert.deepEqual(mod('play', params), { message: 'Move sent successfully' });
            const state = mod('fetch', { username: 'ann', game: 4242, storage } as never);
            assert.equal(state.id, 4242);
            assert.equal((state.moves as unknown[]).length, 1);
        });
    }
});
