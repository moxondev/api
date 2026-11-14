import { strict as assert } from 'node:assert';
import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import app from '../../src/app.js';
import {
    FALLBACK_WIDTH,
    MONO_ADVANCE,
    SANS_BOLD,
    SANS_REGULAR,
    SERIF_BOLD,
    SERIF_REGULAR,
    UNITS_PER_EM,
    type WidthRanges,
} from '../../src/utils/fonts.js';

let server: Server;
let baseUrl: string;

before(() => {
    return new Promise<void>((resolve) => {
        server = app.listen(0, () => {
            const port = (server.address() as AddressInfo).port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

after(() => {
    return new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
});

async function getJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}${path}`);
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body };
}

async function sendJson(
    method: string,
    path: string,
    body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body: data };
}

/**
 * Sends a GET request through node:http, because fetch hides 304 answers and rewrites the cache headers.
 *
 * @param path - Path from the server root, query string included
 * @param headers - Request headers to send
 * @returns Status code, response headers and raw body
 */
function rawGet(
    path: string,
    headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
    return new Promise((resolve, reject) => {
        const req = request(`${baseUrl}${path}`, { headers }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Looks up the advance of a code point in a width table.
 *
 * @param table - Compact width ranges
 * @param code - Unicode code point
 * @returns The advance in font units, or undefined when the table has no entry
 */
function tableUnits(table: WidthRanges, code: number): number | undefined {
    for (const [first, widths] of table) {
        if (code >= first && code < first + widths.length) return widths[code - first];
    }
    return undefined;
}

/**
 * Computes the text length a badge must give to a text, from the exported width tables.
 *
 * @param text - Text to measure
 * @param font - Font name
 * @param weight - Weight name
 * @param fontSize - Font size in pixels
 * @returns The rounded width in pixels
 */
function expectedLength(text: string, font: string, weight: string, fontSize: number): number {
    const tables: Record<string, Record<string, WidthRanges>> = {
        sans: { normal: SANS_REGULAR, bold: SANS_BOLD },
        serif: { normal: SERIF_REGULAR, bold: SERIF_BOLD },
    };
    let units = 0;
    for (const char of text) {
        const code = char.codePointAt(0)!;
        if (font === 'mono') {
            // Mono gives one advance to every code point the tables cover, soft hyphen excepted
            const covered = tableUnits(SANS_BOLD, code) !== undefined;
            units += covered ? (code === 0xad ? 0 : MONO_ADVANCE) : FALLBACK_WIDTH;
        } else {
            units += tableUnits(tables[font]![weight]!, code) ?? FALLBACK_WIDTH;
        }
    }
    return Math.round((units / UNITS_PER_EM) * fontSize);
}

/**
 * Reads the text elements of a badge SVG.
 *
 * @param svg - SVG markup
 * @returns The font family, font weight, text length and content of each text
 */
function svgTexts(svg: string): { family: string; weight: string; length: number; content: string }[] {
    return [
        ...svg.matchAll(
            /<text\b[^>]* font-family="([^"]*)" font-weight="([^"]*)"[^>]* textLength="(\d+)">([^<]*)<\/text>/g,
        ),
    ].map((m) => ({ family: m[1]!, weight: m[2]!, length: Number(m[3]), content: m[4]! }));
}

// --- v4 endpoints ---

// --- GET endpoints ---

describe('GET / (version listing)', () => {
    test('v4 endpoints listed', async () => {
        const { body } = await getJson('/v4');
        assert.equal(body.version, 'v4');
        const endpoints = body.endpoints as Record<string, Record<string, string>>;
        assert.ok('dice' in endpoints.get!);
        assert.ok('encode' in endpoints.get!);
        assert.ok('geo' in endpoints.get!);
        assert.ok('palette' in endpoints.get!);
        assert.ok('placeholder' in endpoints.get!);
        assert.ok('statistics' in endpoints.get!);
        assert.ok('text' in endpoints.get!);
        assert.ok('validate' in endpoints.get!);
    });

    test('invalid version returns 404', async () => {
        const { status } = await getJson('/v99');
        assert.equal(status, 404);
    });
});

describe('GET /v4/algorithms', () => {
    test('fibonacci', async () => {
        const { status, body } = await getJson('/v4/algorithms?method=fibonacci&value=10');
        assert.equal(status, 200);
        assert.deepEqual(body.answer, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
    });

    test('isprime', async () => {
        const { body } = await getJson('/v4/algorithms?method=isprime&value=17');
        assert.equal(body.answer, true);
    });

    test('roman 2024 to MMXXIV', async () => {
        const { body } = await getJson('/v4/algorithms?method=roman&value=2024');
        assert.equal(body.answer, 'MMXXIV');
    });

    test('roman MMXXIV to 2024', async () => {
        const { body } = await getJson('/v4/algorithms?method=roman&value=MMXXIV');
        assert.equal(body.answer, 2024);
    });
});

describe('GET /v4/captcha', () => {
    test('returns PNG with provided text', async () => {
        const res = await fetch(`${baseUrl}/v4/captcha?text=hello`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /image\/png/);
        assert.equal(res.headers.get('x-captcha-text'), 'hello');
    });

    test('auto-generates text when none provided', async () => {
        const res = await fetch(`${baseUrl}/v4/captcha`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /image\/png/);
        assert.ok(res.headers.get('x-captcha-text')!.length > 0);
    });

    test('accepts noise and dimensions', async () => {
        const res = await fetch(`${baseUrl}/v4/captcha?text=AB&noise=high&width=200&height=80`);
        assert.equal(res.status, 200);
    });
});

describe('GET /v4/chat', () => {
    test('fetches public messages', async () => {
        await sendJson('POST', '/v4/chat', {
            username: 'get-chat-user',
            message: 'ping',
            session: `get-chat-${Date.now()}`,
        });
        const res = await fetch(`${baseUrl}/v4/chat`);
        assert.equal(res.status, 200);
        const body = (await res.json()) as { username: string; message: string }[];
        assert.ok(Array.isArray(body));
    });
});

describe('GET /v4/color', () => {
    test('returns random color formats', async () => {
        const { status, body } = await getJson('/v4/color');
        assert.equal(status, 200);
        assert.match(body.hex as string, /^#[0-9a-f]{6}$/);
        assert.ok('rgb' in body);
        assert.ok('hsl' in body);
        assert.ok('cmyk' in body);
    });

    test('accepts hex input', async () => {
        const { status, body } = await getJson('/v4/color?hex=ff6600');
        assert.equal(status, 200);
        assert.equal(body.hex, '#ff6600');
    });
});

describe('GET /v4/convert', () => {
    test('celsius to fahrenheit', async () => {
        const { status, body } = await getJson('/v4/convert?value=100&from=celsius&to=fahrenheit');
        assert.equal(status, 200);
        assert.equal(body.result, 212);
    });

    test('km to mi', async () => {
        const { status, body } = await getJson('/v4/convert?value=1&from=km&to=mi');
        assert.equal(status, 200);
        assert.ok(Math.abs((body.result as number) - 0.621371) < 0.001);
    });

    test('missing value returns 400', async () => {
        const { status } = await getJson('/v4/convert?from=celsius&to=fahrenheit');
        assert.equal(status, 400);
    });
});

describe('GET /v4/dice', () => {
    test('rolls 2d6+3', async () => {
        const { body } = await getJson('/v4/dice?roll=2d6%2B3');
        assert.equal(body.count, 2);
        assert.equal(body.sides, 6);
        assert.equal(body.modifier, 3);
    });

    test('rejects invalid notation', async () => {
        const { status } = await getJson('/v4/dice?roll=foo');
        assert.equal(status, 400);
    });
});

describe('GET /v4/domain', () => {
    test('has TLD', async () => {
        const { status, body } = await getJson('/v4/domain');
        assert.equal(status, 200);
        assert.match(body.domain as string, /\./);
    });
});

describe('GET /v4/encode', () => {
    test('base64 encode', async () => {
        const { status, body } = await getJson('/v4/encode?method=base64encode&text=hello');
        assert.equal(status, 200);
        assert.equal(body.result, 'aGVsbG8=');
    });

    test('rot13', async () => {
        const { body } = await getJson('/v4/encode?method=rot13&text=Hello');
        assert.equal(body.result, 'Uryyb');
    });

    test('missing method returns 400', async () => {
        const { status } = await getJson('/v4/encode?text=hello');
        assert.equal(status, 400);
    });
});

describe('GET /v4/geo', () => {
    test('Paris-NYC distance', async () => {
        const { body } = await getJson('/v4/geo?lat1=48.8566&lon1=2.3522&lat2=40.7128&lon2=-74.006');
        const distance = body.distance as { km: number };
        assert.ok(Math.abs(distance.km - 5837) < 50);
    });

    test('missing param returns 400', async () => {
        const { status } = await getJson('/v4/geo?lat1=0&lon1=0');
        assert.equal(status, 400);
    });
});

describe('GET /v4/infos', () => {
    test('returns API infos', async () => {
        const { status, body } = await getJson('/v4/infos');
        assert.equal(status, 200);
        assert.ok('endpoints' in body);
        assert.ok('documentation' in body);
    });
});

describe('GET /v4/levenshtein', () => {
    test('computes distance', async () => {
        const { status, body } = await getJson('/v4/levenshtein?str1=kitten&str2=sitting');
        assert.equal(status, 200);
        assert.equal(body.distance, 3);
    });
});

describe('GET /v4/palette', () => {
    test('triadic returns 3 colors', async () => {
        const { body } = await getJson('/v4/palette?color=%23ff6600&type=triadic');
        assert.equal((body.colors as unknown[]).length, 3);
    });

    test('invalid type returns 400', async () => {
        const { status } = await getJson('/v4/palette?color=%23ff6600&type=rainbow');
        assert.equal(status, 400);
    });
});

describe('GET /v4/personal', () => {
    test('returns generated identity', async () => {
        const { status, body } = await getJson('/v4/personal');
        assert.equal(status, 200);
        assert.ok('name' in body);
        assert.ok('email' in body);
        assert.ok('card' in body);
    });
});

describe('GET /v4/placeholder', () => {
    test('image returns SVG', async () => {
        const res = await fetch(`${baseUrl}/v4/placeholder?type=image&width=100&height=50`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
    });

    test('skeleton returns SVG', async () => {
        const res = await fetch(`${baseUrl}/v4/placeholder?type=skeleton&width=200&height=100`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
        const body = await res.text();
        assert.match(body, /<svg/);
    });
});

describe('GET /v4/qrcode', () => {
    test('returns PNG image by default', async () => {
        const res = await fetch(`${baseUrl}/v4/qrcode?url=https%3A%2F%2Fexample.com`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /image\/png/);
        const buf = Buffer.from(await res.arrayBuffer());
        assert.ok(buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
    });

    test('returns data URL with format=base64', async () => {
        const { status, body } = await getJson('/v4/qrcode?url=https%3A%2F%2Fexample.com&format=base64');
        assert.equal(status, 200);
        assert.match(body as unknown as string, /^data:image\/png;base64,/);
    });
});

describe('Server-side fetches refuse internal hosts', () => {
    test('qrcode icon on an internal host is refused the same way in v4, v5 and v6', async () => {
        for (const icon of [
            'https://127.0.0.2/icon.png',
            'https://[::ffff:169.254.169.254]/',
            'https://localhost./x',
        ]) {
            const query = `url=https%3A%2F%2Fexample.com&icon=${encodeURIComponent(icon)}`;
            for (const version of ['v4', 'v5', 'v6']) {
                const { status, body } = await getJson(`/${version}/qrcode?${query}`);
                assert.equal(status, 400, `${version} ${icon}`);
                assert.equal(body.error, 'Icon URL must point to a public host');
            }
        }
    });

    test('hyperplanning on an internal host is refused the same way in v4, v5 and v6', async () => {
        for (const url of ['https://127.0.0.2/a.ics', 'https://[::]/a.ics', 'https://100.64.0.1/a.ics']) {
            for (const version of ['v4', 'v5', 'v6']) {
                const { status, body } = await sendJson('POST', `/${version}/hyperplanning`, { url });
                assert.equal(status, 400, `${version} ${url}`);
                assert.equal(body.error, 'Access to private/internal hosts is not allowed.');
            }
        }
    });
});

describe('GET /v4/statistics', () => {
    test('basic stats', async () => {
        const { body } = await getJson('/v4/statistics?values=1,2,3,4,5');
        assert.equal(body.mean, 3);
        assert.equal(body.median, 3);
        assert.equal(body.count, 5);
    });

    test('missing values returns 400', async () => {
        const { status } = await getJson('/v4/statistics');
        assert.equal(status, 400);
    });
});

describe('GET /v4/text', () => {
    test('slug', async () => {
        const { body } = await getJson('/v4/text?method=slug&value=Hello%20World');
        assert.equal(body.result, 'hello-world');
    });

    test('number en', async () => {
        const { body } = await getJson('/v4/text?method=number&value=42&lang=en');
        assert.equal(body.result, 'forty-two');
    });

    test('lorem words', async () => {
        const { body } = await getJson('/v4/text?method=lorem&type=words&count=5');
        assert.equal((body.result as string).split(' ').length, 5);
    });
});

describe('GET /v4/time', () => {
    test('live', async () => {
        const { status, body } = await getJson('/v4/time');
        assert.equal(status, 200);
        assert.ok('iso' in body);
        assert.ok('timestamp' in body);
    });

    test('random in range', async () => {
        const { status, body } = await getJson('/v4/time?type=random&start=2020-01-01&end=2020-12-31');
        assert.equal(status, 200);
        const ts = body.timestamp as number;
        assert.ok(ts >= new Date('2020-01-01').getTime());
        assert.ok(ts <= new Date('2020-12-31').getTime());
    });

    test('countdown future returns direction and remaining', async () => {
        const future = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
        const { status, body } = await getJson(`/v4/time?type=countdown&target=${encodeURIComponent(future)}`);
        assert.equal(status, 200);
        assert.equal(body.direction, 'future');
        assert.ok(typeof body.human === 'string');
    });

    test('countdown missing target returns 400', async () => {
        const { status } = await getJson('/v4/time?type=countdown');
        assert.equal(status, 400);
    });
});

describe('GET /v4/username', () => {
    test('has fields', async () => {
        const { status, body } = await getJson('/v4/username');
        assert.equal(status, 200);
        assert.ok('username' in body);
        assert.ok('adjective' in body);
        assert.ok('animal' in body);
    });
});

describe('GET /v4/validate', () => {
    test('valid luhn', async () => {
        const { body } = await getJson('/v4/validate?type=luhn&value=4111111111111111');
        assert.equal(body.valid, true);
    });

    test('valid email', async () => {
        const { body } = await getJson('/v4/validate?type=email&value=hello%40example.com');
        assert.equal(body.valid, true);
    });

    test('invalid type returns 400', async () => {
        const { status } = await getJson('/v4/validate?type=foo&value=bar');
        assert.equal(status, 400);
    });
});

// --- POST endpoints ---

describe('POST /v4/chat', () => {
    const session = `chat-${Date.now()}`;

    test('sends a public message', async () => {
        const { status, body } = await sendJson('POST', '/v4/chat', {
            username: 'alice',
            message: 'public hello',
            session,
        });
        assert.equal(status, 200);
        assert.match(body.message as string, /sent/);
    });

    test('fetches private chat (legacy)', async () => {
        const token = `tok-${Date.now()}`;
        await sendJson('POST', '/v4/chat', {
            username: 'bob',
            message: 'secret',
            session: `chat-bob-${Date.now()}`,
            token,
        });
        const { status, body } = await sendJson('POST', '/v4/chat/private', {
            username: 'bob',
            token,
        });
        assert.equal(status, 200);
        assert.ok(Array.isArray(body));
    });
});

describe('POST /v4/hash', () => {
    test('sha256', async () => {
        const { status, body } = await sendJson('POST', '/v4/hash', { text: 'hello', method: 'sha256' });
        assert.equal(status, 200);
        assert.equal(body.hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
        assert.equal(body.encoding, 'hex');
    });

    test('md5', async () => {
        const { body } = await sendJson('POST', '/v4/hash', { text: 'hello', method: 'md5' });
        assert.equal(body.hash, '5d41402abc4b2a76b9719d911017c592');
    });

    test('base64 encoding', async () => {
        const { status, body } = await sendJson('POST', '/v4/hash', {
            text: 'hello',
            method: 'sha256',
            encoding: 'base64',
        });
        assert.equal(status, 200);
        assert.equal(body.encoding, 'base64');
    });

    test('unsupported method returns 400', async () => {
        const { status } = await sendJson('POST', '/v4/hash', { text: 'hello', method: 'fakehash' });
        assert.equal(status, 400);
    });

    test('missing text returns 400', async () => {
        const { status } = await sendJson('POST', '/v4/hash', { method: 'sha256' });
        assert.equal(status, 400);
    });
});

describe('POST /v4/tic-tac-toe', () => {
    const game = 'TTT' + Date.now().toString(36).slice(-3).toUpperCase();
    const session = `ttt-${Date.now()}`;

    test('list returns games', async () => {
        const { status, body } = await sendJson('POST', '/v4/tic-tac-toe/list', {});
        assert.equal(status, 200);
        assert.ok(Array.isArray(body.games));
    });

    test('plays a move', async () => {
        const { status, body } = await sendJson('POST', '/v4/tic-tac-toe', {
            username: 'alice',
            move: '1-1',
            session,
            game,
        });
        assert.equal(status, 200);
        assert.match(body.message as string, /Move sent/);
    });

    test('fetch returns game state', async () => {
        const { status, body } = await sendJson('POST', '/v4/tic-tac-toe/fetch', {
            username: 'alice',
            game,
        });
        assert.equal(status, 200);
        assert.equal(body.id, game);
    });

    test('missing move returns 400', async () => {
        const { status } = await sendJson('POST', '/v4/tic-tac-toe', {
            username: 'alice',
            session,
            game,
        });
        assert.equal(status, 400);
    });
});

describe('POST /v4/token', () => {
    test('alpha 24', async () => {
        const { status, body } = await sendJson('POST', '/v4/token', { len: 24, type: 'alpha' });
        assert.equal(status, 200);
        assert.equal(typeof body.token, 'string');
        assert.equal((body.token as string).length, 24);
        assert.match(body.token as string, /^[a-zA-Z]+$/);
    });

    test('below min length returns 400', async () => {
        const { status } = await sendJson('POST', '/v4/token', { len: 5, type: 'alpha' });
        assert.equal(status, 400);
    });
});

// --- PATCH endpoints ---

describe('PATCH /v4/tic-tac-toe/:game', () => {
    const game = 'PAT' + Date.now().toString(36).slice(-3).toUpperCase();
    const session = `patch-${Date.now()}`;

    test('plays a move on an existing game', async () => {
        await sendJson('POST', '/v4/tic-tac-toe', {
            username: 'patch-p1',
            move: '1-1',
            session,
            game,
        });
        const { status, body } = await sendJson('PATCH', `/v4/tic-tac-toe/${game}`, {
            username: 'patch-p2',
            move: '2-2',
            session: `${session}-p2`,
        });
        assert.equal(status, 200);
        assert.match(body.message as string, /Move sent/);
    });

    test('missing move returns 400', async () => {
        const { status } = await sendJson('PATCH', `/v4/tic-tac-toe/${game}`, {
            username: 'patch-p2',
            session: `${session}-p2`,
        });
        assert.equal(status, 400);
    });

    test('the removed v3 returns 404', async () => {
        const { status } = await sendJson('PATCH', `/v3/tic-tac-toe/${game}`, {
            username: 'patch-p1',
            move: '3-3',
            session,
        });
        assert.equal(status, 404);
    });
});

// --- DELETE endpoints ---

describe('DELETE /v4/tic-tac-toe/:game', () => {
    test('forfeits a game', async () => {
        const game = 'DEL' + Date.now().toString(36).slice(-3).toUpperCase();
        const session = `del-ttt-${Date.now()}`;
        await sendJson('POST', '/v4/tic-tac-toe', {
            username: 'del-quitter',
            move: '1-1',
            session,
            game,
        });
        await sendJson('POST', '/v4/tic-tac-toe/fetch', {
            username: 'del-quitter',
            game,
        });
        const { status, body } = await sendJson('DELETE', `/v4/tic-tac-toe/${game}`, {
            username: 'del-quitter',
            session,
        });
        assert.equal(status, 200);
        assert.match(body.message as string, /forfeited/);
        assert.equal(body.loser, 'del-quitter');
    });

    test('unknown game returns 400', async () => {
        const { status } = await sendJson('DELETE', '/v4/tic-tac-toe/NOPE42', {
            username: 'del-quitter',
            session: `del-ttt-${Date.now()}`,
        });
        assert.equal(status, 400);
    });

    test('missing username returns 400', async () => {
        const { status } = await sendJson('DELETE', '/v4/tic-tac-toe/NOPE42', {
            session: `del-ttt-${Date.now()}`,
        });
        assert.equal(status, 400);
    });

    test('the removed v3 returns 404', async () => {
        const { status } = await sendJson('DELETE', '/v3/tic-tac-toe/NOPE42', {
            username: 'del-quitter',
            session: `del-ttt-${Date.now()}`,
        });
        assert.equal(status, 404);
    });
});

describe('DELETE /v4/chat/:token', () => {
    test('clears a private chat', async () => {
        const token = `del-tok-${Date.now()}`;
        const session = `del-chat-${Date.now()}`;
        await sendJson('POST', '/v4/chat', {
            username: 'del-clearer',
            message: 'secret to clear',
            session,
            token,
        });
        const { status, body } = await sendJson('DELETE', `/v4/chat/${token}`, {
            username: 'del-clearer',
            session,
        });
        assert.equal(status, 200);
        assert.match(body.message as string, /cleared/);
    });

    test('invalid token returns 400', async () => {
        const { status } = await sendJson('DELETE', '/v4/chat/unknown-token', {
            username: 'del-clearer2',
            session: `del-chat-${Date.now()}`,
        });
        assert.equal(status, 400);
    });

    test('missing username returns 400', async () => {
        const { status } = await sendJson('DELETE', '/v4/chat/some-token', {
            session: `del-chat-${Date.now()}`,
        });
        assert.equal(status, 400);
    });

    test('the removed v3 returns 404', async () => {
        const { status } = await sendJson('DELETE', '/v3/chat/some-token', {
            username: 'del-clearer',
            session: `del-chat-${Date.now()}`,
        });
        assert.equal(status, 404);
    });
});

// --- Security ---

describe('Security headers', () => {
    test('returns X-Content-Type-Options and X-Frame-Options', async () => {
        const res = await fetch(`${baseUrl}/v4/color`);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
    });
});

describe('Payload size limit', () => {
    test('body > 10kb returns 413', async () => {
        const res = await fetch(`${baseUrl}/v4/hash`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'A'.repeat(20000), method: 'sha256' }),
        });
        assert.equal(res.status, 413);
    });
});

describe('GET /v4/headers', () => {
    test('returns headers object with count, ip, method, url', async () => {
        const { status, body } = await getJson('/v4/headers');
        assert.equal(status, 200);
        assert.ok(typeof body.count === 'number');
        assert.ok(typeof body.headers === 'object');
        assert.ok('method' in body);
        assert.equal(body.method, 'GET');
        assert.ok((body.url as string).includes('/v4/headers'));
    });

    test('filter param returns only matching headers', async () => {
        const { body } = await getJson('/v4/headers?filter=host');
        const headers = body.headers as Record<string, unknown>;
        assert.ok('host' in headers);
        assert.equal(body.count, 1);
    });

    test('cookie header is redacted', async () => {
        const res = await fetch(`${baseUrl}/v4/headers`, {
            headers: { Cookie: 'session=secret123' },
        });
        const body = (await res.json()) as Record<string, unknown>;
        const headers = body.headers as Record<string, unknown>;
        assert.equal(headers['cookie'], '[redacted]');
    });
});

describe('GET /v4/ip', () => {
    test('returns valid ip result with no address param', async () => {
        const { status, body } = await getJson('/v4/ip');
        assert.equal(status, 200);
        assert.ok(['IPv4', 'IPv6'].includes(body.version as string));
        assert.ok(typeof body.binary === 'string');
        assert.ok(typeof body.reverse === 'string');
    });

    test('loopback 127.0.0.1', async () => {
        const { status, body } = await getJson('/v4/ip?address=127.0.0.1');
        assert.equal(status, 200);
        assert.equal(body.type, 'loopback');
        assert.equal(body.version, 'IPv4');
    });

    test('private 192.168.1.1', async () => {
        const { body } = await getJson('/v4/ip?address=192.168.1.1');
        assert.equal(body.type, 'private');
        assert.equal(body.decimal, 3232235777);
    });

    test('invalid address returns 400', async () => {
        const { status } = await getJson('/v4/ip?address=notanip');
        assert.equal(status, 400);
    });
});

describe('GET /v4/agent', () => {
    test('returns parsed result with browser, os, device, engine, bot', async () => {
        const { status, body } = await getJson('/v4/agent');
        assert.equal(status, 200);
        assert.ok(typeof body.browser === 'object');
        assert.ok(typeof body.os === 'object');
        assert.ok(typeof body.device === 'object');
        assert.ok(typeof body.engine === 'object');
        assert.ok(typeof body.bot === 'boolean');
    });

    test('custom ua param is parsed', async () => {
        const ua = encodeURIComponent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        );
        const { body } = await getJson(`/v4/agent?ua=${ua}`);
        const browser = body.browser as Record<string, string>;
        assert.equal(browser.name, 'Firefox');
        assert.equal(browser.major, '121');
    });

    test('bot ua detected', async () => {
        const ua = encodeURIComponent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
        const { body } = await getJson(`/v4/agent?ua=${ua}`);
        assert.equal(body.bot, true);
    });
});

describe('GET /v4/address', () => {
    test('returns one address by default', async () => {
        const { status, body } = await getJson('/v4/address');
        assert.equal(status, 200);
        assert.equal((body.addresses as unknown[]).length, 1);
    });

    test('country=fr returns a French address', async () => {
        const { body } = await getJson('/v4/address?country=fr');
        const a = (body.addresses as Record<string, string>[])[0]!;
        assert.equal(a.countryCode, 'FR');
    });

    test('count=3 returns 3 addresses', async () => {
        const { body } = await getJson('/v4/address?count=3');
        assert.equal((body.addresses as unknown[]).length, 3);
    });

    test('unknown country returns 400', async () => {
        const { status } = await getJson('/v4/address?country=xx');
        assert.equal(status, 400);
    });
});

describe('GET /v4/password', () => {
    test('returns one password by default', async () => {
        const { status, body } = await getJson('/v4/password');
        assert.equal(status, 200);
        assert.equal((body.passwords as string[]).length, 1);
        assert.equal((body.passwords as string[])[0]!.length, 16);
    });

    test('length param is respected', async () => {
        const { body } = await getJson('/v4/password?length=32');
        assert.equal((body.passwords as string[])[0]!.length, 32);
    });

    test('passphrase mode returns words', async () => {
        const { body } = await getJson('/v4/password?type=passphrase&length=4');
        assert.equal(body.type, 'passphrase');
        assert.equal((body.passwords as string[])[0]!.split('-').length, 4);
    });

    test('count=5 returns 5 passwords', async () => {
        const { body } = await getJson('/v4/password?count=5');
        assert.equal((body.passwords as string[]).length, 5);
    });

    test('no charset active returns 400', async () => {
        const { status } = await getJson('/v4/password?uppercase=false&lowercase=false&digits=false&symbols=false');
        assert.equal(status, 400);
    });
});

describe('GET /v4/cron', () => {
    test('returns next dates for * * * * *', async () => {
        const { status, body } = await getJson('/v4/cron?expr=*%20*%20*%20*%20*');
        assert.equal(status, 200);
        assert.equal((body.next as string[]).length, 5);
        assert.ok(typeof body.description === 'string');
    });

    test('count param is respected', async () => {
        const { body } = await getJson('/v4/cron?expr=*%20*%20*%20*%20*&count=3');
        assert.equal((body.next as string[]).length, 3);
    });

    test('invalid expression returns 400', async () => {
        const { status } = await getJson('/v4/cron?expr=invalid');
        assert.equal(status, 400);
    });

    test('missing expr returns 400', async () => {
        const { status } = await getJson('/v4/cron');
        assert.equal(status, 400);
    });
});

describe('GET /v6/cron', () => {
    test('0 12 1 6 * in Europe/Paris returns both June dates', async () => {
        const { status, body } = await getJson(
            '/v6/cron?expr=0%2012%201%206%20*&count=2&from=2026-01-01T00:00:00Z&timezone=Europe/Paris',
        );
        assert.equal(status, 200);
        assert.deepEqual(body.next, ['2026-06-01T10:00:00.000Z', '2027-06-01T10:00:00.000Z']);
    });

    test('never-matching 0 0 31 2 * returns 200 with no dates', async () => {
        const start = Date.now();
        const { status, body } = await getJson('/v6/cron?expr=0%200%2031%202%20*');
        assert.equal(status, 200);
        assert.deepEqual(body.next, []);
        assert.ok(Date.now() - start < 1000);
    });

    test('UTC output matches v4', async () => {
        const query = '/cron?expr=*%2F15%209-17%20*%20*%201-5&count=20&from=2026-01-05T08:45:00Z';
        const v4 = await getJson(`/v4${query}`);
        const v6 = await getJson(`/v6${query}`);
        assert.equal(v6.status, 200);
        assert.deepEqual(v6.body, v4.body);
    });

    test('invalid expression returns the v4 error', async () => {
        const v4 = await getJson('/v4/cron?expr=60%20*%20*%20*%20*');
        const v6 = await getJson('/v6/cron?expr=60%20*%20*%20*%20*');
        assert.equal(v6.status, 400);
        assert.deepEqual(v6.body, v4.body);
    });
});

describe('GET /v4/cron time budget', () => {
    test('never-matching 0 0 31 2 * returns 200 with no dates without hanging', async () => {
        const start = Date.now();
        const { status, body } = await getJson('/v4/cron?expr=0%200%2031%202%20*');
        assert.equal(status, 200);
        assert.deepEqual(body.next, []);
        assert.ok(Date.now() - start < 5000);
    });
});

describe('GET /v4/regex', () => {
    test('basic match returns count and matches', async () => {
        const { status, body } = await getJson('/v4/regex?pattern=hello&text=hello%20world');
        assert.equal(status, 200);
        assert.equal(body.valid, true);
        assert.ok((body.count as number) >= 1);
    });

    test('invalid pattern returns valid: false with 200', async () => {
        const { status, body } = await getJson('/v4/regex?pattern=%5Binvalid&text=hello');
        assert.equal(status, 200);
        assert.equal(body.valid, false);
    });

    test('missing pattern returns 400', async () => {
        const { status } = await getJson('/v4/regex?text=hello');
        assert.equal(status, 400);
    });

    test('a normal pattern gets the same body in v4, v5 and v6', async () => {
        const query = `pattern=${encodeURIComponent('(?<y>\\d{4})-(\\d{2})|(x)')}&text=2026-05%20x&flags=i`;
        const expected = JSON.stringify({
            valid: true,
            pattern: '(?<y>\\d{4})-(\\d{2})|(x)',
            flags: 'gi',
            matches: [
                { match: '2026-05', index: 0, groups: ['2026', '05', ''], namedGroups: { y: '2026' } },
                { match: 'x', index: 8, groups: ['', '', 'x'], namedGroups: {} },
            ],
            count: 2,
        });
        for (const version of ['v4', 'v5', 'v6']) {
            const res = await fetch(`${baseUrl}/${version}/regex?${query}`);
            assert.equal(res.status, 200);
            assert.equal(JSON.stringify(await res.json()), expected);
        }
    });

    test('catastrophic backtracking returns 400 quickly in every version', async () => {
        const query = `pattern=${encodeURIComponent('(a+)+$')}&text=${'a'.repeat(32)}b`;
        for (const version of ['v4', 'v5', 'v6']) {
            const start = Date.now();
            const { status, body } = await getJson(`/${version}/regex?${query}`);
            assert.equal(status, 400);
            assert.equal(body.error, 'Pattern took too long to evaluate');
            assert.ok(Date.now() - start < 2000);
        }
        assert.equal((await getJson('/v6/regex?pattern=a&text=a')).status, 200);
    });
});

describe('GET /v4/barcode', () => {
    test('returns SVG by default', async () => {
        const res = await fetch(`${baseUrl}/v4/barcode?data=Hello123`);
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('image/svg+xml'));
        const text = await res.text();
        assert.ok(text.includes('<svg'));
    });

    test('EAN-13 with 12 digits auto-calculates check digit', async () => {
        const res = await fetch(`${baseUrl}/v4/barcode?data=978030640615&type=ean13`);
        assert.equal(res.status, 200);
    });

    test('PNG format returns image/png', async () => {
        const res = await fetch(`${baseUrl}/v4/barcode?data=Hello&format=png`);
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('image/png'));
    });

    test('missing data returns 400', async () => {
        const { status } = await getJson('/v4/barcode');
        assert.equal(status, 400);
    });

    test('invalid type returns 400', async () => {
        const { status } = await getJson('/v4/barcode?data=test&type=qr');
        assert.equal(status, 400);
    });
});

describe('GET /v6/badge', () => {
    test('returns an SVG with the expected content type', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=Nouveau`);
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('image/svg+xml'));
        const text = await res.text();
        assert.ok(text.startsWith('<svg'));
        assert.ok(text.includes('>Nouveau</text>'));
    });

    test('sets the cache and hardening headers', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=Nouveau`);
        assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
        assert.equal(res.headers.get('content-security-policy'), "default-src 'none'");
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    });

    test('sends an ETag and answers a matching If-None-Match with 304', async () => {
        const first = await rawGet('/v6/badge?label=Nouveau');
        assert.equal(first.status, 200);
        const etag = first.headers.etag as string;
        assert.ok(etag);
        const second = await rawGet('/v6/badge?label=Nouveau', { 'If-None-Match': etag });
        assert.equal(second.status, 304);
        assert.equal(second.body, '');
        assert.equal(second.headers['cache-control'], 'public, max-age=86400');
        const other = await rawGet('/v6/badge?label=Nouveau', { 'If-None-Match': 'W/"stale"' });
        assert.equal(other.status, 200);
    });

    test('a different query gives a different ETag', async () => {
        const a = await rawGet('/v6/badge?label=Nouveau');
        const b = await rawGet('/v6/badge?label=Ancien');
        assert.notEqual(a.headers.etag, b.headers.etag);
    });

    test('same query is deterministic', async () => {
        const [a, b] = await Promise.all([
            fetch(`${baseUrl}/v6/badge?label=Nouveau&icon=sparkles`).then((r) => r.text()),
            fetch(`${baseUrl}/v6/badge?label=Nouveau&icon=sparkles`).then((r) => r.text()),
        ]);
        assert.equal(a, b);
    });

    test('HEAD answers with the headers and no body', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=Nouveau`, { method: 'HEAD' });
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('image/svg+xml'));
        assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
        assert.equal(await res.text(), '');
    });

    test('every parameter goes through the query string', async () => {
        const query = [
            'label=Nouveau',
            'icon=sparkles',
            'trail=arrow-right',
            'start=%23112233',
            'end=%23445566',
            'ink=%23ff0000',
            'border=%23abcdef',
            'size=lg',
            'lift=3',
        ].join('&');
        const res = await fetch(`${baseUrl}/v6/badge?${query}`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('stop-color="#112233"'));
        assert.ok(text.includes('stop-color="#445566"'));
        assert.ok(text.includes('fill="#ff0000"'));
        assert.ok(text.includes('stroke="#abcdef"'));
        assert.ok(text.includes('height="34"'));
        assert.ok(text.includes('font-size="13"'));
        assert.equal(text.split('<g transform=').length - 1, 2);
    });

    test('hex colors work with %23 and without the #', async () => {
        const encoded = await (await fetch(`${baseUrl}/v6/badge?label=a&start=%2316a34a&end=%2315803d`)).text();
        const bare = await (await fetch(`${baseUrl}/v6/badge?label=a&start=16a34a&end=15803d`)).text();
        assert.ok(encoded.includes('stop-color="#16a34a"'));
        assert.ok(encoded.includes('stop-color="#15803d"'));
        assert.equal(encoded, bare);
        const short = await (await fetch(`${baseUrl}/v6/badge?label=a&start=fff`)).text();
        assert.ok(short.includes('stop-color="#fff"'));
    });

    test('end defaults to start', async () => {
        const text = await (await fetch(`${baseUrl}/v6/badge?label=a&start=%23123456`)).text();
        assert.equal(text.split('stop-color="#123456"').length - 1, 2);
    });

    test('lift adds height around the pill', async () => {
        const plain = await (await fetch(`${baseUrl}/v6/badge?label=a&size=sm`)).text();
        const lifted = await (await fetch(`${baseUrl}/v6/badge?label=a&size=sm&lift=4`)).text();
        assert.ok(plain.includes('height="20"'));
        assert.ok(lifted.includes('height="28"'));
    });

    test('a URL-encoded accented label is decoded', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=${encodeURIComponent('Équipe créée')}`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('>Équipe créée</text>'));
        assert.ok(text.includes('aria-label="Équipe créée"'));
    });

    test('markup in the label is escaped', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=${encodeURIComponent('<b>&"x"</b>')}`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(!text.includes('<b>'));
        assert.ok(text.includes('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;'));
    });

    test('a label of exactly 64 characters is accepted', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=${'a'.repeat(64)}`);
        assert.equal(res.status, 200);
    });

    test('a message renders a second part inside a clipped group', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=Nouveau&message=v6`);
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('image/svg+xml'));
        const text = await res.text();
        assert.ok(text.startsWith('<svg'));
        assert.ok(text.includes('>Nouveau</text>'));
        assert.ok(text.includes('>v6</text>'));
        assert.ok(text.includes('<clipPath id="c-'));
        assert.ok(text.includes('<g clip-path="url(#c-'));
        assert.equal(text.split('<linearGradient').length - 1, 2);
        assert.ok(text.includes('<title>Nouveau: v6</title>'));
        assert.ok(text.includes('aria-label="Nouveau: v6"'));
    });

    test('an empty message gives the single part badge', async () => {
        const single = await (await fetch(`${baseUrl}/v6/badge?label=Nouveau`)).text();
        const empty = await (await fetch(`${baseUrl}/v6/badge?label=Nouveau&message=`)).text();
        assert.equal(empty, single);
        assert.ok(!empty.includes('<clipPath'));
    });

    test('a message badge is wider than the single part badge', async () => {
        const single = await (await fetch(`${baseUrl}/v6/badge?label=Nouveau`)).text();
        const double = await (await fetch(`${baseUrl}/v6/badge?label=Nouveau&message=v6`)).text();
        const widthOf = (svg: string): number => Number(svg.match(/<svg[^>]* width="([\d.]+)"/)![1]);
        assert.ok(widthOf(double) > widthOf(single));
    });

    test('message, messageStart, messageEnd and messageInk go through the query string', async () => {
        const query = [
            'label=Nouveau',
            'message=v6',
            'messageStart=%23112233',
            'messageEnd=%23445566',
            'messageInk=%23ff0000',
        ].join('&');
        const res = await fetch(`${baseUrl}/v6/badge?${query}`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('id="m-112233-445566"'));
        assert.ok(text.includes('stop-color="#112233"'));
        assert.ok(text.includes('stop-color="#445566"'));
        assert.ok(text.includes('fill="#ff0000"'));
        assert.ok(text.includes('fill="url(#m-112233-445566)"'));
    });

    test('the message part defaults to blue and to the ink of the label', async () => {
        const text = await (await fetch(`${baseUrl}/v6/badge?label=a&message=b&ink=%23abcdef`)).text();
        assert.equal(text.split('stop-color="#0969da"').length - 1, 2);
        assert.ok(text.includes('id="m-0969da-0969da"'));
        assert.equal(text.split('fill="#abcdef"').length - 1, 2);
    });

    test('messageEnd defaults to messageStart', async () => {
        const text = await (await fetch(`${baseUrl}/v6/badge?label=a&message=b&messageStart=%23123456`)).text();
        assert.equal(text.split('stop-color="#123456"').length - 1, 2);
    });

    test('the trailing icon follows the message', async () => {
        const text = await (
            await fetch(`${baseUrl}/v6/badge?label=a&message=b&trail=arrow-right&messageInk=%23ff0000`)
        ).text();
        assert.equal(text.split('<g transform=').length - 1, 1);
        assert.ok(text.includes('stroke="#ff0000"'));
    });

    test('a border on a message badge is drawn as a stroke rect on top', async () => {
        const text = await (await fetch(`${baseUrl}/v6/badge?label=a&message=b&border=%23abcdef`)).text();
        assert.ok(text.includes('fill="none" stroke="#abcdef"'));
        assert.ok(text.indexOf('</g>') < text.indexOf('fill="none"'));
    });

    test('a message of exactly 64 characters is accepted', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=a&message=${'b'.repeat(64)}`);
        assert.equal(res.status, 200);
    });

    test('a URL-encoded accented message is decoded and markup is escaped', async () => {
        const accented = await fetch(`${baseUrl}/v6/badge?label=a&message=${encodeURIComponent('créée')}`);
        assert.equal(accented.status, 200);
        assert.ok((await accented.text()).includes('>créée</text>'));
        const markup = await fetch(`${baseUrl}/v6/badge?label=a&message=${encodeURIComponent('<b>&"x"</b>')}`);
        assert.equal(markup.status, 200);
        const text = await markup.text();
        assert.ok(!text.includes('<b>'));
        assert.ok(text.includes('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;'));
    });

    test('the message badge is cached and deterministic', async () => {
        const first = await rawGet('/v6/badge?label=a&message=b');
        const again = await rawGet('/v6/badge?label=a&message=b');
        const other = await rawGet('/v6/badge?label=a&message=c');
        assert.equal(first.headers['cache-control'], 'public, max-age=86400');
        assert.equal(first.body, again.body);
        assert.equal(first.headers.etag, again.headers.etag);
        assert.notEqual(first.headers.etag, other.headers.etag);
    });

    test('radius sets the corner rounding of a single part badge', async () => {
        const pill = await (await fetch(`${baseUrl}/v6/badge?label=a`)).text();
        const round = await (await fetch(`${baseUrl}/v6/badge?label=a&radius=4`)).text();
        const square = await (await fetch(`${baseUrl}/v6/badge?label=a&radius=0`)).text();
        assert.ok(pill.includes('rx="10"'));
        assert.ok(round.includes('rx="4"'));
        assert.ok(square.includes('rx="0"'));
    });

    test('a radius above half the height is clamped to a pill', async () => {
        const pill = await (await fetch(`${baseUrl}/v6/badge?label=a`)).text();
        const big = await (await fetch(`${baseUrl}/v6/badge?label=a&radius=100`)).text();
        assert.equal(big, pill);
    });

    test('radius with two decimals is accepted and applies to the clip of a message badge', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=a&message=b&radius=3.25`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('rx="3.25"'));
        assert.ok(text.includes('id="c-'));
        assert.ok(text.includes('-20-3.25"'));
    });

    test('angle sets the gradient direction', async () => {
        const corner = await (await fetch(`${baseUrl}/v6/badge?label=a`)).text();
        const across = await (await fetch(`${baseUrl}/v6/badge?label=a&angle=90`)).text();
        const down = await (await fetch(`${baseUrl}/v6/badge?label=a&angle=180`)).text();
        assert.ok(corner.includes('x1="0" y1="0" x2="1" y2="1"'));
        assert.ok(across.includes('x1="0" y1="0.5" x2="1" y2="0.5"'));
        assert.ok(across.includes('id="g-2d333b-2d333b-90"'));
        assert.ok(down.includes('x1="0.5" y1="0" x2="0.5" y2="1"'));
        assert.ok(down.includes('id="g-2d333b-2d333b-180"'));
    });

    test('angle is rounded to whole degrees and applies to both parts', async () => {
        const rounded = await (await fetch(`${baseUrl}/v6/badge?label=a&message=b&angle=45.6`)).text();
        const whole = await (await fetch(`${baseUrl}/v6/badge?label=a&message=b&angle=46`)).text();
        assert.equal(rounded, whole);
        assert.ok(rounded.includes('id="g-2d333b-2d333b-46"'));
        assert.ok(rounded.includes('id="m-0969da-0969da-46"'));
    });

    test('angle 0 and angle 360 are accepted', async () => {
        for (const angle of ['0', '360']) {
            const res = await fetch(`${baseUrl}/v6/badge?label=a&angle=${angle}`);
            assert.equal(res.status, 200);
            assert.ok((await res.text()).includes(`-${angle}"`));
        }
    });

    test('lift, radius and angle accept the largest allowed values', async () => {
        const res = await fetch(`${baseUrl}/v6/badge?label=a&lift=10&radius=100&angle=360`);
        assert.equal(res.status, 200);
    });

    describe('font and weight', () => {
        const stacks: Record<string, string> = {
            sans: 'Verdana,DejaVu Sans,Geneva,sans-serif',
            serif: 'Georgia,DejaVu Serif,Times New Roman,serif',
            mono: 'Menlo,DejaVu Sans Mono,Consolas,monospace',
        };
        const weights: Record<string, string> = { normal: '400', bold: '600' };
        // The default size is sm, drawn at 11 pixels
        const fontSize = 11;
        const label = 'Nouveau Wiki';
        const message = 'v6 mmm';

        test('the default is the sans bold face', async () => {
            const text = await (await fetch(`${baseUrl}/v6/badge?label=${label}`)).text();
            assert.ok(text.includes(`font-family="${stacks.sans}" font-weight="600"`));
            const [first] = svgTexts(text);
            assert.equal(first!.length, expectedLength(label, 'sans', 'bold', fontSize));
        });

        test('explicit sans and bold give the same bytes as the default', async () => {
            const bare = await (await fetch(`${baseUrl}/v6/badge?label=${label}&message=${message}`)).text();
            const explicit = await (
                await fetch(`${baseUrl}/v6/badge?label=${label}&message=${message}&font=sans&weight=bold`)
            ).text();
            assert.equal(explicit, bare);
            const sansOnly = await (
                await fetch(`${baseUrl}/v6/badge?label=${label}&message=${message}&font=sans`)
            ).text();
            assert.equal(sansOnly, bare);
            const boldOnly = await (
                await fetch(`${baseUrl}/v6/badge?label=${label}&message=${message}&weight=bold`)
            ).text();
            assert.equal(boldOnly, bare);
        });

        for (const font of ['sans', 'serif', 'mono']) {
            for (const weight of ['normal', 'bold']) {
                test(`${font} ${weight} is drawn with its stack, weight and measured width on both parts`, async () => {
                    const res = await fetch(
                        `${baseUrl}/v6/badge?label=${label}&message=${message}&font=${font}&weight=${weight}`,
                    );
                    assert.equal(res.status, 200);
                    assert.ok(res.headers.get('content-type')?.includes('image/svg+xml'));
                    const parts = svgTexts(await res.text());
                    assert.equal(parts.length, 2);
                    assert.deepEqual(
                        parts.map((part) => [part.family, part.weight, part.length, part.content]),
                        [
                            [stacks[font], weights[weight], expectedLength(label, font, weight, fontSize), label],
                            [stacks[font], weights[weight], expectedLength(message, font, weight, fontSize), message],
                        ],
                    );
                });
            }
        }

        test('the text length depends on the font for the same label', async () => {
            const lengths: Record<string, number> = {};
            for (const font of ['sans', 'serif', 'mono']) {
                const [part] = svgTexts(await (await fetch(`${baseUrl}/v6/badge?label=${label}&font=${font}`)).text());
                lengths[font] = part!.length;
            }
            assert.equal(new Set(Object.values(lengths)).size, 3, JSON.stringify(lengths));
        });

        test('the text length depends on the weight for a proportional font', async () => {
            for (const font of ['sans', 'serif']) {
                const normal = svgTexts(
                    await (await fetch(`${baseUrl}/v6/badge?label=${label}&font=${font}&weight=normal`)).text(),
                );
                const bold = svgTexts(
                    await (await fetch(`${baseUrl}/v6/badge?label=${label}&font=${font}&weight=bold`)).text(),
                );
                assert.notEqual(normal[0]!.length, bold[0]!.length, font);
            }
        });

        test('mono has the same width in both weights and a fixed advance per character', async () => {
            const normal = svgTexts(
                await (await fetch(`${baseUrl}/v6/badge?label=iiiiWWWW&font=mono&weight=normal`)).text(),
            );
            const bold = svgTexts(
                await (await fetch(`${baseUrl}/v6/badge?label=iiiiWWWW&font=mono&weight=bold`)).text(),
            );
            assert.equal(normal[0]!.length, bold[0]!.length);
            // Eight characters of 1233 units at 11 pixels
            assert.equal(normal[0]!.length, Math.round((8 * 1233 * fontSize) / 2048));
        });

        test('the badge width follows the font', async () => {
            const widthOf = (svg: string): number => Number(svg.match(/<svg[^>]* width="([\d.]+)"/)![1]);
            const sans = widthOf(await (await fetch(`${baseUrl}/v6/badge?label=${label}&font=sans`)).text());
            const mono = widthOf(await (await fetch(`${baseUrl}/v6/badge?label=${label}&font=mono`)).text());
            const sansLength = expectedLength(label, 'sans', 'bold', fontSize);
            const monoLength = expectedLength(label, 'mono', 'bold', fontSize);
            assert.equal(mono - sans, monoLength - sansLength);
        });

        test('the size sets the font size the widths are measured at', async () => {
            const text = await (
                await fetch(`${baseUrl}/v6/badge?label=${label}&font=serif&weight=normal&size=lg`)
            ).text();
            assert.ok(text.includes('font-size="13"'));
            assert.equal(svgTexts(text)[0]!.length, expectedLength(label, 'serif', 'normal', 13));
        });

        test('font and weight change the ETag and the body', async () => {
            const base = await rawGet(`/v6/badge?label=${label}`);
            const serif = await rawGet(`/v6/badge?label=${label}&font=serif`);
            const normal = await rawGet(`/v6/badge?label=${label}&weight=normal`);
            assert.notEqual(base.body, serif.body);
            assert.notEqual(base.body, normal.body);
            assert.notEqual(serif.body, normal.body);
            assert.equal(new Set([base.headers.etag, serif.headers.etag, normal.headers.etag]).size, 3);
        });

        test('the cache and hardening headers stay on a styled badge', async () => {
            const res = await fetch(`${baseUrl}/v6/badge?label=a&font=mono&weight=normal`);
            assert.equal(res.status, 200);
            assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
            assert.equal(res.headers.get('content-security-policy'), "default-src 'none'");
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
            const first = await rawGet('/v6/badge?label=a&font=mono&weight=normal');
            const second = await rawGet('/v6/badge?label=a&font=mono&weight=normal', {
                'If-None-Match': first.headers.etag as string,
            });
            assert.equal(second.status, 304);
        });

        test('a styled badge is deterministic', async () => {
            const [a, b] = await Promise.all([
                fetch(`${baseUrl}/v6/badge?label=a&font=serif&weight=normal`).then((r) => r.text()),
                fetch(`${baseUrl}/v6/badge?label=a&font=serif&weight=normal`).then((r) => r.text()),
            ]);
            assert.equal(a, b);
        });

        test('v4 and v5 answer 404 even with font and weight', async () => {
            for (const version of ['v4', 'v5']) {
                const { status, body } = await getJson(`/${version}/badge?label=a&font=mono&weight=normal`);
                assert.equal(status, 404);
                assert.equal(body.message, 'Not Found');
                assert.equal(body.error, `Endpoint not available in ${version}.`);
                assert.equal(body.status, 404);
            }
        });

        const FONT_ERROR = 'Invalid font (use sans, serif or mono)';
        const WEIGHT_ERROR = 'Invalid weight (use normal or bold)';
        const rejected: [string, string, string][] = [
            ['unknown font', 'font=comic', FONT_ERROR],
            ['font in capitals', 'font=Sans', FONT_ERROR],
            ['font with a trailing space', 'font=sans%20', FONT_ERROR],
            ['empty font', 'font=', FONT_ERROR],
            ['repeated font key', 'font=sans&font=serif', FONT_ERROR],
            ['font named constructor', 'font=constructor', FONT_ERROR],
            ['font named __proto__', 'font=__proto__', FONT_ERROR],
            ['font named toString', 'font=toString', FONT_ERROR],
            ['font named hasOwnProperty', 'font=hasOwnProperty', FONT_ERROR],
            ['font with an injected attribute', 'font=sans%22%20onload%3D%22alert(1)', FONT_ERROR],
            ['font with angle brackets', 'font=%3Cscript%3Ealert(1)%3C%2Fscript%3E', FONT_ERROR],
            ['font with a quote and a tag', 'font=%22%3E%3Csvg%2Fonload%3Dalert(1)%3E', FONT_ERROR],
            ['unknown weight', 'weight=heavy', WEIGHT_ERROR],
            ['weight in capitals', 'weight=Bold', WEIGHT_ERROR],
            ['numeric weight', 'weight=600', WEIGHT_ERROR],
            ['empty weight', 'weight=', WEIGHT_ERROR],
            ['repeated weight key', 'weight=bold&weight=normal', WEIGHT_ERROR],
            ['weight named constructor', 'weight=constructor', WEIGHT_ERROR],
            ['weight named __proto__', 'weight=__proto__', WEIGHT_ERROR],
            ['weight named toString', 'weight=toString', WEIGHT_ERROR],
            ['weight named hasOwnProperty', 'weight=hasOwnProperty', WEIGHT_ERROR],
            ['weight with an injected attribute', 'weight=bold%22%20onload%3D%22alert(1)', WEIGHT_ERROR],
            ['weight with angle brackets', 'weight=%3Cscript%3Ealert(1)%3C%2Fscript%3E', WEIGHT_ERROR],
        ];
        for (const [name, query, message] of rejected) {
            test(`${name} returns 400`, async () => {
                const res = await fetch(`${baseUrl}/v6/badge?label=a&${query}`);
                assert.equal(res.status, 400);
                assert.ok(res.headers.get('content-type')?.includes('application/json'));
                const body = (await res.json()) as Record<string, unknown>;
                assert.equal(body.message, 'Bad Request');
                assert.equal(body.error, message);
                assert.equal(body.status, 400);
            });
        }

        test('bracket forms are plain unknown keys with the simple query parser and never reach the options', async () => {
            const plain = await (await fetch(`${baseUrl}/v6/badge?label=a`)).text();
            for (const query of ['font[]=mono', 'font[a]=b', 'font[sans]=sans', 'weight[]=normal', 'weight[a]=b']) {
                const res = await fetch(`${baseUrl}/v6/badge?label=a&${query}`);
                assert.equal(res.status, 200, query);
                assert.equal(await res.text(), plain, query);
            }
        });

        test('an invalid font is reported before an invalid weight', async () => {
            const { body } = await getJson('/v6/badge?label=a&font=comic&weight=heavy');
            assert.equal(body.error, FONT_ERROR);
        });

        test('a valid font with an invalid weight is reported as a weight error', async () => {
            const { status, body } = await getJson('/v6/badge?label=a&font=mono&weight=heavy');
            assert.equal(status, 400);
            assert.equal(body.error, WEIGHT_ERROR);
        });
    });

    const invalid: [string, string, string][] = [
        ['missing label', '/v6/badge', 'Please provide a label (?label={text})'],
        ['empty label', '/v6/badge?label=', 'Please provide a label (?label={text})'],
        ['blank label', '/v6/badge?label=%20%20', 'Please provide a label (?label={text})'],
        ['repeated label key', '/v6/badge?label=a&label=b', 'Please provide a label (?label={text})'],
        ['repeated start key', '/v6/badge?label=a&start=fff&start=000', 'Please provide a valid start color'],
        ['bad colour', '/v6/badge?label=a&start=zzz', 'Invalid start color (use hex like ff6600)'],
        ['bad ink colour', '/v6/badge?label=a&ink=12345', 'Invalid ink color (use hex like ff6600)'],
        ['unknown icon', '/v6/badge?label=a&icon=nope', '"nope"'],
        ['unknown trail icon', '/v6/badge?label=a&trail=nope', '"nope"'],
        ['bad size', '/v6/badge?label=a&size=xl', 'Invalid size (use xs, sm, md or lg)'],
        ['lift not a number', '/v6/badge?label=a&lift=abc', 'Invalid lift (use a number from 0 to 10)'],
        ['negative lift', '/v6/badge?label=a&lift=-1', 'Invalid lift (use a number from 0 to 10)'],
        ['lift above the maximum', '/v6/badge?label=a&lift=11', 'Invalid lift (use a number from 0 to 10)'],
        ['lift in hexadecimal', '/v6/badge?label=a&lift=0x5', 'Invalid lift (use a number from 0 to 10)'],
        ['lift in exponent form', '/v6/badge?label=a&lift=1e1', 'Invalid lift (use a number from 0 to 10)'],
        ['empty lift', '/v6/badge?label=a&lift=', 'Invalid lift (use a number from 0 to 10)'],
        ['lift with three decimals', '/v6/badge?label=a&lift=1.123', 'Invalid lift (use a number from 0 to 10)'],
        ['repeated lift key', '/v6/badge?label=a&lift=1&lift=2', 'Invalid lift (use a number from 0 to 10)'],
        ['lift of 100', '/v6/badge?label=a&lift=100', 'Invalid lift (use a number from 0 to 10)'],
        ['radius not a number', '/v6/badge?label=a&radius=abc', 'Invalid radius (use a number from 0 to 100)'],
        ['negative radius', '/v6/badge?label=a&radius=-1', 'Invalid radius (use a number from 0 to 100)'],
        ['radius above the maximum', '/v6/badge?label=a&radius=101', 'Invalid radius (use a number from 0 to 100)'],
        ['radius in hexadecimal', '/v6/badge?label=a&radius=0x5', 'Invalid radius (use a number from 0 to 100)'],
        ['radius in exponent form', '/v6/badge?label=a&radius=1e1', 'Invalid radius (use a number from 0 to 100)'],
        ['empty radius', '/v6/badge?label=a&radius=', 'Invalid radius (use a number from 0 to 100)'],
        ['radius with three decimals', '/v6/badge?label=a&radius=1.123', 'Invalid radius (use a number from 0 to 100)'],
        ['repeated radius key', '/v6/badge?label=a&radius=1&radius=2', 'Invalid radius (use a number from 0 to 100)'],
        ['angle not a number', '/v6/badge?label=a&angle=abc', 'Invalid angle (use a number from 0 to 360)'],
        ['negative angle', '/v6/badge?label=a&angle=-1', 'Invalid angle (use a number from 0 to 360)'],
        ['angle above the maximum', '/v6/badge?label=a&angle=361', 'Invalid angle (use a number from 0 to 360)'],
        ['angle in hexadecimal', '/v6/badge?label=a&angle=0x5', 'Invalid angle (use a number from 0 to 360)'],
        ['angle in exponent form', '/v6/badge?label=a&angle=1e1', 'Invalid angle (use a number from 0 to 360)'],
        ['empty angle', '/v6/badge?label=a&angle=', 'Invalid angle (use a number from 0 to 360)'],
        ['angle with three decimals', '/v6/badge?label=a&angle=1.123', 'Invalid angle (use a number from 0 to 360)'],
        ['repeated angle key', '/v6/badge?label=a&angle=1&angle=2', 'Invalid angle (use a number from 0 to 360)'],
        ['blank message', '/v6/badge?label=a&message=%20%20', 'Please provide a valid message'],
        ['repeated message key', '/v6/badge?label=a&message=b&message=c', 'Please provide a valid message'],
        [
            'message with a zero-width space',
            '/v6/badge?label=a&message=a%E2%80%8Bb',
            'Message cannot contain control or invisible characters',
        ],
        [
            'control character in the message',
            '/v6/badge?label=a&message=a%00b',
            'Message cannot contain control or invisible characters',
        ],
        [
            'message of 65 characters',
            `/v6/badge?label=a&message=${'b'.repeat(65)}`,
            'Message cannot exceed 64 characters',
        ],
        [
            'bad messageStart colour',
            '/v6/badge?label=a&message=b&messageStart=zzz',
            'Invalid messageStart color (use hex like ff6600)',
        ],
        [
            'bad messageEnd colour',
            '/v6/badge?label=a&message=b&messageEnd=12345',
            'Invalid messageEnd color (use hex like ff6600)',
        ],
        [
            'bad messageInk colour',
            '/v6/badge?label=a&message=b&messageInk=xyz',
            'Invalid messageInk color (use hex like ff6600)',
        ],
        [
            'repeated messageStart key',
            '/v6/badge?label=a&message=b&messageStart=fff&messageStart=000',
            'Please provide a valid messageStart color',
        ],
        [
            'repeated messageEnd key',
            '/v6/badge?label=a&message=b&messageEnd=fff&messageEnd=000',
            'Please provide a valid messageEnd color',
        ],
        [
            'repeated messageInk key',
            '/v6/badge?label=a&message=b&messageInk=fff&messageInk=000',
            'Please provide a valid messageInk color',
        ],
        [
            'bad messageStart colour without a message',
            '/v6/badge?label=a&messageStart=zzz',
            'Invalid messageStart color (use hex like ff6600)',
        ],
        [
            'label with a zero-width space',
            '/v6/badge?label=a%E2%80%8Bb',
            'Label cannot contain control or invisible characters',
        ],
        ['label of 65 characters', `/v6/badge?label=${'a'.repeat(65)}`, 'Label cannot exceed 64 characters'],
        [
            'control character in the label',
            '/v6/badge?label=a%00b',
            'Label cannot contain control or invisible characters',
        ],
    ];
    for (const [name, path, message] of invalid) {
        test(`${name} returns 400`, async () => {
            const { status, body } = await getJson(path);
            assert.equal(status, 400);
            assert.equal(body.message, 'Bad Request');
            assert.ok(String(body.error).includes(message), `unexpected error: ${String(body.error)}`);
            assert.equal(body.status, 400);
        });
    }

    test('is not available in v4 and v5', async () => {
        for (const version of ['v4', 'v5']) {
            const { status, body } = await getJson(`/${version}/badge?label=a`);
            assert.equal(status, 404);
            assert.equal(body.message, 'Not Found');
            assert.equal(body.error, `Endpoint not available in ${version}.`);
            assert.equal(body.status, 404);
        }
    });

    test('is listed in v6 only', async () => {
        const v6 = (await getJson('/v6')).body.endpoints as Record<string, Record<string, string>>;
        assert.ok('badge' in v6.get!);
        assert.ok(v6.get!.badge!.startsWith('/v6/badge?label={text}'));
        assert.ok(
            v6.get!.badge!.includes('&size={xs|sm|md|lg}&font={sans|serif|mono}&weight={normal|bold}&lift={0-10}'),
        );
        for (const name of [
            'message',
            'messageStart',
            'messageEnd',
            'messageInk',
            'radius',
            'angle',
            'font',
            'weight',
        ]) {
            assert.ok(v6.get!.badge!.includes(`${name}={`), `badge path does not list ${name}`);
        }
        const v5 = (await getJson('/v5')).body.endpoints as Record<string, Record<string, string>>;
        assert.equal('badge' in v5.get!, false);
        const v4 = (await getJson('/v4')).body.endpoints as Record<string, Record<string, string>>;
        assert.equal('badge' in v4.get!, false);
    });
});

