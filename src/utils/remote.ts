import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { pipeline, type Readable, type Transform } from 'node:stream';
import { constants, createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { MAX_REMOTE_REDIRECTS } from '../constants.js';

export type RemoteFailure = 'blocked' | 'protocol' | 'size' | 'network' | 'timeout';

export interface RemoteHead {
    status: number;
    ok: boolean;
    contentType: string;
}

export interface RemoteOptions {
    maxBytes: number;
    timeout: number;
    redirects?: number;
    check?: (head: RemoteHead) => void;
    messages?: Partial<Record<RemoteFailure, string>>;
    blocklist?: BlockList;
    resolve?: (hostname: string) => Promise<LookupAddress[]>;
    request?: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
}

export type RemoteFetcher = (url: string, options: RemoteOptions) => Promise<Buffer>;

// Default messages; network and timeout keep the wording fetch() used before this helper
const MESSAGES: Record<RemoteFailure, string> = {
    blocked: 'Access to private/internal hosts is not allowed.',
    protocol: 'Only HTTPS URLs are allowed.',
    size: 'Response body is too large.',
    network: 'fetch failed',
    timeout: 'The operation was aborted due to timeout',
};

// Same request headers as Node's built-in fetch, so remote servers answer as before
const HEADERS = {
    accept: '*/*',
    'accept-language': '*',
    'sec-fetch-mode': 'cors',
    'user-agent': 'node',
    'accept-encoding': 'gzip, deflate',
};

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Shared so repeated fetches reuse a socket; a pooled socket only ever connected to a vetted address
const AGENT = new Agent({ keepAlive: true });

// Loopback, private, link-local, CGNAT, unspecified, multicast, documentation, relay and reserved ranges
const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
] as const) {
    PRIVATE_RANGES.addSubnet(network, prefix, 'ipv4');
}

// 6to4 and Teredo embed an IPv4 address reached through a relay, so they are refused as a whole
for (const [network, prefix] of [
    ['::', 96],
    ['::ffff:0:0:0', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 32],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
] as const) {
    PRIVATE_RANGES.addSubnet(network, prefix, 'ipv6');
}

/**
 * Tells whether an IP address belongs to a private, loopback or otherwise internal range.
 *
 * @param address - IPv4 or IPv6 address, optionally with an IPv6 zone index
 * @param blocklist - Ranges to reject, the internal ranges by default
 * @returns true when the address must not be contacted
 */
export function isPrivateAddress(address: string, blocklist: BlockList = PRIVATE_RANGES): boolean {
    const bare = address.split('%')[0]!;
    const family = isIP(bare);
    if (family === 0) return true;
    if (family === 4) return blocklist.check(bare, 'ipv4');
    if (blocklist.check(bare, 'ipv6')) return true;

    // IPv4-mapped addresses are matched by BlockList itself, NAT64 ones are not
    const nat64 = /^\[64:ff9b::(?:([0-9a-f]{1,4}):)?([0-9a-f]{1,4})?\]$/.exec(new URL(`http://[${bare}]`).hostname);
    if (!nat64) return false;
    const value = (parseInt(nat64[1] ?? '0', 16) << 16) | parseInt(nat64[2] ?? '0', 16);
    const embedded = [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
    return blocklist.check(embedded, 'ipv4');
}

/**
 * Builds the error thrown for a failed remote fetch.
 *
 * @param kind - Failure category
 * @param messages - Caller overrides for the user-facing messages
 * @returns Error carrying the caller's message, or the default one for that category
 */
function failure(kind: RemoteFailure, messages: RemoteOptions['messages']): Error {
    return new Error(messages?.[kind] ?? MESSAGES[kind]);
}

/**
 * Parses a URL to fetch and enforces HTTPS without credentials.
 *
 * @param url - Absolute URL, or a redirect location relative to base
 * @param messages - Caller overrides for the user-facing messages
 * @param base - URL of the response that redirected, if any
 * @returns Parsed URL
 */
function parse(url: string, messages: RemoteOptions['messages'], base?: URL): URL {
    let parsed: URL;
    try {
        parsed = new URL(url, base);
    } catch {
        throw base ? failure('network', messages) : new Error(`Failed to parse URL from ${url}`);
    }

    if (parsed.protocol !== 'https:') throw failure('protocol', messages);
    if (parsed.username || parsed.password) {
        throw base
            ? failure('network', messages)
            : new Error(`Request cannot be constructed from a URL that includes credentials: ${url}`);
    }
    return parsed;
}

/**
 * Resolves a hostname with the system resolver, returning every address.
 *
 * @param hostname - Hostname to resolve
 * @returns All addresses the hostname resolves to
 */
function resolveHost(hostname: string): Promise<LookupAddress[]> {
    return lookup(hostname, { all: true });
}

/**
 * Resolves the URL host once and rejects it when any of its addresses is internal.
 *
 * @param url - URL about to be fetched
 * @param options - Fetch options holding the blocklist, resolver and messages
 * @returns The vetted addresses, which are the only ones the connection may use
 */
async function vet(url: URL, options: RemoteOptions): Promise<LookupAddress[]> {
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost')) throw failure('blocked', options.messages);

    const family = isIP(host);
    let addresses: LookupAddress[];
    if (family) {
        addresses = [{ address: host, family }];
    } else {
        try {
            addresses = await (options.resolve ?? resolveHost)(host);
        } catch {
            throw failure('network', options.messages);
        }
    }

    const blocklist = options.blocklist ?? PRIVATE_RANGES;
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address, blocklist))) {
        throw failure('blocked', options.messages);
    }
    return addresses;
}

