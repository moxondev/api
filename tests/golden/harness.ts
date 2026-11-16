import { strict as assert } from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mock } from 'node:test';

import app from '../../src/app.js';

export interface GoldenCase {
    id: string;
    method?: 'GET' | 'POST';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
    versions?: string[];
    volatile?: string[];
    skip?: string;
}

export interface Recorded {
    id: string;
    version: string;
    status: number;
    type: string;
    body: unknown;
}

export const VERSIONS = ['v4', 'v5', 'v6'];

// Same client for every request, so the endpoints that read the caller see stable values
const DEFAULT_HEADERS = { 'User-Agent': 'golden-agent/1.0 (Test)', 'X-Forwarded-For': '203.0.113.7' };

let server: Server;
let baseUrl = '';
const realFetch = globalThis.fetch;

// A line of the request logger starts with its grey time stamp, and would otherwise print thousands of lines
const LOG_PREFIX = '\u001b[90m';
const LOG_TIME = /^\d\d:\d\d:\d\d/;

// A fixed instant, so that the endpoints reading the clock answer the same way on every run
const NOW = Date.UTC(2026, 5, 15, 12, 30, 45);

/**
 * Starts the application on a free port, cuts it off from the network so that a recorded answer never depends on a
 * remote service, and freezes the clock in UTC. Only the requests sent to the local server go through.
 *
 * @returns Resolves once the server accepts connections
 */
export function start(): Promise<void> {
    process.env.TZ = 'UTC';
    const write = process.stdout.write.bind(process.stdout) as (chunk: unknown, ...rest: unknown[]) => boolean;
    mock.method(process.stdout, 'write', (chunk: unknown, ...rest: unknown[]) =>
        typeof chunk === 'string' && chunk.startsWith(LOG_PREFIX) && LOG_TIME.test(chunk.slice(LOG_PREFIX.length))
            ? true
            : write(chunk, ...rest),
    );
    mock.timers.enable({ apis: ['Date'], now: NOW });
    mock.method(globalThis, 'fetch', (input: string | URL | Request, init?: RequestInit) =>
        String(input).startsWith('http://127.0.0.1') ? realFetch(input, init) : Promise.reject(new Error('offline')),
    );
    return new Promise<void>((resolve) => {
        server = app.listen(0, () => {
            baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            resolve();
        });
    });
}

/**
 * Stops the server, then gives the network and the clock back.
 *
 * @returns Resolves once the server is closed
 */
export function stop(): Promise<void> {
    mock.timers.reset();
    mock.restoreAll();
    return new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
}

/**
 * Sends one case to one API version and keeps what the contract of the endpoint has to preserve.
 *
 * @param version - API version segment, such as `v5`
 * @param entry - Case to send
 * @returns Status, content type and body (parsed when it is JSON)
 */
export async function send(version: string, entry: GoldenCase): Promise<Omit<Recorded, 'id' | 'version'>> {
    const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...entry.headers };
    if (entry.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await realFetch(`${baseUrl}/${version}${entry.path}`, {
        method: entry.method ?? 'GET',
        headers,
        body: entry.body === undefined ? undefined : JSON.stringify(entry.body),
    });
    const type = (res.headers.get('content-type') ?? '').split(';')[0] ?? '';
    const text = await res.text();
    return { status: res.status, type, body: type === 'application/json' ? JSON.parse(text) : text };
}

/**
 * Names the kind of a JSON value, telling arrays and null apart from objects.
 *
 * @param value - Any parsed JSON value
 * @returns `array`, `null`, or the `typeof` of the value
 */
function kind(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    return value === null ? 'null' : typeof value;
}

/**
 * Merges several recordings of the same request: what never changes is kept as is, and every value that differs
 * from one run to the next is replaced by a `$volatile` marker holding its kind, so random output can be compared.
 *
 * @param runs - Parsed bodies of the same request, sent one after another
 * @returns The stable body, with markers where the runs disagree
 */
