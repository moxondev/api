import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MAX_CONCURRENT_KEYGENS } from '../../src/constants.js';
import asymmetric, { asymmetricAsync } from '../../src/modules/v5/asymmetric.js';

// Generate a key pair once to reuse across tests
const { publicKey: testPublicKey, privateKey: testPrivateKey } = asymmetric('keygen', {}) as {
    publicKey: string;
    privateKey: string;
};

describe('asymmetric - keygen', () => {
    test('returns publicKey and privateKey PEM with default 2048 bits', () => {
        const result = asymmetric('keygen', {}) as {
            action: string;
            algorithm: string;
            modulusLength: number;
            publicKey: string;
            privateKey: string;
        };
        assert.equal(result.action, 'keygen');
        assert.equal(result.algorithm, 'rsa-oaep-sha256');
        assert.equal(result.modulusLength, 2048);
        assert.ok(result.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'));
        assert.ok(result.privateKey.startsWith('-----BEGIN PRIVATE KEY-----'));
    });

    test('default algorithm is rsa-oaep-sha256', () => {
        const result = asymmetric('keygen', {}) as { algorithm: string };
        assert.equal(result.algorithm, 'rsa-oaep-sha256');
    });

    test('keygen with rsa-oaep-sha1', () => {
        const result = asymmetric('keygen', { algorithm: 'rsa-oaep-sha1' }) as { algorithm: string };
        assert.equal(result.algorithm, 'rsa-oaep-sha1');
    });

    test('two keygen calls produce different keys', () => {
        const a = asymmetric('keygen', {}) as { publicKey: string };
        const b = asymmetric('keygen', {}) as { publicKey: string };
        assert.notEqual(a.publicKey, b.publicKey);
    });
});

describe('asymmetric - encrypt/decrypt', () => {
    test('encrypt then decrypt returns original text', () => {
        const enc = asymmetric('encrypt', { text: 'hello RSA', publicKey: testPublicKey }) as { result: string };
        const dec = asymmetric('decrypt', { text: enc.result, privateKey: testPrivateKey }) as { result: string };
        assert.equal(dec.result, 'hello RSA');
    });

    test('two encrypts of same text produce different results (OAEP padding)', () => {
        const a = asymmetric('encrypt', { text: 'same text', publicKey: testPublicKey }) as { result: string };
        const b = asymmetric('encrypt', { text: 'same text', publicKey: testPublicKey }) as { result: string };
        assert.notEqual(a.result, b.result);
    });

    test('encrypt result is base64 string', () => {
        const enc = asymmetric('encrypt', { text: 'hello', publicKey: testPublicKey }) as { result: string };
        assert.match(enc.result, /^[A-Za-z0-9+/]+=*$/);
    });

    test('encrypt result has correct action and algorithm fields', () => {
        const result = asymmetric('encrypt', { text: 'test', publicKey: testPublicKey }) as {
            action: string;
            algorithm: string;
        };
        assert.equal(result.action, 'encrypt');
        assert.equal(result.algorithm, 'rsa-oaep-sha256');
    });

    test('decrypt result has correct action and algorithm fields', () => {
        const enc = asymmetric('encrypt', { text: 'test', publicKey: testPublicKey }) as { result: string };
        const result = asymmetric('decrypt', { text: enc.result, privateKey: testPrivateKey }) as {
            action: string;
            algorithm: string;
        };
        assert.equal(result.action, 'decrypt');
        assert.equal(result.algorithm, 'rsa-oaep-sha256');
    });

    test('round-trip with rsa-oaep-sha1', () => {
        const { publicKey, privateKey } = asymmetric('keygen', { algorithm: 'rsa-oaep-sha1' }) as {
            publicKey: string;
            privateKey: string;
        };
        const enc = asymmetric('encrypt', { text: 'sha1 test', publicKey, algorithm: 'rsa-oaep-sha1' }) as {
            result: string;
        };
        const dec = asymmetric('decrypt', { text: enc.result, privateKey, algorithm: 'rsa-oaep-sha1' }) as {
            result: string;
        };
        assert.equal(dec.result, 'sha1 test');
    });

    test('decrypt with wrong private key throws', () => {
        const { privateKey: wrongKey } = asymmetric('keygen', {}) as { privateKey: string };
        const enc = asymmetric('encrypt', { text: 'secret', publicKey: testPublicKey }) as { result: string };
        assert.throws(() => asymmetric('decrypt', { text: enc.result, privateKey: wrongKey }), /Invalid key/);
    });
});

describe('asymmetric - validation', () => {
    test('invalid action throws', () => {
        assert.throws(() => asymmetric('hash', {}), /Action must be/);
    });

    test('empty action throws', () => {
        assert.throws(() => asymmetric('', {}), /Action must be/);
    });

    test('unsupported algorithm throws', () => {
        assert.throws(() => asymmetric('keygen', { algorithm: 'rsa-pkcs1v15' }), /Unsupported algorithm/);
    });

    test('invalid modulusLength throws', () => {
        assert.throws(() => asymmetric('keygen', { modulusLength: 1024 }), /Modulus length/);
    });

    test('encrypt without publicKey throws', () => {
        assert.throws(() => asymmetric('encrypt', { text: 'hello' }), /Public key is required/);
    });

    test('encrypt with invalid publicKey format throws', () => {
        assert.throws(() => asymmetric('encrypt', { text: 'hello', publicKey: 'not-a-key' }), /Invalid public key/);
    });

    test('encrypt without text throws', () => {
        assert.throws(() => asymmetric('encrypt', { publicKey: testPublicKey }), /Text is required/);
    });

    test('decrypt without privateKey throws', () => {
        assert.throws(() => asymmetric('decrypt', { text: 'abc' }), /Private key is required/);
    });

    test('decrypt with invalid privateKey format throws', () => {
        assert.throws(() => asymmetric('decrypt', { text: 'abc', privateKey: 'not-a-key' }), /Invalid private key/);
    });

    test('decrypt without text throws', () => {
        assert.throws(() => asymmetric('decrypt', { privateKey: testPrivateKey }), /Encrypted data is required/);
    });

    test('text too long for key size throws', () => {
        // RSA-2048 OAEP-SHA256 max = 190 bytes
        const longText = 'a'.repeat(191);
        assert.throws(() => asymmetric('encrypt', { text: longText, publicKey: testPublicKey }), /exceeds maximum/);
    });
});

describe('asymmetric (5.4.0 fixes)', () => {
    test('4096-bit key accepts payloads beyond the 2048-bit limit', () => {
        const kg = asymmetric('keygen', { modulusLength: 4096 }) as { publicKey: string; privateKey: string };
        const enc = asymmetric('encrypt', { text: 'x'.repeat(200), publicKey: kg.publicKey }) as { result: string };
        const dec = asymmetric('decrypt', { text: enc.result, privateKey: kg.privateKey }) as { result: string };
        assert.equal(dec.result, 'x'.repeat(200));
    });
});

describe('asymmetricAsync', () => {
    test('keygen returns the same fields, in the same order, as the sync variant', async () => {
        const sync = asymmetric('keygen', {});
        const result = await asymmetricAsync('keygen', {});
        assert.deepEqual(Object.keys(result), Object.keys(sync));
        assert.deepEqual(Object.keys(result), ['action', 'algorithm', 'modulusLength', 'publicKey', 'privateKey']);
        const kg = result as { action: string; algorithm: string; modulusLength: number; publicKey: string };
        assert.equal(kg.action, 'keygen');
        assert.equal(kg.algorithm, 'rsa-oaep-sha256');
        assert.equal(kg.modulusLength, 2048);
        assert.ok(kg.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'));
        assert.ok((result as { privateKey: string }).privateKey.startsWith('-----BEGIN PRIVATE KEY-----'));
    });

    test('keygen keeps the requested algorithm and modulus length', async () => {
        const result = (await asymmetricAsync('keygen', { algorithm: 'rsa-oaep-sha1', modulusLength: 4096 })) as {
            algorithm: string;
            modulusLength: number;
            publicKey: string;
            privateKey: string;
        };
        assert.equal(result.algorithm, 'rsa-oaep-sha1');
        assert.equal(result.modulusLength, 4096);
        const enc = asymmetric('encrypt', { text: 'x'.repeat(200), publicKey: result.publicKey }) as {
            result: string;
        };
        const dec = asymmetric('decrypt', { text: enc.result, privateKey: result.privateKey }) as { result: string };
        assert.equal(dec.result, 'x'.repeat(200));
    });

    test('generated keys interoperate with the sync encrypt and decrypt', async () => {
        const kg = (await asymmetricAsync('keygen', {})) as { publicKey: string; privateKey: string };
        const enc = (await asymmetricAsync('encrypt', { text: 'hello RSA', publicKey: kg.publicKey })) as {
            result: string;
        };
        const dec = asymmetric('decrypt', { text: enc.result, privateKey: kg.privateKey }) as { result: string };
        assert.equal(dec.result, 'hello RSA');
    });

    test('encrypt and decrypt return exactly what the sync variant returns', async () => {
        const enc = (await asymmetricAsync('encrypt', { text: 'same', publicKey: testPublicKey })) as {
            result: string;
        };
        const options = { text: enc.result, privateKey: testPrivateKey };
        assert.deepEqual(await asymmetricAsync('decrypt', options), asymmetric('decrypt', options));
    });

    test('rejects with the same messages as the sync variant', async () => {
        const cases: [string, Record<string, unknown>][] = [
            ['hash', {}],
            ['', {}],
            ['keygen', { algorithm: 'rsa-pkcs1v15' }],
            ['keygen', { modulusLength: 1024 }],
            ['keygen', { modulusLength: 8192 }],
            ['keygen', { modulusLength: Number.NaN }],
            ['encrypt', { text: 'hello' }],
            ['encrypt', { text: 'hello', publicKey: 'not-a-key' }],
            ['decrypt', { text: 'abc' }],
            ['decrypt', { text: 'abc', privateKey: 'not-a-key' }],
        ];
        for (const [action, options] of cases) {
            let expected = '';
            try {
                asymmetric(action, options);
            } catch (err) {
                expected = (err as Error).message;
            }
            assert.ok(expected, `sync variant should throw for ${action} ${JSON.stringify(options)}`);
            await assert.rejects(asymmetricAsync(action, options), { message: expected });
        }
    });

    test('keygen leaves the event loop free while the key pair is generated', async () => {
        let ticks = 0;
        let done = false;
        const pending = asymmetricAsync('keygen', {}).then(() => {
            done = true;
        });
        const tick = (): void => {
            if (done) return;
            ticks++;
            setImmediate(tick);
        };
        setImmediate(tick);
        await pending;
        assert.ok(ticks > 0, 'no event loop turn ran during keygen, so it blocked the thread');
    });

    test('a burst of keygens leaves threadpool slots to file access and DNS', async () => {
        assert.equal(MAX_CONCURRENT_KEYGENS, 2);
        const burst = Array.from({ length: 24 }, () => asymmetricAsync('keygen', {}));

        // Queued behind 20 keygens on four threads, this read would wait for several of them
        const start = performance.now();
        await readFile(fileURLToPath(import.meta.url));
        const waited = performance.now() - start;
        const keys = (await Promise.all(burst)) as { publicKey: string }[];
        assert.equal(new Set(keys.map((k) => k.publicKey)).size, 24);
        assert.ok(waited < 150, `file read waited ${waited} ms behind the keygens`);
    });
});
