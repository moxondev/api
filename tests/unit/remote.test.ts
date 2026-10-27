import { strict as assert } from 'node:assert';
import type { LookupAddress } from 'node:dns';
import { createServer, type IncomingHttpHeaders, request, type Server, type ServerResponse } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { type AddressInfo, BlockList } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { MAX_REMOTE_REDIRECTS } from '../../src/constants.js';
import { fetchRemote, isPrivateAddress, type RemoteOptions } from '../../src/utils/remote.js';

let server: Server;
let port: number;
let lastHeaders: IncomingHttpHeaders = {};
let closedEarly = 0;

const routes: Record<string, (res: ServerResponse) => void> = {
    '/ok': (res) => res.writeHead(200, { 'Content-Type': 'text/plain' }).end('hello'),
    '/missing': (res) => res.writeHead(404, { 'Content-Type': 'text/plain' }).end('nope'),
    '/gzip': (res) => res.writeHead(200, { 'Content-Encoding': 'gzip' }).end(gzipSync('compressed')),
    '/bomb': (res) => res.writeHead(200, { 'Content-Encoding': 'gzip' }).end(gzipSync(Buffer.alloc(10_000_000))),
    '/exact': (res) => res.writeHead(200).end(Buffer.alloc(1000)),
    '/endless': (res) => {
        res.writeHead(200);
        const chunk = Buffer.alloc(64 * 1024);
        const pump = () => {
            while (res.write(chunk));
        };
        res.on('drain', pump);
        res.on('close', () => closedEarly++);
        pump();
    },
    '/hang': () => {},
    '/to-http': (res) => res.writeHead(302, { Location: 'http://fake.test/ok' }).end(),
    '/to-internal': (res) => res.writeHead(302, { Location: `https://internal.test:${port}/ok` }).end(),
    '/to-metadata': (res) => res.writeHead(301, { Location: 'https://169.254.169.254/latest/meta-data' }).end(),
    '/to-mapped': (res) => res.writeHead(307, { Location: 'https://[::ffff:127.0.0.1]/' }).end(),
    '/no-location': (res) => res.writeHead(302).end('stay'),
};

before(() => {
    server = createServer((req, res) => {
        lastHeaders = req.headers;
        const hops = /^\/hops\/(\d+)$/.exec(req.url ?? '');
        if (hops) {
            const left = Number(hops[1]);
            if (left === 0) res.writeHead(200).end('arrived');
            else res.writeHead(302, { Location: `/hops/${left - 1}` }).end();
            return;
        }
        (routes[req.url ?? ''] ?? routes['/missing']!)(res);
    });
    return new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            port = (server.address() as AddressInfo).port;
            resolve();
        });
    });
});

after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Builds fetch options that reach the local plain-HTTP test server through fake hostnames.
 *
 * @param overrides - Options replacing the local defaults
 * @returns Options routing fake.test to the loopback test server with an empty blocklist
 */
function local(overrides: Partial<RemoteOptions> = {}): RemoteOptions {
    const hosts: Record<string, LookupAddress[]> = {
        'fake.test': [{ address: '127.0.0.1', family: 4 }],
        'internal.test': [{ address: '127.0.0.1', family: 4 }],
    };
    return {
        maxBytes: 1_000_000,
        timeout: 2000,
        blocklist: new BlockList(),
        resolve: async (hostname) => {
            if (!hosts[hostname]) throw new Error('ENOTFOUND');
            return hosts[hostname];
        },

        // Same request over plain HTTP, so without the HTTPS agent; the pinned lookup still picks the address
        request: (url, options, callback) =>
            request(
                {
                    ...options,
                    agent: undefined,
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname + url.search,
                },
                callback,
            ),
        ...overrides,
    };
}

