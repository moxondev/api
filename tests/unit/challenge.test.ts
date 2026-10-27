import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { CHALLENGE_TTL } from '../../src/constants.js';
import type { ChallengeStorage } from '../../src/types/storage.js';
import { readToken, signToken, verifyToken } from '../../src/utils/challenge.js';

/**
 * Builds an empty challenge store with an attempt counter.
 *
 * @returns Store holding no consumed nonce and no pending attempt
 */
const store = (): ChallengeStorage => ({ usedNonces: new Map(), attempts: new Map() });

const decode = (token: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Record<string, unknown>;

/**
 * Encodes token fields the way signToken does, without signing them.
 *
 * @param body - Token fields, possibly forged
 * @returns Base64url token text
 */
const encode = (body: Record<string, unknown>): string => Buffer.from(JSON.stringify(body)).toString('base64url');

describe('challenge tokens', () => {
    test('token carries type, nonce, expiry and signature', () => {
        const body = decode(signToken('img', 'secret'));
        assert.equal(body.type, 'img');
        assert.match(body.nonce as string, /^[0-9a-f]{32}$/);
        assert.ok((body.exp as number) > Date.now());
        assert.match(body.sig as string, /^[0-9a-f]{64}$/);
    });

    test('payload never appears in the token', () => {
        const token = signToken('img', 'a1b2c3');
        assert.ok(!Buffer.from(token, 'base64url').toString('utf8').includes('a1b2c3'));
    });

    test('extra fields are carried along', () => {
        const body = decode(signToken('pow', 'salt.4', { salt: 'salt', difficulty: 4 }));
        assert.equal(body.salt, 'salt');
        assert.equal(body.difficulty, 4);
    });

    test('matching payload verifies', () => {
        assert.deepEqual(verifyToken(signToken('img', 'abc'), 'abc', store(), 'img'), { valid: true });
    });

    test('wrong payload fails', () => {
        const result = verifyToken(signToken('img', 'abc'), 'xyz', store(), 'img');
        assert.equal(result.valid, false);
        assert.equal(result.reason, 'wrong');
    });

    test('replaying a consumed token fails', () => {
        const storage = store();
        const token = signToken('img', 'abc');
        assert.equal(verifyToken(token, 'abc', storage, 'img').valid, true);
        assert.equal(verifyToken(token, 'abc', storage, 'img').reason, 'used');
    });

    test('a failed attempt does not consume the token', () => {
        const storage = store();
        const token = signToken('img', 'abc');
        assert.equal(verifyToken(token, 'nope', storage, 'img').reason, 'wrong');
        assert.equal(verifyToken(token, 'abc', storage, 'img').valid, true);
    });

    test('expired token fails', () => {
        const body = decode(signToken('img', 'abc'));
        body.exp = Date.now() - 1;
        const expired = Buffer.from(JSON.stringify(body)).toString('base64url');
        assert.equal(verifyToken(expired, 'abc', store(), 'img').reason, 'expired');
    });

    test('expired nonces are pruned from the store', () => {
        const storage = store();
        storage.usedNonces.set('stale', Date.now() - 1000);
        verifyToken(signToken('img', 'abc'), 'abc', storage, 'img');
        assert.equal(storage.usedNonces.has('stale'), false);
    });

    test('tampered signature fails', () => {
        const body = decode(signToken('img', 'abc'));
        body.sig = 'f'.repeat(64);
        const tampered = Buffer.from(JSON.stringify(body)).toString('base64url');
        assert.equal(verifyToken(tampered, 'abc', store(), 'img').reason, 'wrong');
    });

    test('malformed token is invalid', () => {
        assert.equal(verifyToken('not-a-token', 'abc', store(), 'img').reason, 'invalid');
        assert.equal(verifyToken(Buffer.from('{}').toString('base64url'), 'abc', store(), 'img').reason, 'invalid');
    });

    test('a token of another kind is invalid', () => {
        const pow = signToken('pow', 'salt.4', { salt: 'salt', difficulty: 4 });
        assert.deepEqual(verifyToken(pow, 'salt.4', store(), 'img'), { valid: false, reason: 'invalid' });
        const img = signToken('img', 'abc');
        assert.deepEqual(verifyToken(img, 'abc', store(), 'pow'), { valid: false, reason: 'invalid' });
    });

    test('a rejected cross-kind token stays usable for its own kind', () => {
        const storage = store();
        const pow = signToken('pow', 'salt.4', { salt: 'salt', difficulty: 4 });
        verifyToken(pow, 'salt.4', storage, 'img');
        assert.deepEqual(verifyToken(pow, 'salt.4', storage, 'pow'), { valid: true });
    });

    test('a forged nonce is invalid', () => {
        const body = decode(signToken('img', 'abc'));
        body.nonce = 'x'.repeat(5000);
        assert.deepEqual(verifyToken(encode(body), 'abc', store(), 'img'), { valid: false, reason: 'invalid' });
    });

    test('four wrong answers still leave the right one valid', () => {
        const storage = store();
        const token = signToken('img', 'abc');
        for (let i = 0; i < 4; i++) {
            assert.deepEqual(verifyToken(token, `typo${i}`, storage, 'img'), { valid: false, reason: 'wrong' });
        }
        assert.deepEqual(verifyToken(token, 'abc', storage, 'img'), { valid: true });
        assert.equal(storage.attempts?.size, 0);
    });

    test('the fifth wrong answer burns the token', () => {
        const storage = store();
        const token = signToken('img', 'abc');
        for (let i = 0; i < 5; i++) {
            assert.deepEqual(verifyToken(token, `guess${i}`, storage, 'img'), { valid: false, reason: 'wrong' });
        }
        assert.equal(verifyToken(token, 'abc', storage, 'img').reason, 'used');
        assert.equal(storage.usedNonces.has(decode(token).nonce as string), true);
        assert.equal(storage.attempts?.size, 0);
    });

    test('attempts are counted per token', () => {
        const storage = store();
        const first = signToken('img', 'abc');
        const second = signToken('img', 'abc');
        for (let i = 0; i < 5; i++) verifyToken(first, 'nope', storage, 'img');
        assert.equal(verifyToken(second, 'abc', storage, 'img').valid, true);
    });

    test('a store without an attempts map gets one', () => {
        const storage: ChallengeStorage = { usedNonces: new Map() };
        const token = signToken('img', 'abc');
        for (let i = 0; i < 5; i++) verifyToken(token, 'nope', storage, 'img');
        assert.equal(verifyToken(token, 'abc', storage, 'img').reason, 'used');
    });

    test('a forged far expiry is capped to one token lifetime', () => {
        const storage = store();
        const body = decode(signToken('img', 'abc'));
        body.exp = Date.now() + 10 * 365 * 24 * 3_600_000;
        const before = Date.now();
        for (let i = 0; i < 5; i++) verifyToken(encode(body), 'abc', storage, 'img');
        const exp = storage.usedNonces.get(body.nonce as string)!;
        assert.ok(exp <= Date.now() + CHALLENGE_TTL);
        assert.ok(exp >= before);
    });

    test('expired attempt counts are pruned from the store', () => {
        const storage = store();
        storage.attempts!.set('stale', { count: 3, exp: Date.now() - 1000 });
        verifyToken(signToken('img', 'abc'), 'abc', storage, 'img');
        assert.equal(storage.attempts!.has('stale'), false);
    });

    test('readToken exposes public fields without verifying', () => {
        const token = signToken('pow', 'salt.4', { salt: 'salt', difficulty: 4 });
        assert.equal(readToken(token)?.salt, 'salt');
        assert.equal(readToken('garbage'), null);
    });
});