describe('GET /v4/avatar', () => {
    test('returns PNG by default', async () => {
        const res = await fetch(`${baseUrl}/v4/avatar?seed=test`);
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('image/png'));
    });

    test('SVG format returns SVG content type', async () => {
        const res = await fetch(`${baseUrl}/v4/avatar?seed=test&format=svg`);
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('image/svg+xml'));
        const text = await res.text();
        assert.ok(text.includes('<svg'));
    });

    test('same seed is deterministic', async () => {
        const [a, b] = await Promise.all([
            fetch(`${baseUrl}/v4/avatar?seed=fixed`).then((r) => r.arrayBuffer()),
            fetch(`${baseUrl}/v4/avatar?seed=fixed`).then((r) => r.arrayBuffer()),
        ]);
        assert.deepEqual(Buffer.from(a!), Buffer.from(b!));
    });

    test('invalid type returns 400', async () => {
        const { status } = await getJson('/v4/avatar?seed=test&type=geometric');
        assert.equal(status, 400);
    });
});

describe('GET /v4/credit', () => {
    test('returns cards array by default', async () => {
        const { status, body } = await getJson('/v4/credit');
        assert.equal(status, 200);
        assert.ok(Array.isArray(body.cards));
        assert.equal(body.cards.length, 1);
    });

    test('brand param respected', async () => {
        const { status, body } = await getJson('/v4/credit?brand=visa');
        assert.equal(status, 200);
        assert.equal((body as { cards: { brand: string }[] }).cards[0]!.brand, 'visa');
    });

    test('count param respected', async () => {
        const { status, body } = await getJson('/v4/credit?count=3');
        assert.equal(status, 200);
        assert.equal((body as { cards: unknown[] }).cards.length, 3);
    });

    test('unknown brand returns 400', async () => {
        const { status } = await getJson('/v4/credit?brand=diners');
        assert.equal(status, 400);
    });
});

