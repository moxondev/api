import {
    constants as cryptoConstants,
    createPublicKey,
    generateKeyPair,
    generateKeyPairSync,
    privateDecrypt,
    publicEncrypt,
} from 'crypto';
import { promisify } from 'util';

import { MAX_CONCURRENT_KEYGENS, MAX_RSA_MODULUS } from '../../constants.js';

export interface KeygenResult {
    action: string;
    algorithm: string;
    modulusLength: number;
    publicKey: string;
    privateKey: string;
}

export interface AsymmetricCryptResult {
    action: string;
    algorithm: string;
    result: string;
}

const ALGORITHMS: Record<string, { oaepHash: string; hashLength: number }> = {
    'rsa-oaep-sha256': { oaepHash: 'sha256', hashLength: 32 },
    'rsa-oaep-sha1': { oaepHash: 'sha1', hashLength: 20 },
};

const VALID_MODULUS = new Set([2048, 4096]);

const generateKeyPairAsync = promisify(generateKeyPair);

// Keygens waiting for a threadpool slot, released in arrival order
const queue: (() => void)[] = [];
let running = 0;

/**
 * Runs a keygen once fewer than MAX_CONCURRENT_KEYGENS others are running, so a burst of
 * requests cannot take every libuv thread from DNS lookups, file access and zlib.
 *
 * @param task - Keygen to run
 * @returns The keygen result, once a slot was free and the task finished
 */
async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (running < MAX_CONCURRENT_KEYGENS) running++;
    else await new Promise<void>((resolve) => queue.push(resolve));

    try {
        return await task();
    } finally {
        // The slot passes straight to the next waiting keygen, if any
        const next = queue.shift();
        if (next) next();
        else running--;
    }
}

/**
 * Resolves the keygen modulus length and rejects any size outside the allowed set.
 *
 * @param modulusLength - Requested modulus length in bits, 2048 when omitted
 * @returns Validated modulus length in bits
 */
const keygenModulus = (modulusLength?: number): number => {
    const bits = modulusLength ?? 2048;
    if (!VALID_MODULUS.has(bits) || bits > MAX_RSA_MODULUS) throw new Error('Modulus length must be 2048 or 4096');
    return bits;
};

/**
 * RSA asymmetric key generation, encryption and decryption.
 *
 * @param action - "keygen", "encrypt", or "decrypt"
 * @param options - Options object with text, publicKey, privateKey, modulusLength, algorithm
 * @returns Keygen or crypt result object
 */
export default function asymmetric(
    action: string,
    options: {
        text?: string;
        publicKey?: string;
        privateKey?: string;
        modulusLength?: number;
        algorithm?: string;
    } = {},
): KeygenResult | AsymmetricCryptResult {
    if (!action || (action !== 'keygen' && action !== 'encrypt' && action !== 'decrypt'))
        throw new Error('Action must be "keygen", "encrypt", or "decrypt"');

    const algorithm = options.algorithm ?? 'rsa-oaep-sha256';
    const algo = ALGORITHMS[algorithm];
    if (!algo) throw new Error(`Unsupported algorithm. Use one of: ${Object.keys(ALGORITHMS).join(', ')}`);

    if (action === 'keygen') {
        const modulusLength = keygenModulus(options.modulusLength);
        const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });

        return { action, algorithm, modulusLength, publicKey, privateKey };
    }

    if (action === 'encrypt') {
        if (!options.text) throw new Error('Text is required');
        if (!options.publicKey) throw new Error('Public key is required');
        if (!options.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Invalid public key format');

        let keyObject;
        try {
            keyObject = createPublicKey(options.publicKey);
        } catch {
            throw new Error('Invalid public key format');
        }

        const modulusLength = keyObject.asymmetricKeyDetails?.modulusLength ?? 2048;
        const maxBytes = modulusLength / 8 - 2 * algo.hashLength - 2;
        if (Buffer.byteLength(options.text, 'utf8') > maxBytes)
            throw new Error(`Text exceeds maximum length for this key size and algorithm (${maxBytes} bytes)`);

        try {
            const encrypted = publicEncrypt(
                { key: keyObject, oaepHash: algo.oaepHash, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING },
                Buffer.from(options.text, 'utf8'),
            );
            return { action, algorithm, result: encrypted.toString('base64') };
        } catch {
            throw new Error('Encryption failed: invalid key or data too large');
        }
    }

    // action === 'decrypt'
    if (!options.text) throw new Error('Encrypted data is required');
    if (!options.privateKey) throw new Error('Private key is required');
    if (!options.privateKey.startsWith('-----BEGIN PRIVATE KEY-----')) throw new Error('Invalid private key format');

    try {
        const decrypted = privateDecrypt(
            { key: options.privateKey, oaepHash: algo.oaepHash, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING },
            Buffer.from(options.text, 'base64'),
        );
        return { action, algorithm, result: decrypted.toString('utf8') };
    } catch {
        throw new Error('Invalid key or corrupted data');
    }
}

/**
 * Same as asymmetric, but generates RSA key pairs on the libuv threadpool instead of the calling thread,
 * at most MAX_CONCURRENT_KEYGENS at a time.
 *
 * @param action - "keygen", "encrypt", or "decrypt"
 * @param options - Options object with text, publicKey, privateKey, modulusLength, algorithm
 * @returns Promise of the keygen or crypt result object, identical to what asymmetric returns
 */
export async function asymmetricAsync(
    action: string,
    options: {
        text?: string;
        publicKey?: string;
        privateKey?: string;
        modulusLength?: number;
        algorithm?: string;
    } = {},
): Promise<KeygenResult | AsymmetricCryptResult> {
    // Encrypt, decrypt and every invalid input go through the sync code, so errors stay identical
    if (action !== 'keygen') return asymmetric(action, options);

    const algorithm = options.algorithm ?? 'rsa-oaep-sha256';
    if (!ALGORITHMS[algorithm])
        throw new Error(`Unsupported algorithm. Use one of: ${Object.keys(ALGORITHMS).join(', ')}`);

    const modulusLength = keygenModulus(options.modulusLength);
    const { publicKey, privateKey } = await limited(() =>
        generateKeyPairAsync('rsa', {
            modulusLength,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        }),
    );

    return { action, algorithm, modulusLength, publicKey, privateKey };
}
