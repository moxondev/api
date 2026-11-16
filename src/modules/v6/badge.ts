import { normalizeColor } from '../../utils/colors.js';
import {
    FALLBACK_WIDTH,
    MONO_ADVANCE,
    SANS_BOLD,
    SANS_REGULAR,
    SERIF_BOLD,
    SERIF_REGULAR,
    UNITS_PER_EM,
    type WidthRanges,
} from '../../utils/fonts.js';
import { FILLED_ICONS, ICONS } from '../../utils/icons.js';

export interface BadgeOptions {
    label: string;
    icon?: string;
    trail?: string;
    start?: string;
    end?: string;
    ink?: string;
    message?: string;
    messageStart?: string;
    messageEnd?: string;
    messageInk?: string;
    border?: string;
    size?: string;
    font?: string;
    weight?: string;
    lift?: number;
    radius?: number;
    angle?: number;
}

export interface BadgeResult {
    contentType: string;
    body: string;
}

type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';
type BadgeFont = 'sans' | 'serif' | 'mono';
type BadgeWeight = 'normal' | 'bold';

interface SizeSpec {
    height: number;
    pad: number;
    icon: number;
    gap: number;
    font: number;
    stroke: number;
}

// Height, side padding, icon size, gap, font size and stroke width (in the 24-unit icon grid)
const SIZES: Record<BadgeSize, SizeSpec> = {
    xs: { height: 16, pad: 6, icon: 10, gap: 4, font: 10, stroke: 2.4 },
    sm: { height: 20, pad: 8, icon: 12, gap: 6, font: 11, stroke: 2.2 },
    md: { height: 24, pad: 10, icon: 14, gap: 6, font: 12, stroke: 2.1 },
    lg: { height: 28, pad: 12, icon: 16, gap: 7, font: 13, stroke: 2.1 },
};

const MAX_LABEL = 64;
const MAX_LIFT = 10;
const MAX_RADIUS = 100;
const MAX_ANGLE = 360;
const DEFAULT_MESSAGE_START = '#0969da';
const DEFAULT_START = '#2d333b';
const DEFAULT_INK = '#ffffff';

/**
 * Font stacks: the first family installed on the viewer's system is drawn. The text is measured with DejaVu, so a
 * different family only changes the spacing, as textLength stretches it to the measured width
 */
const FONT_STACKS: Record<BadgeFont, string> = {
    sans: 'Verdana,DejaVu Sans,Geneva,sans-serif',
    serif: 'Georgia,DejaVu Serif,Times New Roman,serif',
    mono: 'Menlo,DejaVu Sans Mono,Consolas,monospace',
};

// The SVG font-weight of each weight, 600 being drawn in the bold face
const FONT_WEIGHTS: Record<BadgeWeight, string> = { normal: '400', bold: '600' };

/**
 * Flattens compact width ranges into a map by code point.
 *
 * @param ranges - First code point and consecutive widths
 * @returns The widths by code point
 */
function flatten(ranges: WidthRanges): Map<number, number> {
    const widths = new Map<number, number>();
    for (const [first, list] of ranges) list.forEach((width, offset) => widths.set(first + offset, width));
    return widths;
}

const SANS = { normal: flatten(SANS_REGULAR), bold: flatten(SANS_BOLD) };
const SERIF = { normal: flatten(SERIF_REGULAR), bold: flatten(SERIF_BOLD) };

/**
 * Every character of the covered ranges has the same advance in the monospace face, but the ones without width in
 * the sans face (soft hyphen, combining marks) are stacked on the previous letter or invisible there too
 */
const MONO_WIDTHS = new Map<number, number>();
for (const [code, width] of SANS.bold) MONO_WIDTHS.set(code, width === 0 ? 0 : MONO_ADVANCE);

// Widths by code point of each face, flattened once from the compact ranges
const WIDTHS: Record<BadgeFont, Record<BadgeWeight, Map<number, number>>> = {
    sans: SANS,
    serif: SERIF,
    mono: { normal: MONO_WIDTHS, bold: MONO_WIDTHS },
};

/**
 * Escapes the characters that are special in XML text and attribute values.
 *
 * @param text - Raw text
 * @returns The text with &, <, >, " and ' replaced by entities
 */
function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Measures a text in a badge font.
 *
 * @param label - Text to measure
 * @param fontSize - Font size in pixels
 * @param widths - Widths by code point of the font face
 * @returns The width in pixels, rounded to a whole number
 */