// --- v5 endpoints ---

// --- GET endpoints ---

describe('GET / (version listing)', () => {
    test('v5 endpoints listed', async () => {
        const { body } = await getJson('/v5');
        assert.equal(body.version, 'v5');
        const endpoints = body.endpoints as Record<string, Record<string, string>>;
        assert.ok('case' in endpoints.get!);
        assert.ok('evaluate' in endpoints.get!);
        assert.ok('url' in endpoints.get!);

        assert.ok('chart' in endpoints.post!);
        assert.ok('csv' in endpoints.post!);
        assert.ok('jwt' in endpoints.post!);
        assert.ok('matrix' in endpoints.post!);
        assert.ok('otp' in endpoints.post!);
        assert.ok('symmetric' in endpoints.post!);
    });
});

describe('GET /v5/evaluate', () => {
    test('basic expression returns correct result', async () => {
        const { status, body } = await getJson('/v5/evaluate?expr=2%2B3*4');
        assert.equal(status, 200);
        assert.equal(body.result, 14);
        assert.equal(body.expression, '2+3*4');
    });
    test('precision param is respected', async () => {
        const { body } = await getJson('/v5/evaluate?expr=1%2F3&precision=2');
        assert.equal(body.result, 0.33);
        assert.equal(body.precision, 2);
    });
    test('constants work', async () => {
        const { status, body } = await getJson('/v5/evaluate?expr=pi&precision=5');
        assert.equal(status, 200);
        assert.equal(body.result, 3.14159);
    });
    test('missing expr returns 400', async () => {
        const { status } = await getJson('/v5/evaluate');
        assert.equal(status, 400);
    });
    test('division by zero returns 400', async () => {
        const { status } = await getJson('/v5/evaluate?expr=1%2F0');
        assert.equal(status, 400);
    });
    test('unknown identifier returns 400', async () => {
        const { status } = await getJson('/v5/evaluate?expr=foo');
        assert.equal(status, 400);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await getJson('/v4/evaluate?expr=1%2B1');
        assert.equal(status, 404);
    });
});

