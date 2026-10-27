import { createCanvas, loadImage } from 'canvas';
import { toBuffer, toCanvas as qrToCanvas, toDataURL } from 'qrcode';

import { MAX_QRCODE_ICON_PIXELS, MAX_QRCODE_LOGO_BYTES, QRCODE_ICON_TIMEOUT } from '../../constants.js';
import { normalizeColor } from '../../utils/colors.js';
import { fetchRemote, type RemoteFetcher } from '../../utils/remote.js';

export interface QRCodeOptions {
    url: string;
    size?: number;
    margin?: number;
    correction?: 'L' | 'M' | 'Q' | 'H';
    dark?: string;
    light?: string;
    icon?: string;
    iconSize?: number;
    iconPadding?: number;
    iconRadius?: number;
    format?: 'png' | 'base64';
}

export interface QRCodeResult {
    contentType: string;
    body: Buffer | string;
}

const CORRECTIONS = new Set(['L', 'M', 'Q', 'H']);
const FORMATS = new Set(['png', 'base64']);

function clamp(value: number | undefined, name: string, def: number, min: number, max: number): number {
    if (value === undefined) return def;
    if (isNaN(value)) throw new Error(`${name} must be a number`);
    if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return Math.floor(value);
}

/**
 * Reads the frame sizes of a GIF, since giflib allocates every frame at its own size, not the screen size.
 *
 * @param buf - GIF file bytes
 * @returns Total pixel count of the logical screen and every frame, or null if the block structure is broken
 */
function gifPixels(buf: Buffer): number | null {
    let total = buf.readUInt16LE(6) * buf.readUInt16LE(8);
    let pos = 13 + (buf[10]! & 0x80 ? 3 << ((buf[10]! & 7) + 1) : 0);

    const skipBlocks = (at: number): number => {
        let p = at;
        while (p < buf.length && buf[p] !== 0) p += buf[p]! + 1;
        return p + 1;
    };

    while (pos < buf.length) {
        const kind = buf[pos];
        if (kind === 0x3b) return total;
        if (kind === 0x21) {
            pos = skipBlocks(pos + 2);
        } else if (kind === 0x2c) {
            if (pos + 10 > buf.length) return null;
            total += buf.readUInt16LE(pos + 5) * buf.readUInt16LE(pos + 7);
            const flags = buf[pos + 9]!;
            pos = skipBlocks(pos + 11 + (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0));
        } else {
            return null;
        }
    }
    return total;
}

/**
 * Reads the size of a JPEG from its first start-of-frame marker.
 *
 * @param buf - JPEG file bytes
 * @returns Pixel count, or null if no frame header comes before the image data
 */
function jpegPixels(buf: Buffer): number | null {
    let pos = 2;
    while (pos + 9 < buf.length) {
        if (buf[pos] !== 0xff) return null;
        const marker = buf[pos + 1]!;
        if (marker === 0xff) {
            pos++;
            continue;
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return buf.readUInt16BE(pos + 5) * buf.readUInt16BE(pos + 7);
        }
        if (marker === 0xda || marker === 0xd9) return null;
        pos += 2 + (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) ? 0 : buf.readUInt16BE(pos + 2));
    }
    return null;
}

/**
 * Reads the pixel count of a raster icon from its header, before anything is decoded.
 *
 * The magic bytes are the ones node-canvas checks to pick a decoder. Any other buffer is an SVG,
 * drawn as vectors at the icon size, or a format loadImage refuses on its own.
 *
 * @param buf - Icon file bytes
 * @returns Pixel count of a PNG, JPEG, GIF or BMP, or null for any other data
 * @throws Error if a PNG, JPEG, GIF or BMP header cannot be read
 */
function iconPixels(buf: Buffer): number | null {
    let pixels: number | null;
    if (buf.length >= 4 && buf.toString('latin1', 1, 4) === 'PNG') {
        pixels = buf.length >= 24 ? buf.readUInt32BE(16) * buf.readUInt32BE(20) : null;
    } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
        pixels = jpegPixels(buf);
    } else if (buf.length >= 3 && buf.toString('latin1', 0, 3) === 'GIF') {
        pixels = buf.length >= 13 ? gifPixels(buf) : null;
    } else if (buf.length >= 2 && buf.toString('latin1', 0, 2) === 'BM') {
        if (buf.length >= 22 && buf.readUInt32LE(14) === 12) pixels = buf.readUInt16LE(18) * buf.readUInt16LE(20);
        else pixels = buf.length >= 26 ? Math.abs(buf.readInt32LE(18) * buf.readInt32LE(22)) : null;
    } else {
        return null;
    }
    if (pixels === null) throw new Error('Icon must be a valid image');
    return pixels;
}

/**
 * Downloads the icon image, refusing internal hosts, non-image responses, bodies over 2MB and huge rasters.
 *
 * @param url - HTTPS URL of the icon
 * @param fetcher - Remote fetch implementation
 * @returns Raw image bytes
 */