function measure(label: string, fontSize: number, widths: Map<number, number>): number {
    let units = 0;
    for (const char of label) units += widths.get(char.codePointAt(0)!) ?? FALLBACK_WIDTH;
    return Math.round((units / UNITS_PER_EM) * fontSize);
}

/**
 * Characters a badge text cannot hold: controls, format and default-ignorable characters (soft hyphen, word
 * joiner, filler letters, tags, bidirectional marks), line separators, lone surrogates, noncharacters and the
 * blank Braille pattern. Variation selectors are tested apart, as emoji need them.
 */
const FORBIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}⠀￾￿]/u;

// A text needs a character that draws something: not a space, a combining mark or a variation selector
const VISIBLE_CHAR = /[^\s\p{M}]/u;

/**
 * Validates a text of the badge: a non-empty string without control or invisible characters, within the length
 * limit, and with at least one character that draws something.
 *
 * The text is put in canonical composed form, so a letter followed by a combining accent is measured and
 * drawn like the single accented letter, and runs of spaces collapse into one, as an SVG renders them.
 *
 * @param value - Raw text
 * @param name - Parameter name used in the error messages, label or message
 * @returns The cleaned text
 * @throws Error if the text is missing, too long or holds forbidden characters
 */
function parseText(value: unknown, name: 'label' | 'message'): string {
    const title = name === 'label' ? 'Label' : 'Message';
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(name === 'label' ? 'Please provide a label (?label={text})' : 'Please provide a valid message');
    }
    // A code point takes at most two UTF-16 units, so this bounds the work before the text is walked
    if (value.length > MAX_LABEL * 2 * 4) throw new Error(`${title} cannot exceed ${MAX_LABEL} characters`);
    const composed = value.normalize('NFC');
    const invisible = `${title} cannot contain control or invisible characters`;
    for (const char of composed) {
        const code = char.codePointAt(0)!;
        const selector = code >= 0xfe00 && code <= 0xfe0f;
        if (FORBIDDEN_CHARS.test(char) && !selector) throw new Error(invisible);
    }
    const text = composed.replace(/ {2,}/g, ' ').trim();
    if (!VISIBLE_CHAR.test(text)) throw new Error(invisible);
    if ([...text].length > MAX_LABEL) throw new Error(`${title} cannot exceed ${MAX_LABEL} characters`);
    return text;
}

/**
 * Rounds a number to two decimals, so computed dimensions carry no floating-point noise.
 *
 * @param value - Number to round
 * @returns The number with at most two decimals
 */
function round(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Validates an optional number within a range and keeps two decimals at most.
 *
 * @param value - Raw number, undefined when absent
 * @param name - Parameter name used in the error message
 * @param max - Largest accepted value
 * @returns The number rounded to two decimals, or undefined when the value is absent
 * @throws Error if the value is not a finite number from 0 to max
 */
function parseNumber(value: unknown, name: string, max: number): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
        throw new Error(`Invalid ${name} (use a number from 0 to ${max})`);
    }
    return round(value);
}

/**
 * Validates an optional color and returns it with its leading #.
 *
 * @param value - Raw color, a hex value with or without the #
 * @param name - Parameter name used in the error message
 * @param fallback - Color used when the value is absent
 * @returns A #rgb or #rrggbb color
 * @throws Error if the value is not a hex color
 */
function parseColor(value: unknown, name: string, fallback: string): string {
    if (value !== undefined && typeof value !== 'string') throw new Error(`Please provide a valid ${name} color`);
    try {
        return normalizeColor(value || undefined, fallback);
    } catch {
        throw new Error(`Invalid ${name} color (use hex like ff6600)`);
    }
}

/**
 * Looks up an icon by name.
 *
 * @param value - Raw icon name
 * @param name - Parameter name used in the error message
 * @returns The icon body and whether it is filled rather than stroked, or null when no icon was asked for
 * @throws Error if the name is not a bundled icon
 */
function parseIcon(value: unknown, name: string): { body: string; filled: boolean } | null {
    if (value === undefined || value === '') return null;
    const kind = name === 'icon' ? 'icon' : `${name} icon`;
    if (typeof value !== 'string') throw new Error(`Please provide a valid ${kind} name`);
    if (Object.hasOwn(ICONS, value)) return { body: ICONS[value]!, filled: false };
    if (Object.hasOwn(FILLED_ICONS, value)) return { body: FILLED_ICONS[value]!, filled: true };
    throw new Error(`Unknown ${kind} "${value.slice(0, 40)}"`);
}