// --- POST endpoints ---

describe('POST /v5/asymmetric', () => {
    test('keygen returns publicKey and privateKey', async () => {
        const { status, body } = await sendJson('POST', '/v5/asymmetric', { action: 'keygen' });
        assert.equal(status, 200);
        assert.equal(body.action, 'keygen');
        assert.equal(body.algorithm, 'rsa-oaep-sha256');
        assert.equal(body.modulusLength, 2048);
        assert.ok((body.publicKey as string).startsWith('-----BEGIN PUBLIC KEY-----'));
        assert.ok((body.privateKey as string).startsWith('-----BEGIN PRIVATE KEY-----'));
    });
    test('encrypt then decrypt returns original text', async () => {
        const kg = await sendJson('POST', '/v5/asymmetric', { action: 'keygen' });
        const enc = await sendJson('POST', '/v5/asymmetric', {
            action: 'encrypt',
            text: 'hello RSA',
            publicKey: kg.body.publicKey,
        });
        assert.equal(enc.status, 200);
        assert.equal(enc.body.action, 'encrypt');
        assert.ok(typeof enc.body.result === 'string');
        const dec = await sendJson('POST', '/v5/asymmetric', {
            action: 'decrypt',
            text: enc.body.result,
            privateKey: kg.body.privateKey,
        });
        assert.equal(dec.status, 200);
        assert.equal(dec.body.result, 'hello RSA');
    });
    test('decrypt with wrong key returns 400', async () => {
        const kg1 = await sendJson('POST', '/v5/asymmetric', { action: 'keygen' });
        const kg2 = await sendJson('POST', '/v5/asymmetric', { action: 'keygen' });
        const enc = await sendJson('POST', '/v5/asymmetric', {
            action: 'encrypt',
            text: 'secret',
            publicKey: kg1.body.publicKey,
        });
        const { status } = await sendJson('POST', '/v5/asymmetric', {
            action: 'decrypt',
            text: enc.body.result,
            privateKey: kg2.body.privateKey,
        });
        assert.equal(status, 400);
    });
    test('missing action returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/asymmetric', {});
        assert.equal(status, 400);
    });
    test('unsupported algorithm returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/asymmetric', {
            action: 'keygen',
            algorithm: 'rsa-pkcs1v15',
        });
        assert.equal(status, 400);
    });
    test('GET /v5/asymmetric returns 405', async () => {
        const { status } = await getJson('/v5/asymmetric');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/asymmetric', { action: 'keygen' });
        assert.equal(status, 404);
    });
    test('v5 and v6 keygen responses keep the same fields in the same order', async () => {
        for (const version of ['v5', 'v6']) {
            const { status, body } = await sendJson('POST', `/${version}/asymmetric`, {
                action: 'keygen',
                modulusLength: '2048',
            });
            assert.equal(status, 200);
            assert.deepEqual(Object.keys(body), ['action', 'algorithm', 'modulusLength', 'publicKey', 'privateKey']);
            assert.equal(body.modulusLength, 2048);
        }
    });
    test('invalid modulus length keeps its 400 message', async () => {
        const { status, body } = await sendJson('POST', '/v6/asymmetric', { action: 'keygen', modulusLength: 1024 });
        assert.equal(status, 400);
        assert.equal(body.error, 'Modulus length must be 2048 or 4096');
    });
    test('invalid action keeps its 400 message', async () => {
        const { status, body } = await sendJson('POST', '/v6/asymmetric', { action: 'sign' });
        assert.equal(status, 400);
        assert.equal(body.error, 'Action must be "keygen", "encrypt", or "decrypt"');
    });
    test('4096-bit keygen does not hold up other requests', async () => {
        const order: string[] = [];
        const keygen = sendJson('POST', '/v6/asymmetric', { action: 'keygen', modulusLength: 4096 }).then((res) => {
            order.push('keygen');
            return res;
        });

        // Give the keygen request a head start so the server receives it first
        await new Promise((resolve) => setTimeout(resolve, 20));
        const listing = getJson('/v6').then((res) => {
            order.push('listing');
            return res;
        });
        const [kg, ls] = await Promise.all([keygen, listing]);
        assert.equal(kg.status, 200);
        assert.equal(kg.body.modulusLength, 4096);
        assert.equal(ls.status, 200);
        assert.deepEqual(order, ['listing', 'keygen']);
    });
});