describe('isPrivateAddress', () => {
    test('flags loopback, private, link-local, CGNAT, multicast and unspecified IPv4', () => {
        for (const address of [
            '0.0.0.0',
            '10.1.2.3',
            '100.64.0.1',
            '100.127.255.255',
            '127.0.0.1',
            '127.0.0.2',
            '169.254.169.254',
            '172.16.0.1',
            '172.31.255.255',
            '192.168.1.1',
            '224.0.0.1',
            '255.255.255.255',
        ]) {
            assert.equal(isPrivateAddress(address), true, address);
        }
    });

    test('flags loopback, ULA, link-local, multicast, mapped and NAT64 IPv6', () => {
        for (const address of [
            '::',
            '::1',
            'fc00::1',
            'fd12:3456::1',
            'fe80::1',
            'fe80::1%eth0',
            'ff02::1',
            '::ffff:127.0.0.1',
            '::ffff:7f00:1',
            '::ffff:10.0.0.1',
            '::127.0.0.1',
            '64:ff9b::169.254.169.254',
            '64:ff9b::a00:1',
        ]) {
            assert.equal(isPrivateAddress(address), true, address);
        }
    });

    test('flags documentation, 6to4 relay, Teredo and IPv4-translated ranges', () => {
        for (const address of [
            '192.0.2.1',
            '198.51.100.7',
            '203.0.113.9',
            '192.88.99.1',
            '::ffff:203.0.113.9',
            '2001:db8::1',
            '2002:7f00:1::',
            '2002:a00:1::1',
            '2001:0:4136:e378:8000:63bf:80ff:fffe',
            '::ffff:0:7f00:1',
            '::ffff:0:a9fe:a9fe',
        ]) {
            assert.equal(isPrivateAddress(address), true, address);
        }
    });

    test('lets public addresses through', () => {
        for (const address of [
            '1.1.1.1',
            '8.8.8.8',
            '100.63.255.255',
            '100.128.0.1',
            '172.15.255.255',
            '172.32.0.1',
            '2606:4700:4700::1111',
            '2001:4860:4860::8888',
            '2003::1',
            '::ffff:8.8.8.8',
            '64:ff9b::8.8.8.8',
        ]) {
            assert.equal(isPrivateAddress(address), false, address);
        }
    });

    test('treats anything that is not an IP as private', () => {
        assert.equal(isPrivateAddress('example.com'), true);
    });
});

describe('fetchRemote host checks', () => {
    test('rejects private literals that the old hostname list missed, without connecting', async () => {
        let requests = 0;
        const options = local({
            blocklist: undefined,
            request: () => {
                requests++;
                throw new Error('should not connect');
            },
        });
        for (const url of [
            'https://127.0.0.2/',
            'https://[::ffff:127.0.0.1]/',
            'https://[::]/',
            'https://[::1]/',
            'https://100.64.0.1/',
            'https://0.0.0.0/',
            'https://localhost./',
            'https://api.localhost/',
            'https://metadata.google.internal/',
            'https://2130706433/',
            'https://[2002:7f00:1::]/',
            'https://[::ffff:0:a9fe:a9fe]/',
        ]) {
            await assert.rejects(() => fetchRemote(url, options), /private\/internal/, url);
        }
        assert.equal(requests, 0);
    });

    test('rejects a hostname whose DNS answer is private', async () => {
        const options = local({ blocklist: undefined, resolve: async () => [{ address: '10.0.0.5', family: 4 }] });
        await assert.rejects(() => fetchRemote('https://evil.test/', options), /private\/internal/);
    });

    test('rejects a hostname when any of its addresses is private', async () => {
        const options = local({
            blocklist: undefined,
            resolve: async () => [
                { address: '93.184.215.14', family: 4 },
                { address: '::1', family: 6 },
            ],
        });
        await assert.rejects(() => fetchRemote('https://evil.test/', options), /private\/internal/);
    });

    test('connects to the vetted address instead of resolving again', async () => {
        let resolutions = 0;
        const options = local({
            resolve: async () => {
                resolutions++;
                return [{ address: '127.0.0.1', family: 4 }];
            },
        });
        const body = await fetchRemote(`https://only-in-the-test-resolver.test:${port}/ok`, options);
        assert.equal(body.toString(), 'hello');
        assert.equal(resolutions, 1);
    });

    test('uses the caller message for blocked hosts', async () => {
        await assert.rejects(
            () => fetchRemote('https://127.0.0.1/', { maxBytes: 1, timeout: 1000, messages: { blocked: 'No.' } }),
            /^Error: No\.$/,
        );
    });

    test('reports unresolvable hosts as fetch failed', async () => {
        await assert.rejects(() => fetchRemote('https://unknown.test/', local()), /^Error: fetch failed$/);
    });

    test('does not echo internal addresses when the connection fails', async () => {
        await assert.rejects(
            () => fetchRemote('https://fake.test:1/ok', local()),
            (err: Error) => err.message === 'fetch failed',
        );
    });
});

describe('fetchRemote URL checks', () => {
    test('rejects plain HTTP', async () => {
        await assert.rejects(() => fetchRemote('http://fake.test/', local()), /Only HTTPS/);
    });

    test('rejects URLs with credentials', async () => {
        await assert.rejects(() => fetchRemote('https://user:pass@fake.test/', local()), /credentials/);
    });

    test('rejects invalid URLs with the fetch() wording', async () => {
        await assert.rejects(() => fetchRemote('https://', local()), /^Error: Failed to parse URL from https:\/\/$/);
    });
});

