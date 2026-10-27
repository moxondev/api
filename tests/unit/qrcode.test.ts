import { strict as assert } from 'node:assert';
import { BlockList } from 'node:net';
import { describe, test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';

import { createCanvas } from 'canvas';

import { MAX_QRCODE_ICON_PIXELS, MAX_QRCODE_LOGO_BYTES } from '../../src/constants.js';
import qrcode, { generateQRCode } from '../../src/modules/v4/qrcode.js';
import { fetchRemote, type RemoteFetcher, type RemoteOptions } from '../../src/utils/remote.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const ICON = createCanvas(16, 16).toBuffer('image/png');

/**
 * Wraps data into a PNG chunk with its length and CRC.
 *
 * @param type - Four-letter chunk type
 * @param data - Chunk payload
 * @returns Encoded chunk
 */
function pngChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
}

/**
 * Builds a valid black-and-white PNG, a few kilobytes even for huge sizes since its rows compress to nothing.
 *
 * @param width - Width in pixels
 * @param height - Height in pixels
 * @returns PNG file bytes
 */
function blankPng(width: number, height: number): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 1;
    const rows = deflateSync(Buffer.alloc(height * (1 + Math.ceil(width / 8))), { level: 9 });
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', rows),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * Builds a GIF with a 1x1 logical screen and a single frame of any declared size.
 *
 * @param width - Declared frame width
 * @param height - Declared frame height
 * @returns GIF file bytes, with a placeholder image data block
 */
function gifFrame(width: number, height: number): Buffer {
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(width, 5);
    descriptor.writeUInt16LE(height, 7);
    return Buffer.concat([
        Buffer.from('GIF89a', 'latin1'),
        Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]),
        Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0]),
        descriptor,
        Buffer.from([2, 2, 0x4c, 0x01, 0, 0x3b]),
    ]);
}

/**
 * Rewrites the size in the start-of-frame header of a JPEG.
 *
 * @param jpeg - JPEG file bytes with a baseline SOF0 header
 * @param width - Declared width
 * @param height - Declared height
 * @returns Copy of the file declaring the new size
 */
function resizeJpeg(jpeg: Buffer, width: number, height: number): Buffer {
    const copy = Buffer.from(jpeg);
    const sof = copy.indexOf(Buffer.from([0xff, 0xc0]));
    copy.writeUInt16BE(height, sof + 5);
    copy.writeUInt16BE(width, sof + 7);
    return copy;
}

/**
 * Builds a fetcher that answers every icon URL with the same response, without any network access.
 *
 * @param body - Response body
 * @param status - HTTP status of the response
 * @param contentType - Content-Type header of the response
 * @returns Fetcher running the module's response check before returning the body
 */
function mockFetch(body: Buffer, status = 200, contentType = 'image/png'): RemoteFetcher {
    return async (_url, options) => {
        options.check?.({ status, ok: status >= 200 && status <= 299, contentType });
        return body;
    };
}

/**
 * Builds a fetcher that runs the real helper with extra options merged over the module's ones.
 *
 * @param extra - Options added to the ones the module passes
 * @returns Fetcher wrapping fetchRemote
 */
function realFetch(extra: Partial<RemoteOptions>): RemoteFetcher {
    return (url, options) => fetchRemote(url, { ...options, ...extra });
}