describe('POST /v5/chart', () => {
    test('bar chart returns SVG content type', async () => {
        const res = await fetch(`${baseUrl}/v5/chart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'bar',
                data: { labels: ['A', 'B'], datasets: [{ label: 'X', values: [10, 20] }] },
            }),
        });
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('image/svg+xml'));
        const svg = await res.text();
        assert.ok(svg.startsWith('<svg'));
        assert.ok(svg.includes('<rect'));
    });
    test('line chart returns SVG', async () => {
        const res = await fetch(`${baseUrl}/v5/chart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'line',
                data: { labels: ['A', 'B'], datasets: [{ label: '', values: [1, 2] }] },
            }),
        });
        assert.equal(res.status, 200);
        const svg = await res.text();
        assert.ok(svg.includes('<polyline'));
    });
    test('pie chart returns SVG', async () => {
        const res = await fetch(`${baseUrl}/v5/chart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'pie',
                data: { labels: ['X', 'Y'], values: [60, 40] },
            }),
        });
        assert.equal(res.status, 200);
        const svg = await res.text();
        assert.ok(svg.includes('<path'));
    });
    test('missing type returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/chart', {
            data: { labels: ['A'], datasets: [{ label: '', values: [1] }] },
        });
        assert.equal(status, 400);
    });
    test('invalid type returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/chart', {
            type: 'histogram',
            data: { labels: ['A'], datasets: [{ label: '', values: [1] }] },
        });
        assert.equal(status, 400);
    });
    test('missing data returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/chart', { type: 'bar' });
        assert.equal(status, 400);
    });
    test('GET /v5/chart returns 405', async () => {
        const { status } = await getJson('/v5/chart');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/chart', { type: 'bar' });
        assert.equal(status, 404);
    });
    test('mode=data returns JSON with labels and scale', async () => {
        const { status, body } = await sendJson('POST', '/v5/chart', {
            type: 'bar',
            data: { labels: ['Jan', 'Fév'], datasets: [{ label: 'Sales', values: [10, 20] }] },
            mode: 'data',
        });
        assert.equal(status, 200);
        assert.equal(body.type, 'bar');
        assert.deepEqual(body.labels, ['Jan', 'Fév']);
        assert.ok(body.scale);
    });
    test('mode=data pie returns slices', async () => {
        const { status, body } = await sendJson('POST', '/v5/chart', {
            type: 'pie',
            data: { labels: ['A', 'B'], values: [60, 40] },
            mode: 'data',
        });
        assert.equal(status, 200);
        assert.equal(body.type, 'pie');
        assert.ok(Array.isArray(body.slices));
    });
});

describe('POST /v5/matrix', () => {
    test('add operation', async () => {
        const { status, body } = await sendJson('POST', '/v5/matrix', {
            operation: 'add',
            matrix: [
                [1, 2],
                [3, 4],
            ],
            matrix2: [
                [5, 6],
                [7, 8],
            ],
        });
        assert.equal(status, 200);
        assert.deepEqual(body.result, [
            [6, 8],
            [10, 12],
        ]);
    });
    test('multiply operation', async () => {
        const { status, body } = await sendJson('POST', '/v5/matrix', {
            operation: 'multiply',
            matrix: [
                [1, 2],
                [3, 4],
            ],
            matrix2: [
                [5, 6],
                [7, 8],
            ],
        });
        assert.equal(status, 200);
        assert.deepEqual(body.result, [
            [19, 22],
            [43, 50],
        ]);
    });
    test('transpose operation', async () => {
        const { status, body } = await sendJson('POST', '/v5/matrix', {
            operation: 'transpose',
            matrix: [
                [1, 2, 3],
                [4, 5, 6],
            ],
        });
        assert.equal(status, 200);
        assert.deepEqual(body.result, [
            [1, 4],
            [2, 5],
            [3, 6],
        ]);
    });
    test('identity operation', async () => {
        const { status, body } = await sendJson('POST', '/v5/matrix', {
            operation: 'identity',
            scalar: 3,
        });
        assert.equal(status, 200);
        assert.deepEqual(body.result, [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
        ]);
    });
    test('missing operation returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/matrix', { matrix: [[1]] });
        assert.equal(status, 400);
    });
    test('invalid operation returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/matrix', { operation: 'unknown', matrix: [[1]] });
        assert.equal(status, 400);
    });
    test('dimension mismatch returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/matrix', {
            operation: 'add',
            matrix: [[1, 2]],
            matrix2: [
                [1, 2],
                [3, 4],
            ],
        });
        assert.equal(status, 400);
    });
    test('GET /v5/matrix returns 405', async () => {
        const { status } = await getJson('/v5/matrix');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/matrix', { operation: 'add', matrix: [[1]], matrix2: [[1]] });
        assert.equal(status, 404);
    });
});

describe('POST /v5/otp', () => {
    test('secret action returns base32 secret and uri', async () => {
        const { status, body } = await sendJson('POST', '/v5/otp', { action: 'secret' });
        assert.equal(status, 200);
        assert.ok(typeof body.secret === 'string');
        assert.match(body.secret as string, /^[A-Z2-7]+$/);
        assert.ok((body.uri as string).startsWith('otpauth://totp/'));
    });
    test('generate action returns 6-digit code', async () => {
        const { body: secBody } = await sendJson('POST', '/v5/otp', { action: 'secret' });
        const { status, body } = await sendJson('POST', '/v5/otp', {
            action: 'generate',
            secret: secBody.secret,
        });
        assert.equal(status, 200);
        assert.match(body.code as string, /^\d{6}$/);
        assert.ok(typeof body.remaining === 'number');
    });
    test('verify just-generated code returns valid=true', async () => {
        const { body: secBody } = await sendJson('POST', '/v5/otp', { action: 'secret' });
        const { body: genBody } = await sendJson('POST', '/v5/otp', {
            action: 'generate',
            secret: secBody.secret,
        });
        const { status, body } = await sendJson('POST', '/v5/otp', {
            action: 'verify',
            secret: secBody.secret,
            code: genBody.code,
        });
        assert.equal(status, 200);
        assert.equal(body.valid, true);
    });
    test('verify wrong code returns valid=false', async () => {
        const { body: secBody } = await sendJson('POST', '/v5/otp', { action: 'secret' });
        const { body: genBody } = await sendJson('POST', '/v5/otp', {
            action: 'generate',
            secret: secBody.secret,
        });
        const code = genBody.code as string;
        const wrongCode = code.slice(0, -1) + ((parseInt(code.slice(-1), 10) + 5) % 10);
        const { body } = await sendJson('POST', '/v5/otp', {
            action: 'verify',
            secret: secBody.secret,
            code: wrongCode,
        });
        assert.equal(body.valid, false);
    });
    test('missing action returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/otp', { secret: 'JBSWY3DPEHPK3PXP' });
        assert.equal(status, 400);
    });
    test('invalid digits returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/otp', {
            action: 'generate',
            secret: 'JBSWY3DPEHPK3PXP',
            digits: 7,
        });
        assert.equal(status, 400);
    });
    test('GET /v5/otp returns 405', async () => {
        const { status } = await getJson('/v5/otp');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/otp', { action: 'secret' });
        assert.equal(status, 404);
    });
});

describe('POST /v5/symmetric', () => {
    test('encrypt returns base64 result', async () => {
        const { status, body } = await sendJson('POST', '/v5/symmetric', {
            action: 'encrypt',
            text: 'hello world',
            key: 'mysecretkey',
        });
        assert.equal(status, 200);
        assert.equal(body.action, 'encrypt');
        assert.equal(body.algorithm, 'aes-256-gcm');
        assert.ok(typeof body.result === 'string' && (body.result as string).length > 0);
    });
    test('encrypt then decrypt returns original text', async () => {
        const enc = await sendJson('POST', '/v5/symmetric', {
            action: 'encrypt',
            text: 'round trip',
            key: 'mypassword1',
        });
        const dec = await sendJson('POST', '/v5/symmetric', {
            action: 'decrypt',
            text: enc.body.result,
            key: 'mypassword1',
        });
        assert.equal(dec.status, 200);
        assert.equal(dec.body.result, 'round trip');
    });
    test('wrong key at decrypt returns 400', async () => {
        const enc = await sendJson('POST', '/v5/symmetric', {
            action: 'encrypt',
            text: 'secret',
            key: 'correctkey1',
        });
        const { status } = await sendJson('POST', '/v5/symmetric', {
            action: 'decrypt',
            text: enc.body.result,
            key: 'wrongkey123',
        });
        assert.equal(status, 400);
    });
    test('missing action returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/symmetric', { text: 'hello', key: 'mypassword' });
        assert.equal(status, 400);
    });
    test('missing text returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/symmetric', { action: 'encrypt', key: 'mypassword' });
        assert.equal(status, 400);
    });
    test('missing key returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/symmetric', { action: 'encrypt', text: 'hello' });
        assert.equal(status, 400);
    });
    test('unknown algorithm returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/symmetric', {
            action: 'encrypt',
            text: 'hello',
            key: 'mypassword',
            algorithm: 'rot13',
        });
        assert.equal(status, 400);
    });
    test('GET /v5/symmetric returns 405', async () => {
        const { status } = await getJson('/v5/symmetric');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/symmetric', {
            action: 'encrypt',
            text: 'hi',
            key: 'password1',
        });
        assert.equal(status, 404);
    });
});

describe('GET /v5/case', () => {
    test('snake_case → camel returns correct result', async () => {
        const { status, body } = await getJson('/v5/case?text=hello_world&to=camel');
        assert.equal(status, 200);
        assert.equal(body.result, 'helloWorld');
        assert.equal(body.to, 'camel');
    });
    test('default to is camel', async () => {
        const { status, body } = await getJson('/v5/case?text=hello_world');
        assert.equal(status, 200);
        assert.equal(body.result, 'helloWorld');
    });
    test('snake target', async () => {
        const { body } = await getJson('/v5/case?text=helloWorld&to=snake');
        assert.equal(body.result, 'hello_world');
    });
    test('missing text returns 400', async () => {
        const { status } = await getJson('/v5/case');
        assert.equal(status, 400);
    });
    test('invalid to returns 400', async () => {
        const { status } = await getJson('/v5/case?text=hello&to=invalid');
        assert.equal(status, 400);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await getJson('/v4/case?text=hello');
        assert.equal(status, 404);
    });
});

describe('GET /v5/url', () => {
    test('full URL returns all components', async () => {
        const url = encodeURIComponent('https://example.com:8080/path?foo=bar&baz=1#section');
        const { status, body } = await getJson(`/v5/url?url=${url}`);
        assert.equal(status, 200);
        assert.equal(body.scheme, 'https');
        assert.equal(body.host, 'example.com');
        assert.equal(body.port, 8080);
        assert.equal(body.path, '/path');
        assert.deepEqual(body.params, { foo: 'bar', baz: '1' });
        assert.equal(body.fragment, 'section');
        assert.equal(body.valid, true);
    });
    test('URL without port returns default scheme port', async () => {
        const { body } = await getJson(`/v5/url?url=${encodeURIComponent('https://example.com/path')}`);
        assert.equal(body.port, 443);
    });
    test('URL with unknown scheme returns port: null', async () => {
        const { body } = await getJson(`/v5/url?url=${encodeURIComponent('foo://example.com')}`);
        assert.equal(body.port, null);
    });
    test('URL without fragment returns empty fragment', async () => {
        const { body } = await getJson(`/v5/url?url=${encodeURIComponent('https://example.com')}`);
        assert.equal(body.fragment, '');
        assert.equal(body.path, '/');
    });
    test('invalid URL returns 400', async () => {
        const { status } = await getJson('/v5/url?url=not-a-url');
        assert.equal(status, 400);
    });
    test('missing url returns 400', async () => {
        const { status } = await getJson('/v5/url');
        assert.equal(status, 400);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await getJson(`/v4/url?url=${encodeURIComponent('https://example.com')}`);
        assert.equal(status, 404);
    });
});

describe('POST /v5/csv', () => {
    test('parse returns rows and count', async () => {
        const { status, body } = await sendJson('POST', '/v5/csv', {
            action: 'parse',
            csv: 'name,age\nAlice,30\nBob,25',
        });
        assert.equal(status, 200);
        assert.equal(body.action, 'parse');
        assert.deepEqual(body.rows, [
            { name: 'Alice', age: '30' },
            { name: 'Bob', age: '25' },
        ]);
        assert.equal(body.count, 2);
    });
    test('parse with custom delimiter', async () => {
        const { body } = await sendJson('POST', '/v5/csv', {
            action: 'parse',
            csv: 'name;age\nAlice;30',
            delimiter: ';',
        });
        assert.deepEqual(body.rows, [{ name: 'Alice', age: '30' }]);
    });
    test('parse with headers: false returns numeric keys', async () => {
        const { body } = await sendJson('POST', '/v5/csv', {
            action: 'parse',
            csv: 'Alice,30',
            headers: false,
        });
        assert.deepEqual(body.rows, [{ '0': 'Alice', '1': '30' }]);
    });
    test('format returns CSV string', async () => {
        const { status, body } = await sendJson('POST', '/v5/csv', {
            action: 'format',
            json: [
                { name: 'Alice', age: '30' },
                { name: 'Bob', age: '25' },
            ],
        });
        assert.equal(status, 200);
        assert.equal(body.action, 'format');
        assert.equal(body.csv, 'name,age\nAlice,30\nBob,25');
        assert.equal(body.count, 2);
    });
    test('invalid action returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/csv', { action: 'invalid' });
        assert.equal(status, 400);
    });
    test('missing action returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/csv', { csv: 'a,b' });
        assert.equal(status, 400);
    });
    test('missing csv for parse returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/csv', { action: 'parse' });
        assert.equal(status, 400);
    });
    test('missing json for format returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/csv', { action: 'format' });
        assert.equal(status, 400);
    });
    test('GET /v5/csv returns 405', async () => {
        const { status } = await getJson('/v5/csv');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/csv', { action: 'parse', csv: 'a,b' });
        assert.equal(status, 404);
    });
});

describe('POST /v5/jwt', () => {
    const validToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiQWxpY2UiLCJleHAiOjk5OTk5OTk5OTl9.fakesig';

    test('valid token returns header, payload, signature', async () => {
        const { status, body } = await sendJson('POST', '/v5/jwt', { token: validToken });
        assert.equal(status, 200);
        assert.deepEqual(body.header, { alg: 'HS256', typ: 'JWT' });
        assert.equal((body.payload as Record<string, unknown>).sub, '123');
        assert.equal(typeof body.signature, 'string');
    });
    test('non-expired token returns expired: false', async () => {
        const { body } = await sendJson('POST', '/v5/jwt', { token: validToken });
        assert.equal(body.expired, false);
    });
    test('invalid format returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/jwt', { token: 'notajwt' });
        assert.equal(status, 400);
    });
    test('missing token returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/jwt', {});
        assert.equal(status, 400);
    });
    test('GET /v5/jwt returns 405', async () => {
        const { status } = await getJson('/v5/jwt');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/jwt', { token: validToken });
        assert.equal(status, 404);
    });
});

describe('GET /v5/captcha (modes)', () => {
    test('default mode is unchanged', async () => {
        const res = await fetch(`${baseUrl}/v5/captcha?text=hello`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /image\/png/);
        assert.equal(res.headers.get('x-captcha-text'), 'hello');
        assert.equal(res.headers.get('x-captcha-token'), null);
    });
    test('challenge mode returns a token and no answer', async () => {
        const res = await fetch(`${baseUrl}/v5/captcha?mode=challenge`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /image\/png/);
        assert.equal(res.headers.get('x-captcha-text'), null);
        assert.ok((res.headers.get('x-captcha-token') ?? '').length > 0);
    });
    test('challenge mode refuses a custom text', async () => {
        const { status } = await getJson('/v5/captcha?mode=challenge&text=abc');
        assert.equal(status, 400);
    });
    test('unknown mode returns 400', async () => {
        const { status } = await getJson('/v5/captcha?mode=nawak');
        assert.equal(status, 400);
    });
    test('challenge mode is not available in v4', async () => {
        const { status, body } = await getJson('/v4/captcha?mode=challenge');
        assert.equal(status, 404);
        assert.match(body.error as string, /Challenge mode not available in v4/);
    });
});

describe('POST /v5/captcha', () => {
    test('a wrong answer is rejected', async () => {
        const res = await fetch(`${baseUrl}/v5/captcha?mode=challenge`);
        const token = res.headers.get('x-captcha-token')!;
        const { status, body } = await sendJson('POST', '/v5/captcha', { token, answer: 'definitely-wrong' });
        assert.equal(status, 200);
        assert.equal(body.valid, false);
        assert.equal(body.reason, 'wrong');
    });
    test('a known answer verifies once, then is consumed', async () => {
        const { default: captchaChallenge } = await import('../../src/modules/v5/captcha.js');
        const { token } = captchaChallenge({ text: 'Zx9Kfp' });
        const first = await sendJson('POST', '/v5/captcha', { token, answer: 'zx9kfp' });
        assert.equal(first.body.valid, true);
        const second = await sendJson('POST', '/v5/captcha', { token, answer: 'zx9kfp' });
        assert.equal(second.body.reason, 'used');
    });
    test('missing token or answer returns 400', async () => {
        assert.equal((await sendJson('POST', '/v5/captcha', { answer: 'x' })).status, 400);
        assert.equal((await sendJson('POST', '/v5/captcha', { token: 'x' })).status, 400);
    });
    test('malformed token is reported as invalid', async () => {
        const { body } = await sendJson('POST', '/v5/captcha', { token: 'garbage', answer: 'x' });
        assert.equal(body.reason, 'invalid');
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/captcha', { token: 'x', answer: 'y' });
        assert.equal(status, 404);
    });
});

describe('GET and POST /v5/pow', () => {
    test('issues a challenge', async () => {
        const { status, body } = await getJson('/v5/pow');
        assert.equal(status, 200);
        assert.equal(body.algorithm, 'sha256');
        assert.equal(body.difficulty, 4);
        assert.match(body.salt as string, /^[0-9a-f]{16}$/);
        assert.ok((body.token as string).length > 0);
    });
    test('honours a custom difficulty', async () => {
        const { body } = await getJson('/v5/pow?difficulty=2');
        assert.equal(body.difficulty, 2);
    });
    test('difficulty out of range returns 400', async () => {
        assert.equal((await getJson('/v5/pow?difficulty=7')).status, 400);
        assert.equal((await getJson('/v5/pow?difficulty=0')).status, 400);
    });
    test('a solved challenge verifies once', async () => {
        const { createHash } = await import('node:crypto');
        const { body } = await getJson('/v5/pow?difficulty=2');
        const salt = body.salt as string;
        let nonce = 0;
        while (!createHash('sha256').update(`${salt}${nonce}`).digest('hex').startsWith('00')) nonce++;

        const first = await sendJson('POST', '/v5/pow', { token: body.token, nonce: String(nonce) });
        assert.equal(first.body.valid, true);
        const second = await sendJson('POST', '/v5/pow', { token: body.token, nonce: String(nonce) });
        assert.equal(second.body.reason, 'used');
    });
    test('a wrong nonce is rejected', async () => {
        // Difficulty 6: a stray nonce cannot solve this one by luck
        const { body } = await getJson('/v5/pow?difficulty=6');
        const { body: verified } = await sendJson('POST', '/v5/pow', { token: body.token, nonce: 'nope' });
        assert.equal(verified.valid, false);
        assert.equal(verified.reason, 'wrong');
    });
    test('missing token or nonce returns 400', async () => {
        assert.equal((await sendJson('POST', '/v5/pow', { nonce: '1' })).status, 400);
        assert.equal((await sendJson('POST', '/v5/pow', { token: 'x' })).status, 400);
    });
    test('not available in v4', async () => {
        assert.equal((await getJson('/v4/pow')).status, 404);
        assert.equal((await sendJson('POST', '/v4/pow', { token: 'x', nonce: '1' })).status, 404);
    });
});

describe('Captcha and image generator hardening', () => {
    test('a pow token is not accepted by POST /captcha', async () => {
        for (const version of ['v5', 'v6']) {
            const { body } = await getJson(`/${version}/pow?difficulty=6`);
            const answer = `${body.salt as string}.${body.difficulty as number}`;
            const forged = await sendJson('POST', `/${version}/captcha`, { token: body.token, answer });
            const garbage = await sendJson('POST', `/${version}/captcha`, { token: 'garbage', answer: 'x' });
            assert.equal(forged.status, 200);
            assert.deepEqual(forged.body, garbage.body);
            assert.deepEqual(forged.body, { valid: false, reason: 'invalid' });
        }
    });
    test('a captcha token is burnt after five wrong answers', async () => {
        const res = await fetch(`${baseUrl}/v6/captcha`);
        const token = res.headers.get('x-captcha-token')!;
        for (let i = 0; i < 5; i++) {
            const { status, body } = await sendJson('POST', '/v6/captcha', { token, answer: `guess${i}` });
            assert.equal(status, 200);
            assert.deepEqual(body, { valid: false, reason: 'wrong' });
        }
        const { body } = await sendJson('POST', '/v6/captcha', { token, answer: 'whatever' });
        assert.deepEqual(body, { valid: false, reason: 'used' });
    });
    test('a known answer still verifies after four typos', async () => {
        const { default: captchaChallenge } = await import('../../src/modules/v5/captcha.js');
        const { token } = captchaChallenge({ text: 'Qm7Rtx' });
        for (let i = 0; i < 4; i++) {
            assert.equal((await sendJson('POST', '/v5/captcha', { token, answer: `typo${i}` })).body.reason, 'wrong');
        }
        assert.deepEqual((await sendJson('POST', '/v5/captcha', { token, answer: 'qm7rtx' })).body, { valid: true });
    });
    test('an over-long captcha text returns 400 in every version', async () => {
        for (const prefix of ['/v4/captcha?', '/v5/captcha?', '/v6/captcha?mode=image&']) {
            const { status, body } = await getJson(`${prefix}text=${'W'.repeat(540)}&height=400&noise=high`);
            assert.equal(status, 400);
            assert.equal(body.error, 'Text cannot exceed 32 characters');
        }
    });
    test('a 32-character captcha text is still served', async () => {
        const text = 'a'.repeat(32);
        const res = await fetch(`${baseUrl}/v4/captcha?text=${text}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-captcha-text'), text);
        assert.equal(Buffer.from(await res.arrayBuffer()).readUInt32BE(16), 1920);
    });
    test('over-long barcode data returns 400 in every version', async () => {
        for (const version of ['v4', 'v5', 'v6']) {
            const { status, body } = await getJson(`/${version}/barcode?data=${'A'.repeat(500)}&format=png`);
            assert.equal(status, 400);
            assert.equal(body.error, 'Data cannot exceed 128 characters');
            assert.equal((await getJson(`/${version}/barcode?data=${'A'.repeat(129)}&type=code39`)).status, 400);
        }
    });
    test('barcode data of up to 128 characters is still served', async () => {
        for (const version of ['v4', 'v5', 'v6']) {
            const res = await fetch(`${baseUrl}/${version}/barcode?data=${'A'.repeat(128)}`);
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
        }
    });
    test('repeated barcode data keys return 400 in every version', async () => {
        for (const version of ['v4', 'v5', 'v6']) {
            const { status, body } = await getJson(
                `/${version}/barcode?data=${'A'.repeat(100)}&data=${'B'.repeat(100)}`,
            );
            assert.equal(status, 400);
            assert.equal(body.error, 'Please provide data to encode (?data={string})');
        }
    });
    test('the default captcha width stays 60 px per character in every version', async () => {
        for (const prefix of [
            '/v4/captcha?',
            '/v5/captcha?',
            '/v6/captcha?mode=image&',
            '/v6/captcha?mode=challenge&',
        ]) {
            const res = await fetch(`${baseUrl}${prefix}length=14`);
            assert.equal(res.status, 200);
            assert.equal(Buffer.from(await res.arrayBuffer()).readUInt32BE(16), 840, prefix);
        }
    });
});