describe('fetchRemote responses', () => {
    test('returns the body and reports status and content type to check', async () => {
        const heads: unknown[] = [];
        const body = await fetchRemote(`https://fake.test:${port}/ok`, local({ check: (head) => heads.push(head) }));
        assert.equal(body.toString(), 'hello');
        assert.deepEqual(heads, [{ status: 200, ok: true, contentType: 'text/plain' }]);
    });

    test('sends every request through one shared keep-alive HTTPS agent', async () => {
        const agents: unknown[] = [];
        const options = local();
        const send = options.request!;
        options.request = (url, opts, callback) => {
            agents.push(opts.agent);
            return send(url, opts, callback);
        };
        await fetchRemote(`https://fake.test:${port}/ok`, options);
        await fetchRemote(`https://fake.test:${port}/ok`, options);
        assert.ok(agents[0] instanceof HttpsAgent);
        assert.equal((agents[0] as { keepAlive?: boolean }).keepAlive, true);
        assert.equal(agents[1], agents[0]);
    });

    test('sends the same headers as fetch()', async () => {
        await fetchRemote(`https://fake.test:${port}/ok`, local());
        assert.equal(lastHeaders['user-agent'], 'node');
        assert.equal(lastHeaders.accept, '*/*');
        assert.equal(lastHeaders['accept-encoding'], 'gzip, deflate');
    });

    test('lets check reject a response before its body is read', async () => {
        const options = local({
            check: ({ ok, status }) => {
                if (!ok) throw new Error(`HTTP ${status}`);
            },
        });
        await assert.rejects(() => fetchRemote(`https://fake.test:${port}/missing`, options), /^Error: HTTP 404$/);
    });

    test('decodes gzip bodies', async () => {
        const body = await fetchRemote(`https://fake.test:${port}/gzip`, local());
        assert.equal(body.toString(), 'compressed');
    });

    test('accepts a body of exactly maxBytes', async () => {
        const body = await fetchRemote(`https://fake.test:${port}/exact`, local({ maxBytes: 1000 }));
        assert.equal(body.length, 1000);
    });

    test('aborts an endless body past maxBytes', async () => {
        const before = closedEarly;
        await assert.rejects(
            () => fetchRemote(`https://fake.test:${port}/endless`, local({ maxBytes: 1_000_000, timeout: 10_000 })),
            /too large/,
        );
        await new Promise((resolve) => setTimeout(resolve, 50).unref());
        assert.equal(closedEarly, before + 1);
    });

    test('caps the decoded size of a gzip bomb', async () => {
        await assert.rejects(
            () =>
                fetchRemote(
                    `https://fake.test:${port}/bomb`,
                    local({ maxBytes: 1_000_000, messages: { size: 'Big.' } }),
                ),
            /^Error: Big\.$/,
        );
    });

    test('times out a server that never answers', async () => {
        const started = Date.now();
        await assert.rejects(
            () => fetchRemote(`https://fake.test:${port}/hang`, local({ timeout: 200 })),
            /^Error: The operation was aborted due to timeout$/,
        );
        assert.ok(Date.now() - started < 2000);
    });
});

describe('fetchRemote redirects', () => {
    test('follows up to ten redirects', async () => {
        assert.equal(MAX_REMOTE_REDIRECTS, 10);
        const body = await fetchRemote(`https://fake.test:${port}/hops/10`, local());
        assert.equal(body.toString(), 'arrived');
    });

    test('refuses an eleventh redirect', async () => {
        await assert.rejects(() => fetchRemote(`https://fake.test:${port}/hops/11`, local()), /^Error: fetch failed$/);
    });

    test('honours a lower redirect limit', async () => {
        await assert.rejects(
            () => fetchRemote(`https://fake.test:${port}/hops/2`, local({ redirects: 1 })),
            /^Error: fetch failed$/,
        );
    });

    test('refuses a redirect to plain HTTP', async () => {
        await assert.rejects(() => fetchRemote(`https://fake.test:${port}/to-http`, local()), /Only HTTPS/);
    });

    test('vets the host of every hop', async () => {
        const blocklist = new BlockList();
        blocklist.addAddress('10.9.9.9');
        const options = local({
            blocklist,
            resolve: async (hostname) => [
                { address: hostname === 'internal.test' ? '10.9.9.9' : '127.0.0.1', family: 4 },
            ],
        });
        await assert.rejects(() => fetchRemote(`https://fake.test:${port}/to-internal`, options), /private\/internal/);
    });

    test('refuses redirects to cloud metadata and mapped loopback', async () => {
        // The first hop looks public to the checks but is served by the loopback test server
        const options = local({
            blocklist: undefined,
            resolve: async () => [{ address: '93.184.215.14', family: 4 }],
            request: (url, opts, callback) =>
                request(
                    { ...opts, agent: undefined, lookup: undefined, hostname: '127.0.0.1', port, path: url.pathname },
                    callback,
                ),
        });
        await assert.rejects(() => fetchRemote(`https://fake.test/to-metadata`, options), /private\/internal/);
        await assert.rejects(() => fetchRemote(`https://fake.test/to-mapped`, options), /private\/internal/);
    });

    test('returns a redirect without Location as is', async () => {
        const heads: unknown[] = [];
        const body = await fetchRemote(
            `https://fake.test:${port}/no-location`,
            local({ check: ({ status }) => heads.push(status) }),
        );
        assert.equal(body.toString(), 'stay');
        assert.deepEqual(heads, [302]);
    });
});
