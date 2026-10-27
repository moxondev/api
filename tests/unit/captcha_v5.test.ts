import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import v4captcha from '../../src/modules/v4/captcha.js';
import { captcha } from '../../src/modules/v5.js';
import captchaChallenge, { verifyCaptcha } from '../../src/modules/v5/captcha.js';
import pow from '../../src/modules/v5/pow.js';
import type { ChallengeStorage } from '../../src/types/storage.js';
import { readToken, signToken } from '../../src/utils/challenge.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const store = (): ChallengeStorage => ({ usedNonces: new Map() });

/**
 * Reads the width of a PNG from its header.
 *
 * @param png - PNG file bytes
 * @returns Width in pixels, as stored in the IHDR chunk
 */
const pngWidth = (png: Buffer): number => png.readUInt32BE(16);

describe('captcha (v5 generator mode)', () => {
    test('v5 serves the very same renderer as v4', () => {
        assert.equal(captcha, v4captcha);
    });

    test('still returns a PNG with the provided text', () => {
        const result = captcha({ text: 'hello' });
        assert.equal(result.contentType, 'image/png');
        assert.ok(result.body.subarray(0, 4).equals(PNG_MAGIC));
        assert.equal(result.text, 'hello');
    });
});

describe('captcha challenge (v5)', () => {
    test('returns an image and a token, never the answer', () => {
        const challenge = captchaChallenge({ length: 6 });
        assert.equal(challenge.contentType, 'image/png');
        assert.ok(challenge.body.subarray(0, 4).equals(PNG_MAGIC));
        const decoded = JSON.parse(Buffer.from(challenge.token, 'base64url').toString('utf8')) as { type: string };
        assert.equal(decoded.type, 'img');
    });

    test('challenge images use the hardened renderer', () => {
        const challenge = captchaChallenge({ text: 'abcdef', width: 400, height: 120 });
        const plain = v4captcha({ text: 'abcdef', width: 400, height: 120 });
        assert.ok(!challenge.body.equals(plain.body));
    });

    test('keeps the v4 option bounds', () => {
        assert.throws(() => captchaChallenge({ length: 0 }), /length/);
        assert.throws(() => captchaChallenge({ length: 99 }), /length/);
        assert.throws(() => captchaChallenge({ text: 'AB', width: 10 }), /width/);
        assert.throws(() => captchaChallenge({ text: 'AB', height: 500 }), /height/);
        assert.throws(() => captchaChallenge({ text: 'AB', noise: 'extreme' as 'high' }), /Noise/);
    });

    test('accepts every noise level and a forced colour', () => {
        for (const noise of ['low', 'medium', 'high'] as const) {
            assert.ok(captchaChallenge({ text: 'test', noise }).body.length > 0);
        }
        assert.ok(captchaChallenge({ text: 'abc', color: '#ff0000' }).body.length > 0);
    });

    test('the answer is case-insensitive and trimmed', () => {
        const challenge = captchaChallenge({ text: 'AbCdEf' });
        assert.equal(verifyCaptcha(challenge.token, '  abcdef  ', store()).valid, true);
    });

    test('a wrong answer fails', () => {
        const challenge = captchaChallenge({ text: 'abcdef' });
        assert.equal(verifyCaptcha(challenge.token, 'zzzzzz', store()).reason, 'wrong');
    });

    test('a token is single use', () => {
        const storage = store();
        const challenge = captchaChallenge({ text: 'abcdef' });
        assert.equal(verifyCaptcha(challenge.token, 'abcdef', storage).valid, true);
        assert.equal(verifyCaptcha(challenge.token, 'abcdef', storage).reason, 'used');
    });

    test('a malformed token is invalid', () => {
        assert.equal(verifyCaptcha('garbage', 'abcdef', store()).reason, 'invalid');
    });

    test('a pow token cannot be passed off as a solved captcha', () => {
        // The pow payload is public, so accepting this token would skip both the captcha and the work
        const { token, salt, difficulty } = pow(6);
        const result = verifyCaptcha(token, `${salt}.${difficulty}`, store());
        assert.deepEqual(result, verifyCaptcha('garbage', 'abcdef', store()));
        assert.deepEqual(result, { valid: false, reason: 'invalid' });
    });

    test('a right answer after four typos still verifies', () => {
        const storage = store();
        const challenge = captchaChallenge({ text: 'abcdef' });
        for (let i = 0; i < 4; i++) {
            assert.deepEqual(verifyCaptcha(challenge.token, `typo${i}`, storage), { valid: false, reason: 'wrong' });
        }
        assert.deepEqual(verifyCaptcha(challenge.token, 'abcdef', storage), { valid: true });
    });

    test('five wrong answers burn the challenge', () => {
        const storage = store();
        const challenge = captchaChallenge({ text: 'abcdef' });
        for (let i = 0; i < 5; i++) {
            assert.deepEqual(verifyCaptcha(challenge.token, `guess${i}`, storage), { valid: false, reason: 'wrong' });
        }
        assert.deepEqual(verifyCaptcha(challenge.token, 'abcdef', storage), { valid: false, reason: 'used' });
    });

    test('a custom text is capped at 32 characters', () => {
        assert.ok(captchaChallenge({ text: 'a'.repeat(32) }).body.length > 0);
        assert.throws(() => captchaChallenge({ text: 'W'.repeat(33) }), /Text cannot exceed 32 characters/);
        assert.throws(() => captchaChallenge({ text: 'W'.repeat(540) }), /Text cannot exceed 32 characters/);
    });

    test('keeps 60 px per character as the default width, as before', () => {
        assert.equal(pngWidth(captchaChallenge({ length: 6 }).body), 360);
        assert.equal(pngWidth(captchaChallenge({ length: 20 }).body), 1200);
        assert.equal(pngWidth(captchaChallenge({ text: 'a'.repeat(32) }).body), 1920);
    });
});