describe('Regex query arrays', () => {
    test('a repeated pattern or text key returns 400 in every version', async () => {
        const text = 'a'.repeat(700);
        for (const version of ['v4', 'v5', 'v6']) {
            const patterns = await getJson(`/${version}/regex?pattern=(?=(.*))&pattern=&text=${text}`);
            assert.equal(patterns.status, 400);
            assert.equal(patterns.body.error, 'Please provide a pattern (?pattern={regex})');
            const texts = await getJson(`/${version}/regex?pattern=a&text=${text}&text=${text}`);
            assert.equal(texts.status, 400);
            assert.equal(texts.body.error, 'Please provide a text (&text={string})');
        }
    });
    test('a single pattern and text are matched as before', async () => {
        const { status, body } = await getJson('/v6/regex?pattern=(\\d%2B)&text=a1b22');
        assert.equal(status, 200);
        assert.equal(body.count, 2);
    });
});

describe('POST /captcha minLength', () => {
    test('a correct answer to a shorter captcha is reported as weak', async () => {
        const { default: captchaChallenge } = await import('../../src/modules/v5/captcha.js');
        for (const version of ['v5', 'v6']) {
            const { token } = captchaChallenge({ text: 'Ab' });
            const { status, body } = await sendJson('POST', `/${version}/captcha`, {
                token,
                answer: 'ab',
                minLength: 6,
            });
            assert.equal(status, 200);
            assert.deepEqual(body, { valid: false, reason: 'weak' });
        }
    });
    test('a long enough captcha verifies, minLength sent as a number or a string', async () => {
        const { default: captchaChallenge } = await import('../../src/modules/v5/captcha.js');
        for (const minLength of [6, '6']) {
            const { token } = captchaChallenge({ text: 'Zx9Kfp' });
            const { body } = await sendJson('POST', '/v6/captcha', { token, answer: 'zx9kfp', minLength });
            assert.deepEqual(body, { valid: true });
        }
    });
    test('an invalid minLength returns 400', async () => {
        for (const minLength of ['abc', 0, -3, 2.5]) {
            const { status, body } = await sendJson('POST', '/v6/captcha', { token: 'x', answer: 'y', minLength });
            assert.equal(status, 400, String(minLength));
            assert.equal(body.error, 'Please provide a valid minimum length (&minLength={number})');
        }
    });
});

