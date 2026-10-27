import { MAX_TIMESTAMP_LENGTH } from '../constants.js';

/**
 * Tracks requests per user and throws if the rate limit is exceeded.
 *
 * @param rateLimits - Store of timestamps per user
 * @param userId - Identifier of the requesting user
 * @param timestamp - Current timestamp in milliseconds
 * @param window - Time window in milliseconds
 * @param limit - Maximum requests allowed in the window
 * @returns false if within limits
 * @throws Error if rate limit is exceeded
 */
export function checkRateLimit(
    rateLimits: Record<string, number[]>,
    userId: string,
    timestamp: number,
    window = 10000,
    limit = 50,
): boolean {
    for (const key of Object.keys(rateLimits)) {
        if (key !== userId && !rateLimits[key]!.some((ts) => timestamp - ts < window)) {
            delete rateLimits[key];
        }
    }

    rateLimits[userId] = (Object.hasOwn(rateLimits, userId) ? rateLimits[userId]! : []).filter(
        (ts) => timestamp - ts < window,
    );

    if (rateLimits[userId]!.length >= limit) {
        const remainingTime = Math.ceil((rateLimits[userId]![0]! + window - timestamp) / 1000);
        throw new Error(`Rate limit exceeded. Try again in ${remainingTime} seconds.`);
    }

    rateLimits[userId]!.push(timestamp);
    return false;
}

/**
 * Throws when a client value is an object or longer than the given limit.
 *
 * Numbers and booleans pass, measured as text, since the stores only compare them and use them as keys.
 *
 * @param value - The client value, skipped when empty so the caller's own missing-field error applies
 * @param name - Field name used in the error messages (e.g. "session ID")
 * @param max - Maximum length in characters
 * @throws Error if the value is an object, an array or a function, or exceeds the limit
 */
export function checkString(value: unknown, name: string, max: number): void {
    if (!value) return;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`Please provide a valid ${name}`);
    }
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    if (String(value).length > max) throw new Error(`${label} cannot exceed ${max} characters`);
}

/**
 * Checks that a client-supplied timestamp can be stored as it was sent.
 *
 * @param value - The client value, in any format the client chose
 * @returns true for a finite number, a boolean or a string up to MAX_TIMESTAMP_LENGTH characters
 */
export function isTimestamp(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    return typeof value === 'string' && value.length <= MAX_TIMESTAMP_LENGTH;
}

/**
 * Parses a space-separated environment variable into an array.
 *
 * @param key - The environment variable name
 * @returns The parsed array, or null if not set
 */
export function envList(key: string): string[] | null {
    const v = process.env[key];
    return v && v !== 'undefined' ? v.split(' ') : null;
}

/**
 * Formats a Date to ISO string without timezone suffix.
 *
 * @param date - The date to format
 * @returns ISO-formatted string without trailing Z
 */
export function formatDate(date: Date): string {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().replace('Z', '');
}

/**
 * Generates a random IPv4 address.
 *
 * @returns A string in the format "X.X.X.X"
 */
export function genIP(): string {
    return `${randomNumber(0, 255)}.${randomNumber(0, 255)}.${randomNumber(0, 255)}.${randomNumber(0, 255)}`;
}

/**
 * Returns a random element from an array.
 *
 * @param arr - The source array
 * @returns A random element
 */
export function random<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Returns a random integer between min and max (inclusive).
 *
 * @param min - Lower bound
 * @param max - Upper bound
 * @returns A random integer in [min, max]
 */
export function randomNumber(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Checks if a version string is at least the given minimum.
 *
 * @param version - Version string (e.g. "v4")
 * @param min - Minimum version number
 * @returns true if the version is >= min
 */
export function since(version: string, min: number): boolean {
    return parseInt(version.replace('v', '')) >= min;
}
