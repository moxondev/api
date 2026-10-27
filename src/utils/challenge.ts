import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env.js';
import { CHALLENGE_MAX_ATTEMPTS, CHALLENGE_TTL } from '../constants.js';
import type { ChallengeStorage } from '../types/storage.js';

export interface ChallengeVerification {
    valid: boolean;
    reason?: 'wrong' | 'expired' | 'used' | 'invalid';
}

export interface TokenPayload {
    type: 'img' | 'pow';
    nonce: string;
    exp: number;
    salt?: string;
    difficulty?: number;
    sig: string;
}

const secret = env.CHALLENGE_SECRET || randomBytes(32).toString('hex');

// Every issued nonce is 16 random bytes in hex: anything else is forged
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

const sign = (type: string, nonce: string, exp: number, payload: string): string =>
    createHmac('sha256', secret).update(`${type}.${nonce}.${exp}.${payload}`).digest('hex');

/**
 * Decodes a token and checks the shape of its public fields, without verifying the signature.
 *
 * @param token - Base64url token as issued by signToken
 * @returns Decoded payload, or null when it is not JSON or lacks a well-formed nonce, expiry or signature
 */
function decode(token: string): TokenPayload | null {
    try {
        const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as TokenPayload;
        if (
            typeof parsed.nonce !== 'string' ||
            !NONCE_PATTERN.test(parsed.nonce) ||
            typeof parsed.exp !== 'number' ||
            typeof parsed.sig !== 'string'
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Forgets the consumed nonces and pending attempt counts whose token has expired.
 *
 * @param storage - Store of consumed nonces and pending attempt counts
 * @param now - Current timestamp in milliseconds
 */
function prune(storage: ChallengeStorage, now: number): void {
    for (const [nonce, exp] of storage.usedNonces) {
        if (exp <= now) storage.usedNonces.delete(nonce);
    }
    if (!storage.attempts) return;
    for (const [nonce, { exp }] of storage.attempts) {
        if (exp <= now) storage.attempts.delete(nonce);
    }
}

/**
 * Counts a wrong answer against a token and burns its nonce once the attempt
 * budget is spent, so a challenge cannot be guessed indefinitely.
 *
 * @param storage - Store of consumed nonces and pending attempt counts
 * @param nonce - Nonce of the token that received a wrong answer
 * @param exp - Expiry to keep the entries for, capped at one token lifetime
 */
function fail(storage: ChallengeStorage, nonce: string, exp: number): void {
    const attempts = (storage.attempts ??= new Map());
    const count = (attempts.get(nonce)?.count ?? 0) + 1;
    if (count < CHALLENGE_MAX_ATTEMPTS) {
        attempts.set(nonce, { count, exp });
        return;
    }
    attempts.delete(nonce);
    storage.usedNonces.set(nonce, exp);
}

/**
 * Signs a challenge into a stateless token. The expected answer never appears in
 * the token itself, only in the HMAC, so it cannot be read back by the client.
 *
 * @param type - Challenge kind: img for a captcha, pow for a proof-of-work
 * @param payload - Secret material bound to the token: the answer, or the salt and difficulty
 * @param extra - Public fields to carry along, such as salt and difficulty
 * @returns Base64url token carrying the nonce, expiry and signature
 */
export function signToken(type: 'img' | 'pow', payload: string, extra: Record<string, unknown> = {}): string {
    const nonce = randomBytes(16).toString('hex');
    const exp = Date.now() + CHALLENGE_TTL;
    const body = { type, nonce, exp, ...extra, sig: sign(type, nonce, exp, payload) };
    return Buffer.from(JSON.stringify(body)).toString('base64url');
}

/**
 * Verifies a token against the payload it was signed with, then consumes its
 * nonce so the same token cannot be replayed. A token of another kind is
 * rejected as invalid, and a token is burnt after too many wrong answers.
 *
 * @param token - Token issued by signToken
 * @param payload - Payload to check the signature against
 * @param storage - Store of already consumed nonces and pending attempt counts
 * @param type - Challenge kind the token must have been issued for
 * @returns Verification result, with a reason when it fails
 */
export function verifyToken(
    token: string,
    payload: string,
    storage: ChallengeStorage,
    type: TokenPayload['type'],
): ChallengeVerification {
    const decoded = decode(token);
    if (!decoded || decoded.type !== type) return { valid: false, reason: 'invalid' };

    const now = Date.now();
    prune(storage, now);

    if (decoded.exp <= now) return { valid: false, reason: 'expired' };
    if (storage.usedNonces.has(decoded.nonce)) return { valid: false, reason: 'used' };

    const expected = Buffer.from(sign(decoded.type, decoded.nonce, decoded.exp, payload), 'hex');
    const actual = Buffer.from(decoded.sig, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        // A forged token can claim any expiry, so its attempt counter never outlives a real token's lifetime
        fail(storage, decoded.nonce, Math.min(decoded.exp, now + CHALLENGE_TTL));
        return { valid: false, reason: 'wrong' };
    }

    storage.attempts?.delete(decoded.nonce);
    storage.usedNonces.set(decoded.nonce, decoded.exp);
    return { valid: true };
}

/**
 * Reads the public fields of a token without verifying its signature.
 *
 * @param token - Token issued by signToken
 * @returns Decoded payload, or null if the token is malformed
 */
export function readToken(token: string): TokenPayload | null {
    return decode(token);
}