describe('qrcode', () => {
    test('returns PNG buffer by default', async () => {
        const result = await qrcode({ url: 'https://example.com' });
        assert.equal(result.contentType, 'image/png');
        assert.ok(Buffer.isBuffer(result.body));
        assert.ok((result.body as Buffer).subarray(0, 4).equals(PNG_MAGIC));
    });

    test('returns data URL with format=base64', async () => {
        const result = await qrcode({ url: 'https://example.com', format: 'base64' });
        assert.equal(result.contentType, 'application/json');
        assert.match(result.body as string, /^data:image\/png;base64,/);
    });

    test('throws on invalid format', async () => {
        await assert.rejects(() => qrcode({ url: 'https://example.com', format: 'jpg' as 'png' }), /format/i);
    });

    test('throws on missing url', async () => {
        await assert.rejects(() => qrcode({ url: '' }));
    });

    test('accepts custom size', async () => {
        const result = await qrcode({ url: 'https://example.com', size: 400 });
        assert.equal(result.contentType, 'image/png');
    });

    test('throws on invalid size', async () => {
        await assert.rejects(() => qrcode({ url: 'https://example.com', size: 9999 }), /size/);
    });

    test('accepts custom colors', async () => {
        const result = await qrcode({ url: 'https://example.com', dark: 'ff0000', light: 'ffffff' });
        assert.equal(result.contentType, 'image/png');
    });

    test('throws on invalid dark color', async () => {
        await assert.rejects(() => qrcode({ url: 'https://example.com', dark: 'xyz' }), /color/i);
    });

    test('throws on invalid light color', async () => {
        await assert.rejects(() => qrcode({ url: 'https://example.com', light: 'nope' }), /color/i);
    });

    test('accepts correction level', async () => {
        const result = await qrcode({ url: 'https://example.com', correction: 'H' });
        assert.equal(result.contentType, 'image/png');
    });

    test('throws on invalid correction level', async () => {
        await assert.rejects(() => qrcode({ url: 'https://example.com', correction: 'X' as 'L' }), /correction/i);
    });

    test('accepts custom margin', async () => {
        const result = await qrcode({ url: 'https://example.com', margin: 0 });
        assert.equal(result.contentType, 'image/png');
    });

    test('throws on invalid margin', async () => {
        await assert.rejects(() => qrcode({ url: 'https://example.com', margin: 99 }), /margin/);
    });

    test('throws on non-HTTPS icon URL', async () => {
        await assert.rejects(
            () => qrcode({ url: 'https://example.com', icon: 'http://example.com/icon.png' }),
            /HTTPS/,
        );
    });

    test('throws on unreachable icon URL', async () => {
        const fetcher = realFetch({
            blocklist: new BlockList(),
            resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        });
        await assert.rejects(
            () => generateQRCode({ url: 'https://example.com', icon: 'https://unreachable.test:1/nope.png' }, fetcher),
            /^Error: fetch failed$/,
        );
    });

    test('overlays an icon returned by the fetcher', async () => {
        const plain = await qrcode({ url: 'https://example.com', correction: 'H' });
        const result = await generateQRCode(
            { url: 'https://example.com', icon: 'https://cdn.test/icon.png' },
            mockFetch(ICON),
        );
        assert.equal(result.contentType, 'image/png');
        assert.ok((result.body as Buffer).subarray(0, 4).equals(PNG_MAGIC));
        assert.notDeepEqual(result.body, plain.body);
    });

    test('fetches the icon with a 2MB limit and a 5 s timeout', async () => {
        let seen: RemoteOptions | undefined;
        const fetcher: RemoteFetcher = async (url, options) => {
            seen = options;
            return mockFetch(ICON)(url, options);
        };
        await generateQRCode({ url: 'https://example.com', icon: 'https://cdn.test/icon.png' }, fetcher);
        assert.equal(seen?.maxBytes, MAX_QRCODE_LOGO_BYTES);
        assert.equal(seen?.timeout, 5000);
        assert.equal(seen?.messages?.size, 'Icon must be under 2MB');
    });

    test('keeps the HTTP status message for a failing icon host', async () => {
        await assert.rejects(
            () =>
                generateQRCode({ url: 'https://example.com', icon: 'https://cdn.test/icon.png' }, mockFetch(ICON, 404)),
            /^Error: Failed to fetch icon: HTTP 404$/,
        );
    });

    test('rejects an icon that is not an image', async () => {
        await assert.rejects(
            () =>
                generateQRCode(
                    { url: 'https://example.com', icon: 'https://cdn.test/icon.png' },
                    mockFetch(ICON, 200, 'text/html'),
                ),
            /^Error: Icon URL must point to an image$/,
        );
    });
});

