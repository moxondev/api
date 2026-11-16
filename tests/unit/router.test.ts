import { strict as assert } from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import express from 'express';

import { api, define, HttpError, Reply } from '../../src/endpoints/define.js';
import { build } from '../../src/endpoints/router.js';
import { jsonResponseMiddleware } from '../../src/middleware/json.js';

const seen: Record<string, unknown>[] = [];

const contracts = [
    define({
        name: 'echo',
        method: 'get',
        path: '/echo',
        category: 'text',
        params: {
            strict: { required: true, missing: 'Give a strict value' },
            loose: { required: 'defined' },
            optional: {},
        },
        example: { strict: 'a' },
        run: (values) => {
            seen.push(values);
            return values;
        },
    }),
    define({
        name: 'bounded',
        method: 'get',
        path: '/bounded',
        category: 'text',
        since: 5,
        until: 5,
        params: {},
        example: {},
        run: () => ({ ok: true }),
    }),
    define({
        name: 'fail',
        method: 'get',
        path: '/fail',
        category: 'text',
        params: { mode: {} },
        example: {},
        run: ({ mode }) => {
            if (mode === 'http') throw new HttpError(409, 'Already taken');
            if (mode === 'reply') return new Reply({ made: true }, 201);
            if (mode === 'async') return Promise.reject(new Error('Rejected later'));
            throw new Error('Plain failure');
        },
    }),
    define({
        name: 'payload',
        method: 'post',
        path: '/payload',
        category: 'compute',
        params: { list: { type: 'array', required: 'defined' }, count: { type: 'number' }, flag: { type: 'boolean' } },
        example: {},
        run: (values) => values,
    }),
    define({
        name: 'strictbody',
        method: 'post',
        path: '/strictbody',
        category: 'compute',
        params: { amount: { required: true } },
        example: {},
        run: (values) => values,
    }),
    define({
        name: 'module',
        method: 'get',
        path: '/module',
        category: 'compute',
        params: {},
        example: {},
        run: (_values, req) => ({ marker: (api(req) as unknown as { marker: string }).marker, version: req.version }),
    }),
];

let server: Server;
let baseUrl: string;

before(() => {
    const app = express();
    app.use(express.json());
    app.use(jsonResponseMiddleware);
    app.use('/:version', (req, _res, next) => {
        req.version = req.params.version as string;
        req.module = { marker: `module of ${req.version}` } as never;
        next();
    });
    app.use(build(contracts));
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
 * @param method - HTTP verb
 * @param path - Path from the server root, version included
 * @param body - JSON payload, none when omitted
 * @returns Status code and parsed JSON body
 */
async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
        parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
        // Not JSON: the default answer of Express
    }
    return { status: res.status, body: parsed };
}

describe('endpoint router', () => {
    describe('required parameters', () => {
        test('required: true refuses an absent and an empty value with the message of the contract', async () => {
            for (const query of ['?loose=1', '?strict=&loose=1']) {
                const { status, body } = await call('GET', `/v6/echo${query}`);
                assert.equal(status, 400, query);
                assert.equal(body.error, 'Give a strict value', query);
            }
        });

        test("required: 'defined' only refuses an absent value and keeps an empty one", async () => {
            const missing = await call('GET', '/v6/echo?strict=a');
            assert.equal(missing.status, 400);
            assert.equal(missing.body.error, 'Please provide a loose');

            const empty = await call('GET', '/v6/echo?strict=a&loose=');
            assert.equal(empty.status, 200);
            assert.equal(empty.body.loose, '');
        });

        test('a parameter without requirement may be absent', async () => {
            const { status, body } = await call('GET', '/v6/echo?strict=a&loose=b');
            assert.equal(status, 200);
            assert.equal(body.optional, undefined);
        });

        test('a repeated query key reaches the contract as an array', async () => {
            const { body } = await call('GET', '/v6/echo?strict=a&strict=b&loose=c');
            assert.deepEqual(body.strict, ['a', 'b']);
        });

        test("a body keeps the type of every value, and 'defined' lets 0 and false through", async () => {
            const sent = { list: [], count: 0, flag: false };
            const { status, body } = await call('POST', '/v6/payload', sent);
            assert.equal(status, 200);
            assert.deepEqual(body, sent);
        });

        test('required: true also refuses 0, false and an empty string sent in a body', async () => {
            for (const amount of [0, false, '']) {
                const { status } = await call('POST', '/v6/strictbody', { amount });
                assert.equal(status, 400, JSON.stringify(amount));
            }
            assert.equal((await call('POST', '/v6/strictbody', { amount: 1 })).status, 200);
        });

        test('a missing body counts as every parameter missing', async () => {
            const { status, body } = await call('POST', '/v6/payload');
            assert.equal(status, 400);
            assert.equal(body.error, 'Please provide a list');
        });
    });

    describe('versions', () => {
        test('since and until bound the versions that serve a contract', async () => {
            assert.equal((await call('GET', '/v4/bounded')).status, 404);
            assert.equal((await call('GET', '/v5/bounded')).status, 200);
            const after = await call('GET', '/v6/bounded');
            assert.equal(after.status, 404);
            assert.equal(after.body.error, 'Endpoint not available in v6.');
        });

        test('the contract reaches the modules of the version being served', async () => {
            assert.deepEqual((await call('GET', '/v4/module')).body, { marker: 'module of v4', version: 'v4' });
            assert.deepEqual((await call('GET', '/v6/module')).body, { marker: 'module of v6', version: 'v6' });
        });
    });

    describe('answers', () => {
        test('an error thrown by run is a 400 with its message', async () => {
            const { status, body } = await call('GET', '/v6/fail');
            assert.equal(status, 400);
            assert.equal(body.error, 'Plain failure');
        });

        test('a rejected promise is a 400 as well', async () => {
            const { status, body } = await call('GET', '/v6/fail?mode=async');
            assert.equal(status, 400);
            assert.equal(body.error, 'Rejected later');
        });

        test('an HttpError chooses the status', async () => {
            const { status, body } = await call('GET', '/v6/fail?mode=http');
            assert.equal(status, 409);
            assert.equal(body.error, 'Already taken');
        });

        test('a Reply chooses the status of a success', async () => {
            const { status, body } = await call('GET', '/v6/fail?mode=reply');
            assert.equal(status, 201);
            assert.deepEqual(body, { made: true });
        });
    });

    describe('methods', () => {
        test('a contract serves only the method it declares and leaves the other one to the next route', async () => {
            const get = await call('GET', '/v6/payload');
            assert.equal(get.status, 404);
            const post = await call('POST', '/v6/echo', { strict: 'a', loose: 'b' });
            assert.equal(post.status, 404);
        });
    });
});
