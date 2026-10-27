import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import captcha from '../../src/modules/v4/captcha.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Reads the width of a PNG from its header.
 *
 * @param png - PNG file bytes
 * @returns Width in pixels, as stored in the IHDR chunk
 */
const pngWidth = (png: Buffer): number => png.readUInt32BE(16);

describe('captcha', () => {
    test('returns PNG buffer with provided text', () => {
        const result = captcha({ text: 'hello' });
        assert.equal(result.contentType, 'image/png');
        assert.ok(Buffer.isBuffer(result.body));
        assert.ok(result.body.subarray(0, 4).equals(PNG_MAGIC));
        assert.equal(result.text, 'hello');
    });

    test('auto-generates text when none provided', () => {
        const result = captcha({});
        assert.equal(result.text.length, 6);
        assert.ok(Buffer.isBuffer(result.body));
    });

    test('respects custom length', () => {
        const result = captcha({ length: 10 });
        assert.equal(result.text.length, 10);
    });

    test('throws on invalid length', () => {
        assert.throws(() => captcha({ length: 0 }), /length/);
        assert.throws(() => captcha({ length: 99 }), /length/);
    });

    test('accepts custom dimensions', () => {
        const result = captcha({ text: 'AB', width: 200, height: 80 });
        assert.ok(Buffer.isBuffer(result.body));
    });

    test('throws on invalid dimensions', () => {
        assert.throws(() => captcha({ text: 'AB', width: 10 }), /width/);
        assert.throws(() => captcha({ text: 'AB', height: 500 }), /height/);
    });

    test('accepts noise levels', () => {
        for (const noise of ['low', 'medium', 'high'] as const) {
            const result = captcha({ text: 'test', noise });
            assert.ok(Buffer.isBuffer(result.body));
        }
    });

    test('throws on invalid noise', () => {
        assert.throws(() => captcha({ text: 'test', noise: 'extreme' as 'low' }), /noise/i);
    });

    test('accepts custom colors', () => {
        const result = captcha({ text: 'test', bg: 'f0f0f0', color: '333333' });
        assert.ok(Buffer.isBuffer(result.body));
    });

    test('throws on invalid color', () => {
        assert.throws(() => captcha({ text: 'test', bg: 'xyz' }), /color/i);
    });

    test('accepts a custom text of up to 32 characters', () => {
        const result = captcha({ text: 'a'.repeat(32) });
        assert.equal(result.text, 'a'.repeat(32));
    });

    test('rejects a custom text longer than 32 characters', () => {
        assert.throws(() => captcha({ text: 'W'.repeat(33) }), /Text cannot exceed 32 characters/);
        assert.throws(() => captcha({ text: 'W'.repeat(540), height: 400, noise: 'high' }), /Text cannot exceed/);
    });

    test('keeps the default width of short texts', () => {
        assert.equal(pngWidth(captcha({ text: 'hello' }).body), 300);
        assert.equal(pngWidth(captcha({}).body), 360);
        assert.equal(pngWidth(captcha({ text: 'AB', width: 200 }).body), 200);
    });

    test('keeps 60 px per character as the default width of long texts, as before', () => {
        assert.equal(pngWidth(captcha({ length: 14 }).body), 840);
        assert.equal(pngWidth(captcha({ length: 20 }).body), 1200);
        assert.equal(pngWidth(captcha({ text: 'a'.repeat(32) }).body), 1920);
    });
});