describe('GET /v5/base', () => {
    test('converts decimal to hexadecimal', async () => {
        const { status, body } = await getJson('/v5/base?value=255&from=10&to=16');
        assert.equal(status, 200);
        assert.equal(body.result, 'ff');
        assert.equal(body.from, 10);
        assert.equal(body.to, 16);
    });
    test('defaults to base 10 -> 16', async () => {
        const { body } = await getJson('/v5/base?value=255');
        assert.equal(body.result, 'ff');
    });
    test('missing value returns 400', async () => {
        const { status } = await getJson('/v5/base');
        assert.equal(status, 400);
    });
    test('invalid value for the base returns 400', async () => {
        const { status } = await getJson('/v5/base?value=zz&from=10');
        assert.equal(status, 400);
    });
    test('base out of range returns 400', async () => {
        const { status } = await getJson('/v5/base?value=10&from=1');
        assert.equal(status, 400);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await getJson('/v4/base?value=255');
        assert.equal(status, 404);
    });
});

describe('GET /v5/uuid', () => {
    test('generates a UUID v4', async () => {
        const { status, body } = await getJson('/v5/uuid');
        assert.equal(status, 200);
        assert.match(body.uuid as string, /^[0-9a-f-]{36}$/);
        assert.equal(body.version, 4);
        assert.equal(body.variant, 'RFC 4122');
    });
    test('generates a batch with count', async () => {
        const { body } = await getJson('/v5/uuid?count=3');
        assert.equal(body.count, 3);
        assert.equal((body.uuids as string[]).length, 3);
    });
    test('parses a provided UUID', async () => {
        const { body } = await getJson('/v5/uuid?uuid=550e8400-e29b-41d4-a716-446655440000');
        assert.equal(body.valid, true);
        assert.equal(body.version, 4);
    });
    test('invalid UUID returns valid: false', async () => {
        const { status, body } = await getJson('/v5/uuid?uuid=not-a-uuid');
        assert.equal(status, 200);
        assert.equal(body.valid, false);
    });
    test('count out of range returns 400', async () => {
        const { status } = await getJson('/v5/uuid?count=51');
        assert.equal(status, 400);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await getJson('/v4/uuid');
        assert.equal(status, 404);
    });
});

describe('GET /v5/semver', () => {
    test('parses a version', async () => {
        const { status, body } = await getJson('/v5/semver?version=1.2.3-beta.1%2Bbuild.42');
        assert.equal(status, 200);
        assert.equal(body.major, 1);
        assert.equal(body.minor, 2);
        assert.equal(body.patch, 3);
        assert.equal(body.prerelease, 'beta.1');
        assert.equal(body.build, 'build.42');
    });
    test('accepts an unencoded plus sign in build metadata', async () => {
        const { status, body } = await getJson('/v5/semver?version=1.2.3-beta.1+build.42');
        assert.equal(status, 200);
        assert.equal(body.version, '1.2.3-beta.1+build.42');
        assert.equal(body.build, 'build.42');
    });
    test('accepts an unencoded plus sign in the compared version', async () => {
        const { body } = await getJson('/v5/semver?version=1.0.0&action=compare&other=1.0.0+build.1');
        assert.equal(body.result, 0);
        assert.equal(body.description, '1.0.0 = 1.0.0+build.1');
    });
    test('bumps a version', async () => {
        const { body } = await getJson('/v5/semver?version=1.2.3&action=bump&part=minor');
        assert.equal(body.result, '1.3.0');
    });
    test('compares two versions', async () => {
        const { body } = await getJson('/v5/semver?version=1.2.3&action=compare&other=1.3.0');
        assert.equal(body.result, -1);
        assert.equal(body.description, '1.2.3 < 1.3.0');
    });
    test('invalid version returns 400', async () => {
        const { status } = await getJson('/v5/semver?version=abc');
        assert.equal(status, 400);
    });
    test('missing version returns 400', async () => {
        const { status } = await getJson('/v5/semver');
        assert.equal(status, 400);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await getJson('/v4/semver?version=1.2.3');
        assert.equal(status, 404);
    });
});