describe('qrcode icon SSRF protection', () => {
    test('refuses icons on loopback, private, link-local and mapped hosts', async () => {
        for (const icon of [
            'https://localhost:1/nope.png',
            'https://127.0.0.1/icon.png',
            'https://10.0.0.1/icon.png',
            'https://169.254.169.254/latest/meta-data',
            'https://[::1]/icon.png',
            'https://[::ffff:192.168.0.1]/icon.png',
            'https://100.64.0.1/icon.png',
        ]) {
            await assert.rejects(
                () => qrcode({ url: 'https://example.com', icon }),
                /^Error: Icon URL must point to a public host$/,
                icon,
            );
        }
    });

    test('refuses an icon host that resolves to a private address', async () => {
        const fetcher = realFetch({ resolve: async () => [{ address: '192.168.1.10', family: 4 }] });
        await assert.rejects(
            () => generateQRCode({ url: 'https://example.com', icon: 'https://rebind.test/icon.png' }, fetcher),
            /public host/,
        );
    });
});

describe('qrcode icon decompression bombs', () => {
    const options = { url: 'https://example.com', icon: 'https://cdn.test/icon.png' };

    test('refuses a 31 KB PNG declaring 16000x16000 pixels before decoding it', async () => {
        const bomb = blankPng(16000, 16000);
        assert.ok(bomb.length < 40_000);
        const start = performance.now();
        await assert.rejects(
            () => generateQRCode(options, mockFetch(bomb)),
            /^Error: Icon must be under 16 megapixels$/,
        );
        assert.ok(performance.now() - start < 200, `took ${performance.now() - start} ms`);
    });

    test('refuses JPEG, BMP and GIF headers declaring more than the pixel cap', async () => {
        const bmp = Buffer.alloc(54);
        bmp.write('BM', 0, 'latin1');
        bmp.writeUInt32LE(40, 14);
        bmp.writeInt32LE(8000, 18);
        bmp.writeInt32LE(-8000, 22);
        const jpeg = resizeJpeg(createCanvas(8, 8).toBuffer('image/jpeg'), 20000, 20000);
        for (const bomb of [jpeg, bmp, gifFrame(30000, 30000)]) {
            await assert.rejects(() => generateQRCode(options, mockFetch(bomb)), /16 megapixels/);
        }
    });

    test('counts every GIF frame, not only the logical screen', async () => {
        assert.equal(MAX_QRCODE_ICON_PIXELS, 16_000_000);
        await assert.rejects(() => generateQRCode(options, mockFetch(gifFrame(5000, 5000))), /16 megapixels/);
    });

    test('refuses a raster icon whose header is cut short', async () => {
        await assert.rejects(
            () => generateQRCode(options, mockFetch(ICON.subarray(0, 20))),
            /^Error: Icon must be a valid image$/,
        );
        await assert.rejects(
            () => generateQRCode(options, mockFetch(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))),
            /^Error: Icon must be a valid image$/,
        );
    });

    test('still overlays ordinary PNG, JPEG, GIF and SVG icons', async () => {
        const canvas = createCanvas(64, 48);
        canvas.getContext('2d').fillRect(0, 0, 32, 24);
        const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12000" height="12000"><rect/></svg>');
        for (const icon of [
            canvas.toBuffer('image/png'),
            canvas.toBuffer('image/jpeg'),
            gif,
            svg,
            blankPng(2000, 2000),
        ]) {
            const result = await generateQRCode(options, mockFetch(icon));
            assert.ok((result.body as Buffer).subarray(0, 4).equals(PNG_MAGIC));
        }
    });

    test('leaves other data to the image decoder, as before', async () => {
        await assert.rejects(() => generateQRCode(options, mockFetch(Buffer.from('hello'))), /Unsupported image type/);
    });

    test('ignores extra positional arguments, so it can be passed to Array.prototype.map', async () => {
        const loose = qrcode as (...args: unknown[]) => Promise<unknown>;
        await assert.rejects(
            () => loose({ url: 'https://example.com', icon: 'https://127.0.0.1/icon.png' }, 0, []),
            /public host/,
        );
    });
});
