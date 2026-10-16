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
 * @param path - Path from the server root, version included (e.g. `/v6/hash`)
 * @param body - JSON payload; when omitted, neither a body nor a Content-Type header is sent
 * @returns Status code and parsed JSON body of the response
 */
async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('declared endpoint: /hash', () => {
    for (const version of ['v4', 'v5', 'v6']) {
        test(`POST /${version}/hash hashes the text`, async () => {
            const { status, body } = await call('POST', `/${version}/hash`, { text: 'hello', method: 'sha256' });
            assert.equal(status, 200);
            assert.equal(body.hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
        });
    }

    test('missing text keeps the documented message', async () => {
        const { status, body } = await call('POST', '/v6/hash', { method: 'sha256' });
        assert.equal(status, 400);
        assert.equal(body.error, 'Please provide a text (?text={text})');
        assert.equal(body.status, 400);
    });

    test('missing method keeps the documented message', async () => {
        const { body } = await call('POST', '/v6/hash', { text: 'hello' });
        assert.equal(body.error, 'Please provide a valid hash algorithm (&method={algorithm})');
    });

    test('an invalid encoding returns the function error', async () => {
        const { status, body } = await call('POST', '/v6/hash', { text: 'hello', method: 'sha256', encoding: 'hexa' });
        assert.equal(status, 400);
        assert.equal(body.error, 'Encoding must be one of: hex, base64');
    });

    test('GET answers 405', async () => {
        const { status, body } = await call('GET', '/v6/hash');
        assert.equal(status, 405);
        assert.equal(body.error, 'This endpoint only supports POST requests.');
    });
});