export function merge(runs: unknown[]): unknown {
    const first = runs[0];
    const kinds = new Set(runs.map(kind));
    if (kinds.size > 1) return { $volatile: 'any' };

    if (Array.isArray(first)) {
        const arrays = runs as unknown[][];
        if (arrays.some((a) => a.length !== first.length)) return { $volatile: 'array' };
        return first.map((_, i) => merge(arrays.map((a) => a[i])));
    }
    if (first !== null && typeof first === 'object') {
        const objects = runs as Record<string, unknown>[];
        const keys = Object.keys(first);
        const same = objects.every((o) => {
            const own = Object.keys(o);
            return own.length === keys.length && keys.every((k) => k in o);
        });
        if (!same) return { $volatile: 'object' };
        return Object.fromEntries(keys.map((k) => [k, merge(objects.map((o) => o[k]))]));
    }
    return runs.every((r) => r === first) ? first : { $volatile: kind(first) };
}

/**
 * Marks the values at the given paths as volatile, for what changes with the clock more slowly than the runs of a
 * recording (a timestamp in seconds, for instance).
 *
 * @param body - Merged body
 * @param paths - Dotted paths, where `*` stands for every item of an array
 * @returns The body with a `$volatile` marker at each path found
 */
export function force(body: unknown, paths: string[]): unknown {
    const walk = (node: unknown, parts: string[]): unknown => {
        const [head, ...rest] = parts;
        if (head === undefined) return { $volatile: 'any' };
        if (Array.isArray(node)) {
            return node.map((item, i) => (head === '*' || head === String(i) ? walk(item, rest) : item));
        }
        if (node !== null && typeof node === 'object' && head in node) {
            return { ...node, [head]: walk((node as Record<string, unknown>)[head], rest) };
        }
        return node;
    };
    return paths.reduce((acc, path) => walk(acc, path.split('.')), body);
}

/**
 * Compares an answer with its recording, down to the first difference.
 *
 * @param actual - Value received now
 * @param expected - Recorded value, possibly holding `$volatile` markers
 * @param path - Position in the body, used in the message
 * @returns The description of the first difference, or null when they match
 */
export function differs(actual: unknown, expected: unknown, path = 'body'): string | null {
    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected) && '$volatile' in expected) {
        const wanted = String((expected as { $volatile: unknown }).$volatile);
        return wanted === 'any' || wanted === kind(actual)
            ? null
            : `${path}: expected a ${wanted}, got ${kind(actual)}`;
    }
    if (kind(actual) !== kind(expected)) return `${path}: expected a ${kind(expected)}, got ${kind(actual)}`;
    if (Array.isArray(expected)) {
        const got = actual as unknown[];
        if (got.length !== expected.length) return `${path}: expected ${expected.length} items, got ${got.length}`;
        for (let i = 0; i < expected.length; i++) {
            const found = differs(got[i], expected[i], `${path}[${i}]`);
            if (found) return found;
        }
        return null;
    }
    if (expected !== null && typeof expected === 'object') {
        const got = actual as Record<string, unknown>;
        const keys = Object.keys(expected);
        const extra = Object.keys(got).filter((k) => !keys.includes(k));
        if (extra.length) return `${path}: unexpected keys ${extra.join(', ')}`;
        for (const k of keys) {
            if (!(k in got)) return `${path}.${k}: missing`;
            const found = differs(got[k], (expected as Record<string, unknown>)[k], `${path}.${k}`);
            if (found) return found;
        }
        return null;
    }
    return actual === expected ? null : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

/**
 * Checks one recorded answer against the live server, failing with the first difference.
 *
 * @param entry - Case that was recorded
 * @param recorded - Recording of this case for one version
 * @returns Resolves when the answer matches
 */
export async function replay(entry: GoldenCase, recorded: Recorded): Promise<void> {
    const now = await send(recorded.version, entry);
    assert.equal(now.status, recorded.status, `${recorded.version} ${entry.path}: status`);
    assert.equal(now.type, recorded.type, `${recorded.version} ${entry.path}: content type`);
    const found = differs(now.body, recorded.body);
    assert.equal(found, null, `${recorded.version} ${entry.method ?? 'GET'} ${entry.path}: ${found}`);
}