/**
 * Sends one GET request whose socket can only connect to the vetted addresses.
 *
 * @param url - URL to request
 * @param addresses - Addresses returned by vet()
 * @param options - Fetch options holding the transport and messages
 * @param signal - Signal aborting the request on timeout
 * @returns The response, before its body is read
 */
function send(
    url: URL,
    addresses: LookupAddress[],
    options: RemoteOptions,
    signal: AbortSignal,
): Promise<IncomingMessage> {
    // Pinning the lookup stops a second DNS answer (rebinding) from changing the target
    const pinned = (
        _hostname: string,
        lookupOptions: LookupOptions,
        callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
    ) => {
        if (lookupOptions.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
    };

    return new Promise((resolve, reject) => {
        const req = (options.request ?? httpsRequest)(
            url,
            { method: 'GET', headers: HEADERS, lookup: pinned, agent: AGENT, signal },
            resolve,
        );
        req.on('error', () => reject(failure('network', options.messages)));
        req.end();
    });
}

/**
 * Builds the decompression stages for a Content-Encoding header, like fetch() does.
 *
 * @param header - Content-Encoding header value
 * @returns Decoders to apply in order, or none when an encoding is unknown
 */
function decoders(header: string | undefined): Transform[] {
    const codings = (header ?? '')
        .toLowerCase()
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
    const zlib = { flush: constants.Z_SYNC_FLUSH, finishFlush: constants.Z_SYNC_FLUSH };
    const brotli = { flush: constants.BROTLI_OPERATION_FLUSH, finishFlush: constants.BROTLI_OPERATION_FLUSH };
    const stages: Transform[] = [];

    for (const coding of codings.reverse()) {
        if (coding === 'gzip' || coding === 'x-gzip') stages.push(createGunzip(zlib));
        else if (coding === 'deflate') stages.push(createInflate(zlib));
        else if (coding === 'br') stages.push(createBrotliDecompress(brotli));
        else return [];
    }
    return stages;
}

/**
 * Reads a decoded response body and aborts as soon as it grows past the limit.
 *
 * @param response - Response to read
 * @param maxBytes - Largest decoded body accepted
 * @param messages - Caller overrides for the user-facing messages
 * @returns The decoded body
 */
async function readBody(
    response: IncomingMessage,
    maxBytes: number,
    messages: RemoteOptions['messages'],
): Promise<Buffer> {
    const stages = decoders(response.headers['content-encoding']);
    const stream = stages.length ? (pipeline([response, ...stages], () => {}) as unknown as Readable) : response;
    const chunks: Buffer[] = [];
    let size = 0;

    try {
        for await (const chunk of stream as AsyncIterable<Buffer>) {
            size += chunk.length;
            if (size > maxBytes) break;
            chunks.push(chunk);
        }
    } catch {
        throw failure('network', messages);
    } finally {
        response.destroy();
    }

    if (size > maxBytes) throw failure('size', messages);
    return Buffer.concat(chunks);
}

/**
 * Follows the redirect chain by hand, vetting every hop, then reads the final body.
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param signal - Signal aborted on timeout
 * @returns The decoded body of the final response
 */
async function download(url: string, options: RemoteOptions, signal: AbortSignal): Promise<Buffer> {
    const redirects = options.redirects ?? MAX_REMOTE_REDIRECTS;
    let target = parse(url, options.messages);

    for (let hop = 0; ; hop++) {
        const addresses = await vet(target, options);
        if (signal.aborted) throw failure('timeout', options.messages);
        const response = await send(target, addresses, options, signal);
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if (REDIRECT_STATUSES.has(status) && location) {
            response.destroy();
            if (hop >= redirects) throw failure('network', options.messages);
            target = parse(location, options.messages, target);
            continue;
        }

        try {
            options.check?.({
                status,
                ok: status >= 200 && status <= 299,
                contentType: response.headers['content-type'] ?? '',
            });
        } catch (err) {
            response.destroy();
            throw err;
        }
        return readBody(response, options.maxBytes, options.messages);
    }
}

/**
 * Fetches an HTTPS resource without letting the caller reach internal hosts.
 *
 * The host is resolved once, every address is checked against the internal ranges, and the
 * socket connects to those vetted addresses only. Redirects are followed by hand with the same
 * checks on each hop, the body is streamed and cut past maxBytes, and the whole exchange,
 * redirects and body included, must finish within the timeout.
 *
 * @param url - HTTPS URL to fetch
 * @param options - Size limit, timeout, response check and test seams
 * @returns The decoded response body
 * @throws Error if the URL is invalid or internal, the transfer fails, times out or is too large, or check throws
 */
export async function fetchRemote(url: string, options: RemoteOptions): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout).unref();
    const expired = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(failure('timeout', options.messages)), {
            once: true,
        });
    });

    try {
        return await Promise.race([download(url, options, controller.signal), expired]);
    } catch (err) {
        throw controller.signal.aborted ? failure('timeout', options.messages) : err;
    } finally {
        clearTimeout(timer);
    }
}