async function fetchIcon(url: string, fetcher: RemoteFetcher): Promise<Buffer> {
    if (!/^https:\/\//i.test(url)) throw new Error('Icon URL must use HTTPS');

    const body = await fetcher(url, {
        maxBytes: MAX_QRCODE_LOGO_BYTES,
        timeout: QRCODE_ICON_TIMEOUT,
        messages: {
            blocked: 'Icon URL must point to a public host',
            protocol: 'Icon URL must use HTTPS',
            size: 'Icon must be under 2MB',
        },
        check: ({ ok, status, contentType }) => {
            if (!ok) throw new Error(`Failed to fetch icon: HTTP ${status}`);
            if (!contentType.startsWith('image/')) throw new Error('Icon URL must point to an image');
        },
    });

    // A few kilobytes of compressed data can declare a huge image, decoded in full by loadImage
    const pixels = iconPixels(body);
    if (pixels !== null && pixels > MAX_QRCODE_ICON_PIXELS) {
        throw new Error(`Icon must be under ${MAX_QRCODE_ICON_PIXELS / 1_000_000} megapixels`);
    }
    return body;
}

/**
 * Generates a QR code image for a given URL, with optional icon overlay and color customization.
 *
 * @param options - QR code generation options including URL, size, margin, correction level, colors, and optional icon
 * @returns Object containing the QR code as a PNG buffer or Base64 string, and the content type
 * @throws Error if the URL is missing, any option is invalid, or the icon URL cannot be fetched
 */
export default function qrcode(options: QRCodeOptions): Promise<QRCodeResult> {
    return generateQRCode(options, fetchRemote);
}

/**
 * Same as qrcode, with the remote fetch implementation passed in so tests can replace it.
 *
 * @param options - QR code generation options including URL, size, margin, correction level, colors, and optional icon
 * @param fetcher - Remote fetch implementation used for the icon, fetchRemote in production
 * @returns Object containing the QR code as a PNG buffer or Base64 string, and the content type
 * @throws Error if the URL is missing, any option is invalid, or the icon cannot be fetched or is too large
 */
export async function generateQRCode(options: QRCodeOptions, fetcher: RemoteFetcher): Promise<QRCodeResult> {
    const { url } = options;
    if (!url || typeof url !== 'string') throw new Error('Please provide a valid URL');

    const format = options.format ?? 'png';
    if (!FORMATS.has(format)) throw new Error('Format must be one of: png, base64');

    const size = clamp(options.size, 'size', 200, 50, 2000);
    const margin = clamp(options.margin, 'margin', 4, 0, 10);
    const dark = normalizeColor(options.dark, '#000000');
    const light = normalizeColor(options.light, '#ffffff');

    let correction = options.correction ?? 'M';
    if (!CORRECTIONS.has(correction)) throw new Error('Correction must be one of: L, M, Q, H');
    if (options.icon) correction = 'H';

    const qrOpts = {
        width: size,
        margin,
        errorCorrectionLevel: correction as 'L' | 'M' | 'Q' | 'H',
        color: { dark, light },
    };

    if (!options.icon) {
        if (format === 'base64') {
            return { contentType: 'application/json', body: await toDataURL(url, qrOpts) };
        }
        return { contentType: 'image/png', body: await toBuffer(url, qrOpts) };
    }

    const canvas = createCanvas(size, size);
    await qrToCanvas(canvas as unknown as HTMLCanvasElement, url, qrOpts);

    const iconBuffer = await fetchIcon(options.icon, fetcher);
    const iconImg = await loadImage(iconBuffer);

    const iconSize = clamp(options.iconSize, 'iconSize', Math.round(size * 0.2), 10, Math.round(size * 0.4));
    const iconPadding = clamp(options.iconPadding, 'iconPadding', 5, 0, 50);
    const maxRadius = Math.floor((iconSize + iconPadding * 2) / 2);
    const iconRadius = clamp(options.iconRadius, 'iconRadius', 0, 0, maxRadius);

    const ctx = canvas.getContext('2d');
    const totalSize = iconSize + iconPadding * 2;
    const x = (canvas.width - totalSize) / 2;
    const y = (canvas.height - totalSize) / 2;

    ctx.beginPath();
    ctx.roundRect(x, y, totalSize, totalSize, iconRadius);
    ctx.fillStyle = light;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + iconPadding, y + iconPadding, iconSize, iconSize, Math.max(0, iconRadius - iconPadding));
    ctx.clip();
    ctx.drawImage(iconImg, x + iconPadding, y + iconPadding, iconSize, iconSize);
    ctx.restore();

    if (format === 'base64') {
        return { contentType: 'application/json', body: canvas.toDataURL('image/png') };
    }
    return { contentType: 'image/png', body: canvas.toBuffer('image/png') };
}