/**
 * Places an icon at (x, y), scaled from its 24-unit grid to the badge icon size.
 *
 * @param icon - Icon body and whether it is filled
 * @param x - Left edge in pixels
 * @param y - Top edge in pixels
 * @param size - Size specification of the badge
 * @param ink - Icon color
 * @returns An SVG group
 */
function place(icon: { body: string; filled: boolean }, x: number, y: number, size: SizeSpec, ink: string): string {
    const transform = `translate(${x} ${y}) scale(${(size.icon / 24).toFixed(4)})`;
    if (icon.filled) return `<g transform="${transform}" fill="${ink}">${icon.body}</g>`;
    return (
        `<g transform="${transform}" color="${ink}" fill="none" stroke="${ink}" stroke-width="${size.stroke}" ` +
        `stroke-linecap="round" stroke-linejoin="round">${icon.body}</g>`
    );
}

/**
 * Builds the gradient definition of a badge part.
 *
 * Without an angle the gradient runs corner to corner. With one it follows the CSS convention: 90 runs from
 * left to right, 180 from top to bottom.
 *
 * @param id - Identifier of the gradient
 * @param start - Color at the start of the gradient
 * @param end - Color at the end of the gradient
 * @param angle - Direction in degrees, or undefined for the corner to corner default
 * @returns A linearGradient element
 */
function gradient(id: string, start: string, end: string, angle: number | undefined): string {
    let points = 'x1="0" y1="0" x2="1" y2="1"';
    if (angle !== undefined) {
        const radians = (angle * Math.PI) / 180;
        // The reach grows towards the diagonals, so that 135 degrees runs from corner to corner like the default
        const reach = Math.abs(Math.sin(radians)) + Math.abs(Math.cos(radians));
        const dx = (Math.sin(radians) * reach) / 2;
        const dy = (-Math.cos(radians) * reach) / 2;
        const at = (value: number): number => Number(value.toFixed(4));
        points = `x1="${at(0.5 - dx)}" y1="${at(0.5 - dy)}" x2="${at(0.5 + dx)}" y2="${at(0.5 + dy)}"`;
    }
    return (
        `<linearGradient id="${id}" ${points}>` +
        `<stop offset="0" stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient>`
    );
}

/**
 * Builds a badge as a standalone SVG: an optional leading icon, a label and an optional trailing icon on a
 * gradient background, with an optional second part holding a message.
 *
 * @param options - Badge options; only the label is required
 * @returns The content type and the SVG markup
 * @throws Error if a text, a color, an icon name, the size, the font, the weight, the lift, the radius or the angle
 * is invalid
 */