describe('POST /v5/read', () => {
    test('returns readability scores', async () => {
        const { status, body } = await sendJson('POST', '/v5/read', {
            text: 'The cat sat on the mat. It was happy.',
        });
        assert.equal(status, 200);
        assert.equal(body.words, 9);
        assert.equal(body.sentences, 2);
        assert.ok(typeof body.fleschReadingEase === 'number');
        assert.ok(typeof body.fleschKincaidGrade === 'number');
        assert.match(body.readingTime as string, /^\d+(s|min)$/);
    });
    test('missing text returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/read', {});
        assert.equal(status, 400);
    });
    test('scores French text with lang=fr', async () => {
        const { status, body } = await sendJson('POST', '/v5/read', { text: 'Salut ça va ?', lang: 'fr' });
        assert.equal(status, 200);
        assert.equal(body.lang, 'fr');
        assert.equal(body.words, 3);
        assert.equal(body.fleschKincaidGrade, null);
    });
    test('unsupported lang returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/read', { text: 'hello', lang: 'de' });
        assert.equal(status, 400);
    });
    test('GET /v5/read returns 405', async () => {
        const { status } = await getJson('/v5/read');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/read', { text: 'hello' });
        assert.equal(status, 404);
    });
});

describe('POST /v5/diff', () => {
    test('diffs two texts line by line', async () => {
        const { status, body } = await sendJson('POST', '/v5/diff', {
            a: 'line1\nline2',
            b: 'line1\nline2 edited',
        });
        assert.equal(status, 200);
        assert.equal(body.mode, 'line');
        assert.equal(body.added, 1);
        assert.equal(body.removed, 1);
        assert.deepEqual((body.changes as unknown[])[0], { type: 'equal', value: 'line1' });
    });
    test('diffs word by word', async () => {
        const { body } = await sendJson('POST', '/v5/diff', { a: 'the quick fox', b: 'the slow fox', mode: 'word' });
        assert.equal(body.mode, 'word');
        assert.equal(body.added, 1);
        assert.equal(body.removed, 1);
    });
    test('missing text returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/diff', { a: 'line1' });
        assert.equal(status, 400);
    });
    test('invalid mode returns 400', async () => {
        const { status } = await sendJson('POST', '/v5/diff', { a: 'x', b: 'y', mode: 'chars' });
        assert.equal(status, 400);
    });
    test('GET /v5/diff returns 405', async () => {
        const { status } = await getJson('/v5/diff');
        assert.equal(status, 405);
    });
    test('not available in v4 returns 404', async () => {
        const { status } = await sendJson('POST', '/v4/diff', { a: 'x', b: 'y' });
        assert.equal(status, 404);
    });
});

describe('API v6', () => {
    test('captcha defaults to challenge mode', async () => {
        const res = await fetch(`${baseUrl}/v6/captcha`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-captcha-text'), null);
        assert.ok((res.headers.get('x-captcha-token') ?? '').length > 0);
    });
    test('the generator mode stays reachable', async () => {
        const res = await fetch(`${baseUrl}/v6/captcha?mode=image&text=hello`);
        assert.equal(res.headers.get('x-captcha-text'), 'hello');
    });
    test('v5 keeps the generator as its default', async () => {
        const res = await fetch(`${baseUrl}/v5/captcha?text=hello`);
        assert.equal(res.headers.get('x-captcha-text'), 'hello');
        assert.equal(res.headers.get('x-captcha-token'), null);
    });
    test('levenshtein moved to POST', async () => {
        assert.equal((await getJson('/v6/levenshtein?str1=a&str2=b')).status, 405);
        const { status, body } = await sendJson('POST', '/v6/levenshtein', { str1: 'kitten', str2: 'sitting' });
        assert.equal(status, 200);
        assert.equal(body.distance, 3);
        assert.equal((await getJson('/v5/levenshtein?str1=a&str2=b')).status, 200);
        assert.equal((await sendJson('POST', '/v5/levenshtein', { str1: 'a', str2: 'b' })).status, 404);
    });
    test('errors report a numeric status', async () => {
        const { body } = await getJson('/v6/base');
        assert.equal(typeof body.status, 'number');
        assert.equal(body.status, 400);
    });
    test('chat and tic-tac-toe moved their identifiers into the body', async () => {
        assert.equal((await sendJson('DELETE', '/v6/chat/tok', { username: 'a', session: 'b' })).status, 404);
        assert.equal(
            (await sendJson('PATCH', '/v6/tic-tac-toe/g', { username: 'a', move: '1', session: 'b' })).status,
            404,
        );
        assert.equal((await sendJson('POST', '/v6/chat/clear', { username: 'a' })).status, 400);
        assert.equal((await sendJson('POST', '/v5/chat/clear', { username: 'a' })).status, 404);
    });
    test('v6 publishes no PATCH or DELETE surface', async () => {
        const { body } = await getJson('/v6');
        const endpoints = body.endpoints as Record<string, unknown>;
        assert.equal('patch' in endpoints, false);
        assert.equal('delete' in endpoints, false);
        const v5 = (await getJson('/v5')).body.endpoints as Record<string, unknown>;
        assert.equal('patch' in v5, true);
        assert.equal('delete' in v5, true);
    });

    test('hyperplanning is gone from v6', async () => {
        const { body } = await getJson('/v6');
        assert.equal('hyperplanning' in (body.endpoints as Record<string, Record<string, string>>).post!, false);
        assert.equal((await getJson('/v5')).status, 200);
    });
    test('rate limit headers are reported', async () => {
        const res = await fetch(`${baseUrl}/v6/color`);
        for (const header of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
            assert.notEqual(res.headers.get(header), null, `${header} should be present`);
            assert.ok(Number(res.headers.get(header)) > 0, `${header} should be a positive number`);
        }
        assert.match(res.headers.get('access-control-expose-headers') ?? '', /X-RateLimit-Remaining/);
    });

    test('hyperplanning stays functional in v6, just unlisted', async () => {
        // A loopback URL is rejected by the module itself, so the handler runs without any network call
        const v6 = await sendJson('POST', '/v6/hyperplanning', { url: 'https://127.0.0.1/a.ics' });
        const v5 = await sendJson('POST', '/v5/hyperplanning', { url: 'https://127.0.0.1/a.ics' });
        assert.equal(v6.status, 400);
        assert.equal(v6.body.error, 'Access to private/internal hosts is not allowed.');
        assert.deepEqual(v6, v5);
        assert.equal((await getJson('/v6/hyperplanning')).status, 404);
    });

    test('every tic-tac-toe route moved to its named sub-route', async () => {
        assert.equal((await sendJson('POST', '/v6/tic-tac-toe', { username: 'a', session: 'b' })).status, 404);
        assert.equal((await sendJson('DELETE', '/v6/tic-tac-toe/g', { username: 'a', session: 'b' })).status, 404);
        assert.equal((await sendJson('POST', '/v6/tic-tac-toe/play', { username: 'a' })).status, 400);
        assert.equal((await sendJson('POST', '/v6/tic-tac-toe/forfeit', { username: 'a' })).status, 400);
        assert.equal((await sendJson('POST', '/v5/tic-tac-toe/play', { username: 'a' })).status, 404);
        assert.equal((await sendJson('POST', '/v5/tic-tac-toe', { username: 'a', session: 'b' })).status, 400);
    });
});

describe('Prototype access on dynamic endpoints', () => {
    test('algorithms?method=toString returns 400', async () => {
        const { status } = await getJson('/v4/algorithms?method=toString');
        assert.equal(status, 400);
    });

    test('encode?method=constructor returns 400', async () => {
        const { status } = await getJson('/v4/encode?method=constructor&text=hello');
        assert.equal(status, 400);
    });

    test('validate?type=hasOwnProperty returns 400', async () => {
        const { status } = await getJson('/v4/validate?type=hasOwnProperty&value=test');
        assert.equal(status, 400);
    });
});

describe('GET /auth', () => {
    test('without a token reports the default tier', async () => {
        const { status, body } = await getJson('/auth');
        assert.equal(status, 200);
        assert.equal(body.authenticated, false);
        assert.equal(body.tier, 'default');
        assert.equal((body.limits as { hourly: number }).hourly, 2000);
    });

    test('an invalid token returns 401', async () => {
        const res = await fetch(`${baseUrl}/auth`, { headers: { Authorization: 'Bearer nope' } });
        assert.equal(res.status, 401);
    });

    test('never echoes the token back', async () => {
        const res = await fetch(`${baseUrl}/auth`, { headers: { Authorization: 'Bearer secret-xyz' } });
        assert.ok(!(await res.text()).includes('secret-xyz'));
    });
});

// --- 5.4.0 fixes ---

describe('Route hardening (5.4.0 fixes)', () => {
    test('repeated filter params on /headers are merged instead of crashing', async () => {
        const res = await fetch(`${baseUrl}/v4/headers?filter=host&filter=accept`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /json/);
    });

    test('unknown endpoint returns JSON 404', async () => {
        const res = await fetch(`${baseUrl}/v5/doesnotexist`);
        assert.equal(res.status, 404);
        assert.match(res.headers.get('content-type') ?? '', /json/);
    });

    test('latest redirect keeps the query string', async () => {
        const res = await fetch(`${baseUrl}/latest/case?text=hi`, { redirect: 'manual' });
        assert.equal(res.headers.get('location'), '/v6/case?text=hi');
    });

    test('latest redirect joins nested paths with slashes', async () => {
        const res = await fetch(`${baseUrl}/latest/tic-tac-toe/list`, { redirect: 'manual' });
        assert.equal(res.headers.get('location'), '/v6/tic-tac-toe/list');
    });

    test('latest redirect preserves non-GET methods with 307', async () => {
        const res = await fetch(`${baseUrl}/latest/chat/private?session=abc`, {
            method: 'POST',
            redirect: 'manual',
        });
        assert.equal(res.status, 307);
        assert.equal(res.headers.get('location'), '/v6/chat/private?session=abc');
    });

    test('token len 0 returns 400', async () => {
        const { status } = await sendJson('POST', '/v4/token', { len: 0 });
        assert.equal(status, 400);
    });

    test('the legacy versions are gone', async () => {
        for (const version of ['v1', 'v2', 'v3']) {
            const { status, body } = await getJson(`/${version}/agent`);
            assert.equal(status, 404);
            assert.match(body.error as string, /Invalid API version/);
        }
    });

    test('non-numeric count/size/width params return 400', async () => {
        assert.equal((await getJson('/v4/address?count=abc')).status, 400);
        assert.equal((await getJson('/v4/cron?expr=*%20*%20*%20*%20*&count=abc')).status, 400);
        assert.equal((await getJson('/v4/avatar?size=abc')).status, 400);
        assert.equal((await getJson('/v4/barcode?data=test&width=abc')).status, 400);
    });

    test('GET stub returns 404 when the endpoint does not exist in the version', async () => {
        assert.equal((await getJson('/v4/base?value=1')).status, 404);
        assert.equal((await getJson('/v5/jwt')).status, 405);
    });

    test('evaluate -2^2 returns -4 over HTTP', async () => {
        const { body } = await getJson('/v5/evaluate?expr=-2%5E2');
        assert.equal(body.result, -4);
    });

    test('evaluate with non-numeric precision falls back to default', async () => {
        const { status, body } = await getJson('/v5/evaluate?expr=1%2F3&precision=abc');
        assert.equal(status, 200);
        assert.equal(body.result, 0.3333333333);
    });
});

describe('Middleware order', () => {
    const post = (body: string, type = 'application/json'): Promise<Response> =>
        fetch(`${baseUrl}/v6/hash`, { method: 'POST', headers: { 'Content-Type': type }, body });

    const assertGuarded = (res: Response): void => {
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
        assert.notEqual(res.headers.get('x-ratelimit-limit'), null);
    };

    test('a malformed JSON body keeps its 400, now behind the limiter and the security headers', async () => {
        for (const version of ['v4', 'v5', 'v6']) {
            const res = await fetch(`${baseUrl}/${version}/hash`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{bad',
            });
            assert.equal(res.status, 400, version);
            assertGuarded(res);
            const body = (await res.json()) as Record<string, unknown>;
            assert.equal(body.message, 'Bad Request');
            assert.equal(body.status, 400);
        }
    });

    test('a body over 10 KB keeps its 413, now counted by the limiter', async () => {
        const before = await fetch(`${baseUrl}/v6/color`);
        const res = await post(JSON.stringify({ text: 'a'.repeat(20_000), method: 'sha256' }));
        assert.equal(res.status, 413);
        assertGuarded(res);
        const remaining = (r: Response): number => Number(r.headers.get('x-ratelimit-remaining'));
        assert.ok(remaining(res) < remaining(before));
    });

    test('a JSON body just under 10 KB is still parsed', async () => {
        const res = await post(JSON.stringify({ text: 'a'.repeat(9_000), method: 'sha256' }));
        assert.equal(res.status, 200);
        assertGuarded(res);
    });

    test('a URL-encoded body is still parsed', async () => {
        const json = await post(JSON.stringify({ text: 'a', method: 'sha256' }));
        const form = await post('text=a&method=sha256', 'application/x-www-form-urlencoded');
        assert.equal(form.status, 200);
        assert.deepEqual(await form.json(), await json.json());
    });

    test('a CORS preflight answers 204 with the security headers and no quota use', async () => {
        const res = await fetch(`${baseUrl}/v6/hash`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://example.test',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type',
            },
        });
        assert.equal(res.status, 204);
        assert.equal(res.headers.get('access-control-allow-origin'), '*');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-ratelimit-limit'), null);
    });

    test('robots.txt is still served outside the limiter', async () => {
        const res = await fetch(`${baseUrl}/robots.txt`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
        assert.equal(res.headers.get('x-ratelimit-limit'), null);
    });
});