describe('captcha challenge length (v5)', () => {
    test('the token carries the answer length in clear', () => {
        const { token } = captchaChallenge({ length: 9 });
        assert.equal((readToken(token) as { length?: number } | null)?.length, 9);
    });

    test('without minLength, any correct answer is valid as before', () => {
        const { token } = captchaChallenge({ text: 'A' });
        assert.deepEqual(verifyCaptcha(token, 'a', store()), { valid: true });
    });

    test('a correct answer to a captcha shorter than minLength is refused as weak', () => {
        const { token } = captchaChallenge({ length: 1 });
        const answer = 'abcdefghjklmnpqrstuvwxyz23456789'
            .split('')
            .find((c) => verifyCaptcha(token, c, store(), 6).reason === 'weak');
        assert.ok(answer, 'one of the symbols is the answer');
        const storage = store();
        assert.deepEqual(verifyCaptcha(token, answer, storage, 6), { valid: false, reason: 'weak' });
        assert.equal(verifyCaptcha(token, answer, storage).reason, 'used');
    });

    test('a wrong answer stays wrong whatever minLength asks', () => {
        const { token } = captchaChallenge({ text: 'abc' });
        assert.equal(verifyCaptcha(token, 'zzz', store(), 6).reason, 'wrong');
    });

    test('a captcha at least minLength long verifies', () => {
        const { token } = captchaChallenge({ text: 'Zx9Kfp' });
        assert.deepEqual(verifyCaptcha(token, 'zx9kfp', store(), 6), { valid: true });
    });

    test('raising the length in the token breaks its signature', () => {
        const { token } = captchaChallenge({ text: 'a' });
        const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Record<string, unknown>;
        const forged = Buffer.from(JSON.stringify({ ...decoded, length: 20 })).toString('base64url');
        assert.equal(verifyCaptcha(forged, 'a', store(), 6).reason, 'wrong');
    });

    test('a token signed without a length still verifies, but never passes a minLength', () => {
        const legacy = signToken('img', 'abcdef');
        assert.deepEqual(verifyCaptcha(legacy, 'ABCDEF', store()), { valid: true });
        assert.equal(verifyCaptcha(signToken('img', 'abcdef'), 'abcdef', store(), 1).reason, 'weak');
    });
});