export default function badge(options: BadgeOptions): BadgeResult {
    const label = parseText(options.label, 'label');
    const message =
        options.message === undefined || options.message === '' ? null : parseText(options.message, 'message');
    const start = parseColor(options.start, 'start', DEFAULT_START);
    const end = parseColor(options.end, 'end', start);
    const ink = parseColor(options.ink, 'ink', DEFAULT_INK);
    const messageStart = parseColor(options.messageStart, 'messageStart', DEFAULT_MESSAGE_START);
    const messageEnd = parseColor(options.messageEnd, 'messageEnd', messageStart);
    const messageInk = parseColor(options.messageInk, 'messageInk', ink);
    const border = options.border ? parseColor(options.border, 'border', '') : null;
    const lead = parseIcon(options.icon, 'icon');
    const trail = parseIcon(options.trail, 'trail');

    const sizeName = options.size ?? 'sm';
    if (typeof sizeName !== 'string' || !Object.hasOwn(SIZES, sizeName)) {
        throw new Error('Invalid size (use xs, sm, md or lg)');
    }
    const size = SIZES[sizeName as BadgeSize];

    const fontName = options.font ?? 'sans';
    if (typeof fontName !== 'string' || !Object.hasOwn(FONT_STACKS, fontName)) {
        throw new Error('Invalid font (use sans, serif or mono)');
    }
    const weightName = options.weight ?? 'bold';
    if (typeof weightName !== 'string' || !Object.hasOwn(FONT_WEIGHTS, weightName)) {
        throw new Error('Invalid weight (use normal or bold)');
    }
    const widths = WIDTHS[fontName as BadgeFont][weightName as BadgeWeight];
    const fontFamily = FONT_STACKS[fontName as BadgeFont];
    const fontWeight = FONT_WEIGHTS[weightName as BadgeWeight];

    const lift = parseNumber(options.lift, 'lift', MAX_LIFT) ?? 0;
    const rawRadius = parseNumber(options.radius, 'radius', MAX_RADIUS);
    const rawAngle = parseNumber(options.angle, 'angle', MAX_ANGLE);
    const angle = rawAngle === undefined ? undefined : Math.round(rawAngle);

    const { height, pad, icon, gap } = size;
    // The default radius is the pill, and a larger one cannot do more than that
    const radius = Math.min(rawRadius ?? height / 2, height / 2);
    const baseline = (height / 2 + size.font * 0.36).toFixed(1);
    const pieces: string[] = [];

    // Leading part: icon and label
    const labelWidth = measure(label, size.font, widths);
    const text = escapeXml(label);
    let x = pad;
    if (lead) {
        pieces.push(place(lead, x, (height - icon) / 2, size, ink));
        x += icon + gap;
    }
    pieces.push(
        `<text x="${x}" y="${baseline}" fill="${ink}" font-family="${fontFamily}" font-weight="${fontWeight}" ` +
            `font-size="${size.font}" textLength="${labelWidth}">${text}</text>`,
    );
    x += labelWidth;

    // A single part carries the trailing icon itself, a second part carries it after the message
    let split = 0;
    let messageText = '';
    if (message) {
        split = x + pad;
        const messageWidth = measure(message, size.font, widths);
        messageText = escapeXml(message);
        x = split + pad;
        pieces.push(
            `<text x="${x}" y="${baseline}" fill="${messageInk}" font-family="${fontFamily}" font-weight="${fontWeight}" ` +
                `font-size="${size.font}" textLength="${messageWidth}">${messageText}</text>`,
        );
        x += messageWidth;
    }
    if (trail) {
        x += gap - 1;
        pieces.push(place(trail, x, (height - icon) / 2, size, message ? messageInk : ink));
        x += icon;
    }

    const width = x + pad;
    const inset = border ? 0.5 : 0;
    const box = Math.round((height + 2 * lift) * 100) / 100;
    const title = message ? `${text}: ${messageText}` : text;
    // Same colors give the same id, so several badges inlined in one page never clash
    const tail = angle === undefined ? '' : `-${angle}`;
    const id = `g-${start.slice(1)}-${end.slice(1)}${tail}`;
    const stroke = border ? ` stroke="${border}" stroke-width="1"` : '';

    let defs = gradient(id, start, end, angle);
    let shape: string;
    if (!message) {
        shape =
            `<rect x="${inset}" y="${inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" ` +
            `rx="${round(Math.max(radius - inset, 0))}" fill="url(#${id})"${stroke}/>`;
    } else {
        const messageId = `m-${messageStart.slice(1)}-${messageEnd.slice(1)}${tail}`;
        const clipId = `c-${width}-${height}-${radius}${border ? '-b' : ''}`;
        const clipRadius = round(Math.max(radius - inset, 0));
        defs += gradient(messageId, messageStart, messageEnd, angle);
        defs +=
            `<clipPath id="${clipId}"><rect x="${inset}" y="${inset}" width="${width - 2 * inset}" ` +
            `height="${height - 2 * inset}" rx="${clipRadius}"/></clipPath>`;
        // The leading part runs one pixel under the trailing one, so no seam shows between them when scaled
        shape =
            `<g clip-path="url(#${clipId})">` +
            `<rect width="${Math.min(split + 1, width)}" height="${height}" fill="url(#${id})"/>` +
            `<rect x="${split}" width="${width - split}" height="${height}" fill="url(#${messageId})"/></g>`;
        if (border) {
            shape +=
                `\n<rect x="${inset}" y="${inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" ` +
                `rx="${clipRadius}" fill="none"${stroke}/>`;
        }
    }

    const body =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${box}" viewBox="0 0 ${width} ${box}" ` +
        `role="img" aria-label="${title}">\n<title>${title}</title>\n` +
        `<defs>${defs}</defs>\n` +
        shape +
        '\n' +
        pieces.join('\n') +
        '\n</svg>\n';

    return { contentType: 'image/svg+xml', body };
}
