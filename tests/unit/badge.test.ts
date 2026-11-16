import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import badge from '../../src/modules/v6/badge.js';
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
import { FILLED_ICONS, ICONS } from '../../src/utils/icons.js';

const SIZES = {
    xs: { height: 16, pad: 6, icon: 10, gap: 4, font: 10 },
    sm: { height: 20, pad: 8, icon: 12, gap: 6, font: 11 },
    md: { height: 24, pad: 10, icon: 14, gap: 6, font: 12 },
    lg: { height: 28, pad: 12, icon: 16, gap: 7, font: 13 },
} as const;

const SHAPES = new Set(['path', 'circle', 'line', 'rect', 'polyline', 'polygon', 'ellipse']);

/**
 * Renders a badge and returns its SVG markup.
 *
 * @param options - Badge options
 * @returns The SVG body
 */
function svg(options: Parameters<typeof badge>[0]): string {
    return badge(options).body;
}

/**
 * Lists the distinct element names used in a piece of markup.
 *
 * @param markup - SVG or SVG fragment
 * @returns The set of tag names
 */
function tags(markup: string): Set<string> {
    return new Set([...markup.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((match) => match[1]!));
}

/**
 * Reads a numeric attribute of the first element matching a tag.
 *
 * @param markup - SVG markup
 * @param tag - Element name
 * @param name - Attribute name
 * @returns The attribute value as a string
 */
function attr(markup: string, tag: string, name: string): string {
    const element = markup.match(new RegExp(`<${tag}\\b[^>]*>`));
    assert.ok(element, `<${tag}> not found`);
    const value = element[0].match(new RegExp(`\\s${name}="([^"]*)"`));
    assert.ok(value, `${name} not found on <${tag}>`);
    return value[1]!;
}

/**
 * Lists the attribute names of an opening tag, skipping anything inside quoted values.
 *
 * @param tag - Opening tag markup
 * @returns The attribute names in order
 */
function attrNames(tag: string): string[] {
    return [...tag.matchAll(/\s([\w:-]+)="[^"]*"/g)].map((match) => match[1]!);
}

type Font = 'sans' | 'serif' | 'mono';
type Weight = 'normal' | 'bold';
type Face = { font: Font; weight: Weight };

const DEFAULT_FACE: Face = { font: 'sans', weight: 'bold' };
const FONTS: Font[] = ['sans', 'serif', 'mono'];
const WEIGHTS: Weight[] = ['normal', 'bold'];
const STACKS: Record<Font, string> = {
    sans: 'Verdana,DejaVu Sans,Geneva,sans-serif',
    serif: 'Georgia,DejaVu Serif,Times New Roman,serif',
    mono: 'Menlo,DejaVu Sans Mono,Consolas,monospace',
};
const FONT_WEIGHTS: Record<Weight, string> = { normal: '400', bold: '600' };
const TABLES: Record<'sans' | 'serif', Record<Weight, WidthRanges>> = {
    sans: { normal: SANS_REGULAR, bold: SANS_BOLD },
    serif: { normal: SERIF_REGULAR, bold: SERIF_BOLD },
};

/**
 * Looks up the advance width of a code point in a width table.
 *
 * @param code - Unicode code point
 * @param ranges - Width table, the sans bold one by default
 * @returns The advance in font units, or undefined when the table has no entry
 */
function tableWidth(code: number, ranges: WidthRanges = SANS_BOLD): number | undefined {
    for (const [first, widths] of ranges) {
        if (code >= first && code < first + widths.length) return widths[code - first];
    }
    return undefined;
}

/**
 * Computes the advance of a code point in a face from the exported tables, without the module under test.
 *
 * The monospace face has no table: it gives 1233 units to every code point the sans bold table covers, bar the
 * soft hyphen, and a full em to the others.
 *
 * @param code - Unicode code point
 * @param face - Font and weight
 * @returns The advance in font units
 */
function faceWidth(code: number, face: Face): number {
    if (face.font === 'mono') {
        if (tableWidth(code) === undefined) return FALLBACK_WIDTH;
        // The soft hyphen and the combining marks have no width, as in the proportional faces
        return code === 0xad || (code >= 0x300 && code <= 0x36f) || (code >= 0x483 && code <= 0x487) ? 0 : MONO_ADVANCE;
    }
    return tableWidth(code, TABLES[face.font][face.weight]) ?? FALLBACK_WIDTH;
}

/**
 * Computes the expected text length of a label from the width tables.
 *
 * @param label - Text to measure
 * @param font - Font size in pixels
 * @param face - Font and weight, sans bold by default
 * @returns The rounded width in pixels
 */
function expectedText(label: string, font: number, face: Face = DEFAULT_FACE): number {
    let units = 0;
    for (const char of label) units += faceWidth(char.codePointAt(0)!, face);
    return Math.round((units / UNITS_PER_EM) * font);
}

/**
 * Reads the text length of the label element.
 *
 * @param markup - SVG markup
 * @returns The textLength attribute as a number
 */
function textLength(markup: string): number {
    return Number(attr(markup, 'text', 'textLength'));
}

/**
 * Lists the opening tags of every element with a given name.
 *
 * @param markup - SVG markup
 * @param tag - Element name
 * @returns The opening tags in document order
 */
function openings(markup: string, tag: string): string[] {
    return [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

/**
 * Lists every id declared in a document.
 *
 * @param markup - SVG markup
 * @returns The id values in document order
 */
function ids(markup: string): string[] {
    return [...markup.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]!);
}

/**
 * Reads the text elements of a badge.
 *
 * @param markup - SVG markup
 * @returns The x position, text length, fill and content of each text
 */
function texts(markup: string): { x: number; length: number; fill: string; content: string }[] {
    return openings(markup, 'text').map((opening) => {
        const start = markup.indexOf(opening) + opening.length;
        return {
            x: Number(attr(opening, 'text', 'x')),
            length: Number(attr(opening, 'text', 'textLength')),
            fill: attr(opening, 'text', 'fill'),
            content: markup.slice(start, markup.indexOf('</text>', start)),
        };
    });
}

/**
 * Reads the start and end points of a gradient.
 *
 * @param markup - SVG markup
 * @param id - Identifier of the gradient
 * @returns The four coordinates as written in the markup
 */
function points(markup: string, id: string): string {
    const opening = openings(markup, 'linearGradient').find((tag) => tag.includes(`id="${id}"`));
    assert.ok(opening, `gradient ${id} not found`);
    return ['x1', 'y1', 'x2', 'y2'].map((name) => attr(opening, 'linearGradient', name)).join(' ');
}

/**
 * Computes the geometry of a two-part badge from the size table and the width table.
 *
 * @param name - Size name
 * @param label - Text of the left part
 * @param message - Text of the right part
 * @param icons - Whether a leading and a trailing icon are drawn
 * @param face - Font and weight, sans bold by default
 * @returns The widths of the parts, the text positions and the trailing icon position
 */
function geometry(
    name: keyof typeof SIZES,
    label: string,
    message: string,
    icons: boolean,
    face: Face = DEFAULT_FACE,
): { width: number; split: number; labelX: number; messageX: number; trailX: number; labelLength: number } {
    const spec = SIZES[name];
    const labelLength = expectedText(label, spec.font, face);
    const messageLength = expectedText(message, spec.font, face);
    const lead = icons ? spec.icon + spec.gap : 0;
    const split = spec.pad + lead + labelLength + spec.pad;
    const messageX = split + spec.pad;
    const trailX = messageX + messageLength + spec.gap - 1;
    const right = spec.pad + messageLength + (icons ? spec.gap - 1 + spec.icon : 0) + spec.pad;
    return { width: split + right, split, labelX: spec.pad + lead, messageX, trailX, labelLength };
}

describe('badge', () => {
    describe('default output', () => {
        test('returns an SVG document with the right content type', () => {
            const result = badge({ label: 'Hello' });
            assert.equal(result.contentType, 'image/svg+xml');
            assert.ok(result.body.startsWith('<svg '));
            assert.ok(result.body.endsWith('</svg>\n'));
        });

        test('root element is accessible', () => {
            const body = svg({ label: 'Hello' });
            assert.equal(attr(body, 'svg', 'xmlns'), 'http://www.w3.org/2000/svg');
            assert.equal(attr(body, 'svg', 'role'), 'img');
            assert.equal(attr(body, 'svg', 'aria-label'), 'Hello');
            assert.ok(body.includes('<title>Hello</title>'));
        });

        test('only the expected elements are emitted', () => {
            const body = svg({ label: 'Hello' });
            assert.deepEqual(tags(body), new Set(['svg', 'title', 'defs', 'linearGradient', 'stop', 'rect', 'text']));
        });

        test('defaults to the sm size with the default colors', () => {
            const body = svg({ label: 'Hello' });
            assert.equal(attr(body, 'svg', 'height'), '20');
            assert.equal(attr(body, 'rect', 'rx'), '10');
            assert.ok(body.includes('stop-color="#2d333b"'));
            assert.equal(attr(body, 'text', 'fill'), '#ffffff');
        });

        test('label is trimmed', () => {
            const body = svg({ label: '  Hi  ' });
            assert.ok(body.includes('<title>Hi</title>'));
            assert.equal(attr(body, 'svg', 'aria-label'), 'Hi');
        });

        test('output is deterministic', () => {
            assert.equal(svg({ label: 'Same', icon: 'check' }), svg({ label: 'Same', icon: 'check' }));
        });
    });

    describe('sizes', () => {
        for (const [name, spec] of Object.entries(SIZES)) {
            test(`${name}: height, pill shape and text placement`, () => {
                const body = svg({ label: 'Hi', size: name });
                const text = expectedText('Hi', spec.font);
                assert.equal(attr(body, 'svg', 'height'), String(spec.height));
                assert.equal(attr(body, 'svg', 'width'), String(spec.pad * 2 + text));
                assert.equal(attr(body, 'svg', 'viewBox'), `0 0 ${spec.pad * 2 + text} ${spec.height}`);
                assert.equal(attr(body, 'rect', 'rx'), String(spec.height / 2));
                assert.equal(attr(body, 'text', 'x'), String(spec.pad));
                assert.equal(attr(body, 'text', 'font-size'), String(spec.font));
                assert.equal(textLength(body), text);
            });

            test(`${name}: leading and trailing icon placement`, () => {
                const body = svg({ label: 'Hi', icon: 'check', trail: 'check', size: name });
                const text = expectedText('Hi', spec.font);
                const textX = spec.pad + spec.icon + spec.gap;
                const trailX = textX + text + spec.gap - 1;
                const top = (spec.height - spec.icon) / 2;
                const scale = (spec.icon / 24).toFixed(4);
                const groups = [...body.matchAll(/<g transform="([^"]*)"/g)].map((match) => match[1]);
                assert.deepEqual(groups, [
                    `translate(${spec.pad} ${top}) scale(${scale})`,
                    `translate(${trailX} ${top}) scale(${scale})`,
                ]);
                assert.equal(attr(body, 'text', 'x'), String(textX));
                assert.equal(attr(body, 'svg', 'width'), String(trailX + spec.icon + spec.pad));
            });
        }

        test('sizes grow with the font and the padding', () => {
            const widths = Object.keys(SIZES).map((size) =>
                Number(attr(svg({ label: 'Hello', size }), 'svg', 'width')),
            );
            assert.deepEqual(
                widths,
                [...widths].sort((a, b) => a - b),
            );
            assert.equal(new Set(widths).size, 4);
        });

        test('null size falls back to sm', () => {
            const body = svg({ label: 'Hi', size: null as unknown as string });
            assert.equal(attr(body, 'svg', 'height'), '20');
        });
    });

    describe('label measurement', () => {
        test('narrow glyph is narrower than wide glyph', () => {
            assert.ok(textLength(svg({ label: 'i' })) < textLength(svg({ label: 'W' })));
            assert.equal(textLength(svg({ label: 'i' })), 4);
            assert.equal(textLength(svg({ label: 'W' })), 12);
        });

        test('width is monotonic when characters are appended', () => {
            let previous = 0;
            for (const label of ['a', 'aa', 'aaa', 'aaaa', 'aaaaa', 'aaaaaa']) {
                const length = textLength(svg({ label }));
                assert.ok(length > previous, `${label} should be wider than the previous label`);
                previous = length;
            }
        });

        test('svg width follows the label width', () => {
            const short = Number(attr(svg({ label: 'ab' }), 'svg', 'width'));
            const long = Number(attr(svg({ label: 'abcdefgh' }), 'svg', 'width'));
            assert.ok(long > short);
        });

        test('uses the table advances for ASCII labels', () => {
            for (const label of ['Nouveau', 'Hello World', 'MMMM', 'iiii', '0123456789']) {
                for (const [name, spec] of Object.entries(SIZES)) {
                    const body = svg({ label, size: name });
                    assert.equal(textLength(body), expectedText(label, spec.font), `${label} at ${name}`);
                }
            }
        });

        test('accented Latin-1 characters are measured with table values', () => {
            for (const char of ['é', 'è', 'à', 'ç', 'ü', 'ñ', 'Ö', 'ÿ']) {
                const known = tableWidth(char.codePointAt(0)!);
                assert.ok(known !== undefined, `${char} should be in the table`);
                assert.notEqual(known, FALLBACK_WIDTH);
                assert.equal(textLength(svg({ label: char })), Math.round((known / UNITS_PER_EM) * 11));
            }
            assert.equal(textLength(svg({ label: 'é' })), 7);
        });

        test('accented letters are as wide as their base letter', () => {
            assert.equal(tableWidth('é'.codePointAt(0)!), tableWidth('e'.codePointAt(0)!));
            assert.equal(tableWidth('à'.codePointAt(0)!), tableWidth('a'.codePointAt(0)!));
        });

        test('a character outside the table counts as one em', () => {
            assert.equal(tableWidth('日'.codePointAt(0)!), undefined);
            assert.equal(FALLBACK_WIDTH, UNITS_PER_EM);
            assert.equal(textLength(svg({ label: '日' })), 11);
            assert.equal(textLength(svg({ label: '日', size: 'lg' })), 13);
            assert.equal(textLength(svg({ label: '日日日' })), 33);
        });

        test('an emoji counts once, not twice', () => {
            assert.equal(textLength(svg({ label: '😀' })), 11);
            assert.equal(textLength(svg({ label: '😀😀' })), 22);
            assert.equal(textLength(svg({ label: 'a😀' })), expectedText('a', 11) + 11);
        });
    });

    describe('icons', () => {
        test('leading icon is stroked and shifts the text', () => {
            const plain = svg({ label: 'Hi' });
            const body = svg({ label: 'Hi', icon: 'check' });
            assert.ok(
                body.includes(
                    `<g transform="translate(8 4) scale(0.5000)" color="#ffffff" fill="none" stroke="#ffffff"`,
                ),
            );
            assert.ok(body.includes(ICONS['check']!));
            assert.equal(attr(body, 'text', 'x'), '26');
            assert.equal(Number(attr(body, 'svg', 'width')), Number(attr(plain, 'svg', 'width')) + 12 + 6);
        });

        test('trailing icon follows the text', () => {
            const plain = svg({ label: 'Hi' });
            const body = svg({ label: 'Hi', trail: 'check' });
            assert.equal(attr(body, 'text', 'x'), '8');
            assert.ok(body.includes('translate(26 4) scale(0.5000)'));
            assert.equal(Number(attr(body, 'svg', 'width')), Number(attr(plain, 'svg', 'width')) + 12 + 5);
        });

        test('leading and trailing icons can differ', () => {
            const body = svg({ label: 'Hi', icon: 'check', trail: 'bell' });
            assert.ok(body.includes(ICONS['check']!));
            assert.ok(body.includes(ICONS['bell']!));
            assert.equal(body.match(/<g /g)!.length, 2);
        });

        test('icon uses the ink color and the size stroke width', () => {
            const body = svg({ label: 'Hi', icon: 'check', ink: '#ff0000', size: 'xs' });
            assert.ok(
                body.includes('stroke="#ff0000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'),
            );
            assert.equal(attr(body, 'text', 'fill'), '#ff0000');
        });

        test('discord icon is filled, not stroked', () => {
            const body = svg({ label: 'Hi', icon: 'discord' });
            assert.ok(Object.hasOwn(FILLED_ICONS, 'discord'));
            assert.ok(!Object.hasOwn(ICONS, 'discord'));
            assert.ok(body.includes('fill="#ffffff"><path fill-rule="evenodd"'));
            assert.ok(body.includes(FILLED_ICONS['discord']!));
            assert.ok(!body.includes('stroke='));
            assert.ok(!body.includes('fill="none"'));
        });

        test('discord works as a trailing icon too', () => {
            const body = svg({ label: 'Hi', trail: 'discord', ink: '#112233' });
            assert.ok(body.includes('fill="#112233"><path fill-rule="evenodd"'));
            assert.ok(!body.includes('stroke="#112233"'));
        });

        test('empty icon names mean no icon', () => {
            assert.equal(svg({ label: 'Hi', icon: '', trail: '' }), svg({ label: 'Hi' }));
        });

        test('every stroked icon renders as leading and trailing icon', () => {
            const names = Object.keys(ICONS);
            assert.ok(names.length > 0);
            for (const name of names) {
                const lead = svg({ label: 'Hi', icon: name });
                const trail = svg({ label: 'Hi', trail: name });
                assert.ok(lead.includes(ICONS[name]!), `${name} as icon`);
                assert.ok(trail.includes(ICONS[name]!), `${name} as trail`);
                assert.ok(lead.includes('fill="none"'), `${name} is stroked`);
            }
        });

        test('every filled icon renders', () => {
            for (const name of Object.keys(FILLED_ICONS)) {
                assert.ok(svg({ label: 'Hi', icon: name }).includes(FILLED_ICONS[name]!));
                assert.ok(svg({ label: 'Hi', trail: name }).includes(FILLED_ICONS[name]!));
            }
        });

        test('icon tables do not overlap', () => {
            for (const name of Object.keys(FILLED_ICONS)) assert.ok(!Object.hasOwn(ICONS, name), name);
        });

        test('icon bodies only hold plain SVG shapes', () => {
            for (const [name, body] of [...Object.entries(ICONS), ...Object.entries(FILLED_ICONS)]) {
                assert.ok(body.length > 0, name);
                for (const tag of tags(body)) assert.ok(SHAPES.has(tag), `${name} uses <${tag}>`);
                assert.ok(!/<script|javascript:|\bon[a-z]+\s*=/i.test(body), `${name} has active content`);
            }
        });

        test('every rendered icon keeps the output free of other elements', () => {
            const allowed = new Set(['svg', 'title', 'defs', 'linearGradient', 'stop', 'rect', 'text', 'g', ...SHAPES]);
            for (const name of [...Object.keys(ICONS), ...Object.keys(FILLED_ICONS)]) {
                for (const tag of tags(svg({ label: 'Hi', icon: name, trail: name }))) {
                    assert.ok(allowed.has(tag), `${name} produced <${tag}>`);
                }
            }
        });
    });

    describe('colors', () => {
        test('end defaults to start', () => {
            const body = svg({ label: 'Hi', start: '#16a34a' });
            assert.deepEqual(
                [...body.matchAll(/stop-color="([^"]*)"/g)].map((match) => match[1]),
                ['#16a34a', '#16a34a'],
            );
        });

        test('start and end build a diagonal gradient', () => {
            const body = svg({ label: 'Hi', start: '#16a34a', end: '#15803d' });
            assert.deepEqual(
                [...body.matchAll(/stop-color="([^"]*)"/g)].map((match) => match[1]),
                ['#16a34a', '#15803d'],
            );
            assert.equal(attr(body, 'linearGradient', 'x1'), '0');
            assert.equal(attr(body, 'linearGradient', 'y1'), '0');
            assert.equal(attr(body, 'linearGradient', 'x2'), '1');
            assert.equal(attr(body, 'linearGradient', 'y2'), '1');
        });

        test('gradient id derives from the colors and the rect points at it', () => {
            const body = svg({ label: 'Hi', start: '#16a34a', end: '#15803d' });
            assert.equal(attr(body, 'linearGradient', 'id'), 'g-16a34a-15803d');
            assert.equal(attr(body, 'rect', 'fill'), 'url(#g-16a34a-15803d)');
        });

        test('same colors give the same id, different colors another', () => {
            const a = attr(svg({ label: 'One', start: '#112233', end: '#445566' }), 'linearGradient', 'id');
            const b = attr(svg({ label: 'Two', start: '#112233', end: '#445566' }), 'linearGradient', 'id');
            const c = attr(svg({ label: 'One', start: '#112233', end: '#445567' }), 'linearGradient', 'id');
            assert.equal(a, b);
            assert.notEqual(a, c);
        });

        test('id is the same whatever the label, size or icons', () => {
            const a = attr(svg({ label: 'A' }), 'linearGradient', 'id');
            const b = attr(svg({ label: 'Longer', size: 'lg', icon: 'check', border: '#fff' }), 'linearGradient', 'id');
            assert.equal(a, b);
            assert.equal(a, 'g-2d333b-2d333b');
        });

        test('3-digit colors are accepted as given', () => {
            const body = svg({ label: 'Hi', start: '#f60', end: '#09c', ink: '#fff' });
            assert.ok(body.includes('stop-color="#f60"'));
            assert.ok(body.includes('stop-color="#09c"'));
            assert.equal(attr(body, 'linearGradient', 'id'), 'g-f60-09c');
            assert.equal(attr(body, 'text', 'fill'), '#fff');
        });

        test('6-digit colors are accepted as given', () => {
            const body = svg({ label: 'Hi', start: '#ff6600', ink: '#000000' });
            assert.ok(body.includes('stop-color="#ff6600"'));
            assert.equal(attr(body, 'text', 'fill'), '#000000');
        });

        test('colors without # get one', () => {
            const body = svg({ label: 'Hi', start: 'ff6600', end: '09c', ink: '000', border: 'abc' });
            assert.ok(body.includes('stop-color="#ff6600"'));
            assert.ok(body.includes('stop-color="#09c"'));
            assert.equal(attr(body, 'text', 'fill'), '#000');
            assert.equal(attr(body, 'rect', 'stroke'), '#abc');
            assert.equal(attr(body, 'linearGradient', 'id'), 'g-ff6600-09c');
        });

        test('uppercase colors are accepted', () => {
            const body = svg({ label: 'Hi', start: '#FF6600', end: '09C', ink: '#ABCDEF' });
            assert.ok(body.includes('stop-color="#FF6600"'));
            assert.ok(body.includes('stop-color="#09C"'));
            assert.equal(attr(body, 'text', 'fill'), '#ABCDEF');
        });

        test('empty color strings fall back to the defaults', () => {
            const body = svg({ label: 'Hi', start: '', end: '', ink: '' });
            assert.ok(body.includes('stop-color="#2d333b"'));
            assert.equal(attr(body, 'text', 'fill'), '#ffffff');
        });

        test('colors cannot break out of the attributes', () => {
            for (const bad of ['#fff"onload="x', '#fff"/><script>', 'red', '#ggg', '#ffff', '#12345', '##fff']) {
                assert.throws(() => badge({ label: 'Hi', start: bad }), /Invalid start color/, bad);
            }
        });
    });

    describe('border', () => {
        test('no border by default', () => {
            const body = svg({ label: 'Hello' });
            assert.ok(!body.includes('stroke="'));
            assert.equal(attr(body, 'rect', 'x'), '0');
            assert.equal(attr(body, 'rect', 'y'), '0');
        });

        test('border adds a 1px stroke and insets the rect by half a pixel', () => {
            const plain = svg({ label: 'Hello' });
            const body = svg({ label: 'Hello', border: '#ff0000' });
            const width = Number(attr(plain, 'svg', 'width'));
            assert.equal(attr(body, 'rect', 'stroke'), '#ff0000');
            assert.equal(attr(body, 'rect', 'stroke-width'), '1');
            assert.equal(attr(body, 'rect', 'x'), '0.5');
            assert.equal(attr(body, 'rect', 'y'), '0.5');
            assert.equal(attr(body, 'rect', 'width'), String(width - 1));
            assert.equal(attr(body, 'rect', 'height'), '19');
            assert.equal(attr(body, 'rect', 'rx'), '9.5');
        });

        test('border does not change the overall size', () => {
            const plain = svg({ label: 'Hello', size: 'lg' });
            const body = svg({ label: 'Hello', size: 'lg', border: '#000' });
            assert.equal(attr(body, 'svg', 'width'), attr(plain, 'svg', 'width'));
            assert.equal(attr(body, 'svg', 'height'), attr(plain, 'svg', 'height'));
        });

        test('empty border means no border', () => {
            assert.equal(svg({ label: 'Hi', border: '' }), svg({ label: 'Hi' }));
        });
    });

    describe('lift', () => {
        test('lift adds 2 * lift to the height and the viewBox', () => {
            const plain = svg({ label: 'Hello' });
            const width = attr(plain, 'svg', 'width');
            for (const lift of [1, 2, 5, 10]) {
                const body = svg({ label: 'Hello', lift });
                assert.equal(attr(body, 'svg', 'height'), String(20 + 2 * lift));
                assert.equal(attr(body, 'svg', 'viewBox'), `0 0 ${width} ${20 + 2 * lift}`);
                assert.equal(attr(body, 'svg', 'width'), width);
            }
        });

        test('lift leaves the pill itself unchanged', () => {
            const body = svg({ label: 'Hello', lift: 4 });
            assert.equal(attr(body, 'rect', 'height'), '20');
            assert.equal(attr(body, 'rect', 'y'), '0');
            assert.equal(attr(body, 'text', 'y'), attr(svg({ label: 'Hello' }), 'text', 'y'));
        });

        test('lift works on every size and with a border', () => {
            for (const [name, spec] of Object.entries(SIZES)) {
                const body = svg({ label: 'Hi', size: name, lift: 3, border: '#fff' });
                assert.equal(attr(body, 'svg', 'height'), String(spec.height + 6));
                assert.equal(attr(body, 'rect', 'height'), String(spec.height - 1));
            }
        });

        test('zero and null lift mean no lift', () => {
            assert.equal(svg({ label: 'Hi', lift: 0 }), svg({ label: 'Hi' }));
            assert.equal(svg({ label: 'Hi', lift: null as unknown as number }), svg({ label: 'Hi' }));
        });
    });

    describe('XML escaping', () => {
        test('special characters are escaped in title, aria-label and text', () => {
            const body = svg({ label: `a&b<c>d"e'f` });
            const escaped = 'a&amp;b&lt;c&gt;d&quot;e&apos;f';
            assert.ok(body.includes(`<title>${escaped}</title>`));
            assert.equal(attr(body, 'svg', 'aria-label'), escaped);
            assert.ok(/<text [^>]*>a&amp;b&lt;c&gt;d&quot;e&apos;f<\/text>/.test(body));
            assert.ok(!/<text [^>]*>[^<]*[&](?!amp;|lt;|gt;|quot;|apos;)/.test(body));
        });

        test('each special character is escaped on its own', () => {
            const cases: [string, string][] = [
                ['&', '&amp;'],
                ['<', '&lt;'],
                ['>', '&gt;'],
                ['"', '&quot;'],
                ["'", '&apos;'],
            ];
            for (const [raw, entity] of cases) {
                const body = svg({ label: `x${raw}y` });
                assert.ok(body.includes(`<title>x${entity}y</title>`), raw);
                assert.equal(attr(body, 'svg', 'aria-label'), `x${entity}y`, raw);
                assert.ok(body.includes(`>x${entity}y</text>`), raw);
            }
        });

        test('markup in a label cannot add elements', () => {
            const label = '<script>alert("x")</script><rect onload="y"/>&lt;';
            const body = svg({ label });
            assert.ok(!body.includes('<script'));
            assert.deepEqual(tags(body), new Set(['svg', 'title', 'defs', 'linearGradient', 'stop', 'rect', 'text']));
            assert.equal(body.match(/<rect\b/g)!.length, 1);
            assert.ok(body.includes('&amp;lt;'));
        });

        test('an attribute breakout in a label stays inside aria-label', () => {
            const body = svg({ label: '" onload="alert(1)' });
            assert.equal(attr(body, 'svg', 'aria-label'), '&quot; onload=&quot;alert(1)');
            const names = attrNames(body.match(/<svg\b[^>]*>/)![0]);
            assert.deepEqual(names, ['xmlns', 'width', 'height', 'viewBox', 'role', 'aria-label']);
        });

        test('escaped characters still count in the measurement once', () => {
            assert.equal(textLength(svg({ label: '&' })), expectedText('&', 11));
        });
    });

    describe('label validation', () => {
        const missing = 'Please provide a label (?label={text})';

        test('missing label throws', () => {
            assert.throws(() => badge({} as never), { message: missing });
            assert.throws(() => badge({ label: undefined } as never), { message: missing });
        });

        test('blank label throws', () => {
            for (const label of ['', ' ', '   ', '\t \n']) {
                assert.throws(() => badge({ label }), { message: missing }, JSON.stringify(label));
            }
        });

        test('non-string label throws', () => {
            for (const label of [123, null, true, {}, [], ['a']]) {
                assert.throws(() => badge({ label } as never), { message: missing }, String(label));
            }
        });

        test('64 characters are accepted, 65 are not', () => {
            assert.doesNotThrow(() => badge({ label: 'a'.repeat(64) }));
            assert.throws(() => badge({ label: 'a'.repeat(65) }), { message: 'Label cannot exceed 64 characters' });
        });

        test('length counts code points, not UTF-16 units', () => {
            const emoji = '😀';
            assert.equal(emoji.repeat(64).length, 128);
            assert.doesNotThrow(() => badge({ label: emoji.repeat(64) }));
            assert.throws(() => badge({ label: emoji.repeat(65) }), { message: 'Label cannot exceed 64 characters' });
        });

        test('length is measured after trimming', () => {
            assert.doesNotThrow(() => badge({ label: `  ${'a'.repeat(64)}  ` }));
        });

        test('control characters throw', () => {
            const message = 'Label cannot contain control or invisible characters';
            for (const label of ['a\u0000b', 'a\nb', 'a\tb', 'a\rb', 'a\u001fb', 'a\u007fb', 'a\u0085b', 'a\u009fb']) {
                assert.throws(() => badge({ label }), { message }, JSON.stringify(label));
            }
        });

        test('lone surrogates throw', () => {
            const message = 'Label cannot contain control or invisible characters';
            for (const label of ['a\ud800b', 'a\udc00b', 'a\udfffb', 'ab\ud83d', '\ude00ab']) {
                assert.throws(() => badge({ label }), { message }, JSON.stringify(label));
            }
        });

        test('well-formed surrogate pairs are accepted', () => {
            assert.doesNotThrow(() => badge({ label: 'a😀b' }));
        });

        test('U+FFFE and U+FFFF throw', () => {
            const message = 'Label cannot contain control or invisible characters';
            assert.throws(() => badge({ label: 'a￾b' }), { message });
            assert.throws(() => badge({ label: 'a￿b' }), { message });
        });

        test('invisible format and filler characters throw', () => {
            const message = 'Label cannot contain control or invisible characters';
            const forbidden: [string, string][] = [
                ['soft hyphen', '\u00ad'],
                ['combining grapheme joiner', '\u034f'],
                ['Arabic letter mark', '\u061c'],
                ['Hangul choseong filler', '\u115f'],
                ['Hangul jungseong filler', '\u1160'],
                ['Mongolian vowel separator', '\u180e'],
                ['word joiner', '\u2060'],
                ['invisible times', '\u2062'],
                ['inhibit symmetric swapping', '\u206a'],
                ['Braille pattern blank', '\u2800'],
                ['Hangul filler', '\u3164'],
                ['halfwidth Hangul filler', '\uffa0'],
                ['interlinear annotation anchor', '\ufff9'],
                ['language tag', '\u{e0001}'],
                ['tag letter A', '\u{e0041}'],
            ];
            for (const [name, char] of forbidden) {
                assert.throws(() => badge({ label: `a${char}b` }), { message }, name);
                assert.throws(() => badge({ label: char }), { message }, `only ${name}`);
                assert.throws(
                    () => badge({ label: 'a', message: `a${char}b` }),
                    { message: 'Message cannot contain control or invisible characters' },
                    `message ${name}`,
                );
            }
        });

        test('a text with nothing that draws is refused', () => {
            const message = 'Label cannot contain control or invisible characters';
            for (const label of ['\ufe0f', '\u0301', '\u0301\u0323', ' \ufe0f ', '\ufe0f\ufe0f']) {
                assert.throws(() => badge({ label }), { message }, JSON.stringify(label));
            }
            assert.throws(() => badge({ label: 'a', message: '\u0301' }), {
                message: 'Message cannot contain control or invisible characters',
            });
        });

        test('variation selectors stay allowed, so emoji and symbols keep their presentation', () => {
            for (const label of ['\u2764\ufe0f', '\u2764\ufe0e', 'ok \u2705\ufe0f', 'a\ufe0fb']) {
                assert.doesNotThrow(() => badge({ label }), JSON.stringify(label));
            }
        });

        test('no-break and wide spaces around visible text are kept as spaces', () => {
            assert.doesNotThrow(() => badge({ label: 'a\u00a0b' }));
            assert.doesNotThrow(() => badge({ label: 'a\u3000b' }));
        });

        test('non-ASCII text, a no-break space and U+00A0 are fine', () => {
            assert.doesNotThrow(() => badge({ label: 'Mis à jour   日本 ✓ €' }));
        });
    });

    describe('label cleaning', () => {
        test('a decomposed accent is composed, measured and drawn like the single letter', () => {
            const decomposed = svg({ label: 'e\u0301te\u0301' });
            const composed = svg({ label: '\u00e9t\u00e9' });
            assert.equal(decomposed, composed);
            assert.equal(textLength(decomposed), textLength(svg({ label: '\u00e9t\u00e9' })));
        });

        test('combining marks that stay decomposed take no width', () => {
            assert.equal(textLength(svg({ label: 'x\u0323\u0323' })), textLength(svg({ label: 'x' })));
        });

        test('runs of spaces collapse into one', () => {
            assert.equal(svg({ label: 'a     b' }), svg({ label: 'a b' }));
            assert.equal(svg({ label: '  a  b  ' }), svg({ label: 'a b' }));
        });

        test('bidirectional controls and zero-width characters throw', () => {
            const message = 'Label cannot contain control or invisible characters';
            const forbidden = [
                '\u200b',
                '\u200e',
                '\u200f',
                '\u202a',
                '\u202e',
                '\u2066',
                '\u2069',
                '\u2028',
                '\u2029',
                '\ufeff',
            ];
            for (const char of forbidden) {
                assert.throws(() => badge({ label: `a${char}b` }), { message }, JSON.stringify(char));
            }
        });

        test('a huge label is refused without being walked', () => {
            assert.throws(() => badge({ label: 'a'.repeat(100000) }), { message: 'Label cannot exceed 64 characters' });
        });

        test('Greek and Cyrillic are measured with their own widths, not a full em each', () => {
            const cyrillic = textLength(svg({ label: '\u041f\u0440\u0438\u0432\u0435\u0442' }));
            const fallback = Math.round((6 * FALLBACK_WIDTH * 11) / UNITS_PER_EM);
            assert.ok(cyrillic < fallback, `${cyrillic} should be narrower than ${fallback}`);
            assert.ok(SANS_BOLD.some(([first, widths]) => first <= 0x41f && 0x41f < first + widths.length));
        });
    });

    describe('color validation', () => {
        test('bad start, end, ink and border throw with the parameter name', () => {
            for (const name of ['start', 'end', 'ink', 'border'] as const) {
                assert.throws(() => badge({ label: 'Hi', [name]: 'nope' }), {
                    message: `Invalid ${name} color (use hex like ff6600)`,
                });
                assert.throws(() => badge({ label: 'Hi', [name]: '#12' }), {
                    message: `Invalid ${name} color (use hex like ff6600)`,
                });
            }
        });

        test('non-string colors throw', () => {
            for (const name of ['start', 'end', 'ink', 'border'] as const) {
                for (const value of [123, true, {}, ['#fff']]) {
                    assert.throws(() => badge({ label: 'Hi', [name]: value } as never), {
                        message: `Please provide a valid ${name} color`,
                    });
                }
            }
        });

        test('a valid start does not hide a bad end', () => {
            assert.throws(() => badge({ label: 'Hi', start: '#fff', end: 'xyz' }), /Invalid end color/);
        });
    });

    describe('icon validation', () => {
        test('unknown icon and trail throw with the name', () => {
            assert.throws(() => badge({ label: 'Hi', icon: 'nope' }), { message: 'Unknown icon "nope"' });
            assert.throws(() => badge({ label: 'Hi', trail: 'nope' }), { message: 'Unknown trail icon "nope"' });
        });

        test('names are case sensitive', () => {
            assert.throws(() => badge({ label: 'Hi', icon: 'Check' }), /Unknown icon "Check"/);
            assert.throws(() => badge({ label: 'Hi', icon: 'CHECK' }), /Unknown icon "CHECK"/);
        });

        test('prototype property names are rejected', () => {
            for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
                assert.throws(() => badge({ label: 'Hi', icon: name }), { message: `Unknown icon "${name}"` }, name);
                assert.throws(
                    () => badge({ label: 'Hi', trail: name }),
                    { message: `Unknown trail icon "${name}"` },
                    name,
                );
            }
        });

        test('non-string icons throw', () => {
            for (const value of [123, true, {}, [], ['check'], null]) {
                assert.throws(() => badge({ label: 'Hi', icon: value } as never), {
                    message: 'Please provide a valid icon name',
                });
                assert.throws(() => badge({ label: 'Hi', trail: value } as never), {
                    message: 'Please provide a valid trail icon name',
                });
            }
        });

        test('a long unknown name is cut in the error message', () => {
            const error = (() => {
                try {
                    badge({ label: 'Hi', icon: 'x'.repeat(500) });
                } catch (caught) {
                    return caught as Error;
                }
                return null;
            })();
            assert.ok(error);
            assert.equal(error.message, `Unknown icon "${'x'.repeat(40)}"`);
        });

        test('names are not trimmed', () => {
            assert.throws(() => badge({ label: 'Hi', icon: ' check' }), /Unknown icon/);
        });
    });

    describe('size validation', () => {
        const message = 'Invalid size (use xs, sm, md or lg)';

        test('unknown sizes throw', () => {
            for (const size of ['xl', 'XS', 'Sm', 'huge', ' sm', '12']) {
                assert.throws(() => badge({ label: 'Hi', size }), { message }, size);
            }
        });

        test('empty size throws', () => {
            assert.throws(() => badge({ label: 'Hi', size: '' }), { message });
        });

        test('prototype property names are rejected', () => {
            for (const size of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
                assert.throws(() => badge({ label: 'Hi', size }), { message }, size);
            }
        });

        test('non-string sizes throw', () => {
            for (const size of [12, true, {}, ['sm']]) {
                assert.throws(() => badge({ label: 'Hi', size } as never), { message });
            }
        });
    });

    describe('lift rounding', () => {
        test('fractions are kept to two decimals, with no floating-point noise', () => {
            assert.equal(attr(svg({ label: 'a', lift: 1.12 }), 'svg', 'height'), '22.24');
            assert.equal(attr(svg({ label: 'a', lift: 1.13 }), 'svg', 'height'), '22.26');
            assert.equal(attr(svg({ label: 'a', lift: 0.3333333333 }), 'svg', 'height'), '20.66');
            assert.equal(attr(svg({ label: 'a', lift: 1e-7 }), 'svg', 'height'), '20');
        });
    });

    describe('lift validation', () => {
        const message = 'Invalid lift (use a number from 0 to 10)';

        test('out of range lifts throw', () => {
            for (const lift of [-1, -0.5, 10.5, 11, 100, Number.MAX_VALUE]) {
                assert.throws(() => badge({ label: 'Hi', lift }), { message }, String(lift));
            }
        });

        test('NaN and infinite lifts throw', () => {
            for (const lift of [NaN, Infinity, -Infinity]) {
                assert.throws(() => badge({ label: 'Hi', lift }), { message }, String(lift));
            }
        });

        test('non-number lifts throw', () => {
            for (const lift of ['2', '', 'abc', true, {}, []]) {
                assert.throws(() => badge({ label: 'Hi', lift } as never), { message }, String(lift));
            }
        });

        test('bounds are inclusive', () => {
            assert.equal(attr(svg({ label: 'Hi', lift: 0 }), 'svg', 'height'), '20');
            assert.equal(attr(svg({ label: 'Hi', lift: 10 }), 'svg', 'height'), '40');
        });
    });

    describe('message', () => {
        const PARTS = new Set(['svg', 'title', 'defs', 'linearGradient', 'stop', 'clipPath', 'rect', 'g', 'text']);

        test('hard-coded geometry of Hi and Yo on every size', () => {
            // Verified by hand: left = pad + [icon + gap] + label + pad, right = pad + message + [gap - 1 + icon] + pad
            const expected = {
                xs: { plain: [50, 24, 6, 30], icons: [77, 38, 20, 44, 61] },
                sm: { plain: [61, 29, 8, 37], icons: [96, 47, 26, 55, 76] },
                md: { plain: [71, 34, 10, 44], icons: [110, 54, 30, 64, 86] },
                lg: { plain: [81, 39, 12, 51], icons: [126, 62, 35, 74, 98] },
            } as const;
            for (const [name, spec] of Object.entries(SIZES)) {
                const [width, split, labelX, messageX] = expected[name as keyof typeof SIZES].plain;
                const body = svg({ label: 'Hi', message: 'Yo', size: name });
                assert.equal(attr(body, 'svg', 'width'), String(width), name);
                assert.equal(attr(body, 'svg', 'height'), String(spec.height), name);
                assert.equal(attr(body, 'svg', 'viewBox'), `0 0 ${width} ${spec.height}`, name);
                assert.deepEqual(
                    texts(body).map((text) => text.x),
                    [labelX, messageX],
                    name,
                );
                const rects = openings(body, 'rect');
                assert.equal(attr(rects[1]!, 'rect', 'width'), String(split + 1), name);
                assert.equal(attr(rects[2]!, 'rect', 'x'), String(split), name);
                assert.equal(attr(rects[2]!, 'rect', 'width'), String(width - split), name);

                const [iconWidth, iconSplit, iconLabelX, iconMessageX, trailX] =
                    expected[name as keyof typeof SIZES].icons;
                const icons = svg({ label: 'Hi', message: 'Yo', icon: 'check', trail: 'check', size: name });
                const top = (spec.height - spec.icon) / 2;
                const scale = (spec.icon / 24).toFixed(4);
                assert.equal(attr(icons, 'svg', 'width'), String(iconWidth), name);
                assert.equal(attr(openings(icons, 'rect')[2]!, 'rect', 'x'), String(iconSplit), name);
                assert.deepEqual(
                    texts(icons).map((text) => text.x),
                    [iconLabelX, iconMessageX],
                    name,
                );
                assert.deepEqual(
                    [...icons.matchAll(/<g transform="([^"]*)"/g)].map((match) => match[1]),
                    [`translate(${spec.pad} ${top}) scale(${scale})`, `translate(${trailX} ${top}) scale(${scale})`],
                    name,
                );
            }
        });

        test('geometry follows the formula for several texts on every size', () => {
            const cases: [string, string][] = [
                ['Hi', 'Yo'],
                ['Build', 'passing'],
                ['W', 'iiiiii'],
                ['Mis à jour', 'Très long message ici'],
                ['日本語', '世界'],
            ];
            for (const name of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
                for (const [label, message] of cases) {
                    for (const icons of [false, true]) {
                        const expected = geometry(name, label, message, icons);
                        const body = svg({
                            label,
                            message,
                            size: name,
                            ...(icons ? { icon: 'check', trail: 'check' } : {}),
                        });
                        const where = `${name} ${label} ${message} ${icons}`;
                        const [left, right] = texts(body);
                        assert.equal(attr(body, 'svg', 'width'), String(expected.width), where);
                        assert.equal(attr(openings(body, 'rect')[2]!, 'rect', 'x'), String(expected.split), where);
                        assert.equal(left!.x, expected.labelX, where);
                        assert.equal(left!.length, expected.labelLength, where);
                        assert.equal(right!.x, expected.messageX, where);
                        assert.equal(right!.length, expectedText(message, SIZES[name].font), where);
                        if (icons) {
                            const trail = [...body.matchAll(/<g transform="translate\(([\d.]+) /g)][1]![1];
                            assert.equal(trail, String(expected.trailX), where);
                        }
                    }
                }
            }
        });

        test('the split sits after the left padding and the message starts one padding later', () => {
            for (const [name, spec] of Object.entries(SIZES)) {
                const body = svg({ label: 'Status', message: 'ok', size: name });
                const [left, right] = texts(body);
                const split = Number(attr(openings(body, 'rect')[2]!, 'rect', 'x'));
                assert.equal(split, left!.x + left!.length + spec.pad, name);
                assert.equal(right!.x, split + spec.pad, name);
                assert.equal(Number(attr(body, 'svg', 'width')), right!.x + right!.length + spec.pad, name);
            }
        });

        test('the message uses the same baseline, weight and font size as the label', () => {
            const body = svg({ label: 'Hi', message: 'Yo', size: 'md' });
            const [left, right] = openings(body, 'text');
            for (const name of ['y', 'font-family', 'font-weight', 'font-size']) {
                assert.equal(attr(left!, 'text', name), attr(right!, 'text', name), name);
            }
            assert.equal(attr(right!, 'text', 'font-size'), '12');
        });

        test('the message text and the label text hold the right content', () => {
            const body = svg({ label: 'build', message: 'passing' });
            assert.deepEqual(
                texts(body).map((text) => text.content),
                ['build', 'passing'],
            );
        });

        test('the two parts are two rects in a clipped group', () => {
            const body = svg({ label: 'Hi', message: 'Yo' });
            const clip = body.match(/<g clip-path="url\(#([^)]*)\)">(.*?)<\/g>/s);
            assert.ok(clip);
            assert.equal(clip[1], attr(body, 'clipPath', 'id'));
            const inside = openings(clip[2]!, 'rect');
            assert.equal(inside.length, 2);
            assert.equal(attr(inside[0]!, 'rect', 'height'), '20');
            assert.equal(attr(inside[1]!, 'rect', 'height'), '20');
            assert.ok(!inside[0]!.includes(' x='));
            assert.equal(attr(inside[0]!, 'rect', 'fill'), 'url(#g-2d333b-2d333b)');
            assert.equal(attr(inside[1]!, 'rect', 'fill'), 'url(#m-0969da-0969da)');
            // The leading rect runs one pixel under the trailing one
            assert.equal(attr(inside[0]!, 'rect', 'width'), '30');
            assert.equal(attr(inside[1]!, 'rect', 'x'), '29');
            assert.equal(attr(inside[1]!, 'rect', 'width'), '32');
        });

        test('the clip covers the whole badge and its id holds the size and the radius', () => {
            for (const [name, spec] of Object.entries(SIZES)) {
                const body = svg({ label: 'Hi', message: 'Yo', size: name });
                const clip = openings(body, 'rect')[0]!;
                const width = attr(body, 'svg', 'width');
                assert.equal(attr(clip, 'rect', 'width'), width, name);
                assert.equal(attr(clip, 'rect', 'height'), String(spec.height), name);
                assert.equal(attr(clip, 'rect', 'rx'), String(spec.height / 2), name);
                assert.equal(attr(body, 'clipPath', 'id'), `c-${width}-${spec.height}-${spec.height / 2}`, name);
            }
            assert.equal(attr(svg({ label: 'Hi', message: 'Yo', radius: 3.5 }), 'clipPath', 'id'), 'c-61-20-3.5');
        });

        test('the trailing icon comes after the message, in the message ink', () => {
            const body = svg({ label: 'Hi', message: 'Yo', trail: 'check', ink: '#112233', messageInk: '#aabbcc' });
            const groups = openings(body, 'g').filter((tag) => tag.includes('transform'));
            assert.equal(groups.length, 1);
            const x = Number(attr(groups[0]!, 'g', 'transform').match(/translate\(([\d.]+) /)![1]);
            const [left, right] = texts(body);
            assert.ok(x > right!.x + right!.length);
            assert.equal(x, right!.x + right!.length + 6 - 1);
            assert.equal(attr(groups[0]!, 'g', 'color'), '#aabbcc');
            assert.equal(attr(groups[0]!, 'g', 'stroke'), '#aabbcc');
            assert.equal(left!.fill, '#112233');
            assert.equal(right!.fill, '#aabbcc');
            assert.equal(attr(body, 'svg', 'width'), String(x + 12 + 8));
        });

        test('a filled trailing icon takes the message ink as its fill', () => {
            const body = svg({ label: 'Hi', message: 'Yo', trail: 'discord', ink: '#112233', messageInk: '#aabbcc' });
            const group = openings(body, 'g').find((tag) => tag.includes('transform'))!;
            assert.equal(attr(group, 'g', 'fill'), '#aabbcc');
            assert.ok(body.includes(FILLED_ICONS['discord']!));
        });

        test('the leading icon stays in the left part, in the ink', () => {
            for (const [name, spec] of Object.entries(SIZES)) {
                const body = svg({
                    label: 'Hi',
                    message: 'Yo',
                    icon: 'check',
                    size: name,
                    ink: '#112233',
                    messageInk: '#aabbcc',
                });
                const groups = openings(body, 'g').filter((tag) => tag.includes('transform'));
                assert.equal(groups.length, 1, name);
                assert.equal(
                    attr(groups[0]!, 'g', 'transform').split(' scale')[0],
                    `translate(${spec.pad} ${(spec.height - spec.icon) / 2})`,
                );
                assert.equal(attr(groups[0]!, 'g', 'stroke'), '#112233', name);
                const split = Number(attr(openings(body, 'rect')[2]!, 'rect', 'x'));
                assert.ok(spec.pad + spec.icon <= split, name);
                assert.equal(texts(body)[0]!.x, spec.pad + spec.icon + spec.gap, name);
                assert.equal(texts(body)[1]!.x, split + spec.pad, name);
            }
        });

        test('icon and trail both present give exactly two icon groups', () => {
            const body = svg({ label: 'Hi', message: 'Yo', icon: 'check', trail: 'check' });
            assert.equal(openings(body, 'g').filter((tag) => tag.includes('transform')).length, 2);
        });

        test('without a message the trailing icon keeps the ink', () => {
            const body = svg({ label: 'Hi', trail: 'check', ink: '#112233', messageInk: '#aabbcc' });
            const group = openings(body, 'g').find((tag) => tag.includes('transform'))!;
            assert.equal(attr(group, 'g', 'stroke'), '#112233');
        });

        test('defaults of messageStart, messageEnd and messageInk', () => {
            const body = svg({ label: 'Hi', message: 'Yo' });
            assert.equal(attr(openings(body, 'linearGradient')[1]!, 'linearGradient', 'id'), 'm-0969da-0969da');
            const stops = [...body.matchAll(/stop-color="([^"]*)"/g)].map((match) => match[1]);
            assert.deepEqual(stops, ['#2d333b', '#2d333b', '#0969da', '#0969da']);
            assert.equal(texts(body)[1]!.fill, '#ffffff');
        });

        test('messageEnd defaults to messageStart, and both can differ from the left part', () => {
            const same = svg({ label: 'Hi', message: 'Yo', messageStart: '#16a34a' });
            assert.ok(same.includes('id="m-16a34a-16a34a"'));
            const both = svg({
                label: 'Hi',
                message: 'Yo',
                start: '#111111',
                end: '#222222',
                messageStart: 'ff6600',
                messageEnd: '09c',
            });
            assert.ok(both.includes('id="g-111111-222222"'));
            assert.ok(both.includes('id="m-ff6600-09c"'));
            assert.deepEqual(
                [...both.matchAll(/stop-color="([^"]*)"/g)].map((match) => match[1]),
                ['#111111', '#222222', '#ff6600', '#09c'],
            );
        });

        test('the end of the left part still defaults to its own start, not to the message colors', () => {
            const body = svg({ label: 'Hi', message: 'Yo', start: '#112233', messageStart: '#445566' });
            assert.ok(body.includes('id="g-112233-112233"'));
            assert.ok(body.includes('id="m-445566-445566"'));
        });

        test('messageInk defaults to a custom ink', () => {
            const body = svg({ label: 'Hi', message: 'Yo', ink: '#ff0000', trail: 'check' });
            assert.deepEqual(
                texts(body).map((text) => text.fill),
                ['#ff0000', '#ff0000'],
            );
            const group = openings(body, 'g').find((tag) => tag.includes('transform'))!;
            assert.equal(attr(group, 'g', 'stroke'), '#ff0000');
        });

        test('messageInk only changes the message', () => {
            const body = svg({ label: 'Hi', message: 'Yo', ink: '#ff0000', messageInk: '#00ff00' });
            assert.deepEqual(
                texts(body).map((text) => text.fill),
                ['#ff0000', '#00ff00'],
            );
        });

        test('empty message ink falls back to the ink', () => {
            const body = svg({ label: 'Hi', message: 'Yo', ink: '#ff0000', messageInk: '' });
            assert.equal(texts(body)[1]!.fill, '#ff0000');
        });

        test('empty or undefined message gives the exact single part badge', () => {
            const options = { label: 'Hello', icon: 'check', trail: 'star', border: '#fff', lift: 2, angle: 45 };
            const plain = svg(options);
            assert.equal(svg({ ...options, message: '' }), plain);
            assert.equal(svg({ ...options, message: undefined }), plain);
            assert.equal(svg({ label: 'Hello', message: '' }), svg({ label: 'Hello' }));
            assert.ok(!plain.includes('clipPath'));
            assert.ok(!plain.includes('id="m-'));
        });

        test('message colors are ignored without a message', () => {
            const colors = { messageStart: '#ff0000', messageEnd: '#00ff00', messageInk: '#0000ff' };
            assert.equal(svg({ label: 'Hi', ...colors }), svg({ label: 'Hi' }));
            assert.equal(svg({ label: 'Hi', message: '', ...colors }), svg({ label: 'Hi' }));
        });

        test('a message makes the badge wider than the label alone', () => {
            for (const name of Object.keys(SIZES)) {
                const plain = Number(attr(svg({ label: 'Hi', size: name }), 'svg', 'width'));
                const body = Number(attr(svg({ label: 'Hi', message: 'Yo', size: name }), 'svg', 'width'));
                assert.ok(body > plain, name);
            }
        });

        test('message is trimmed, its spaces collapse and accents are composed', () => {
            assert.equal(svg({ label: 'Hi', message: '  a   b  ' }), svg({ label: 'Hi', message: 'a b' }));
            assert.equal(svg({ label: 'Hi', message: 'é' }), svg({ label: 'Hi', message: 'é' }));
        });

        test('64 characters are accepted and measured', () => {
            const message = 'a'.repeat(64);
            const body = svg({ label: 'Hi', message });
            assert.equal(texts(body)[1]!.length, expectedText(message, 11));
        });

        test('title and aria-label read label: message', () => {
            const body = svg({ label: 'build', message: 'passing' });
            assert.equal(attr(body, 'svg', 'aria-label'), 'build: passing');
            assert.ok(body.includes('<title>build: passing</title>'));
        });

        test('title and aria-label escape both texts', () => {
            const body = svg({ label: `a&b<c>`, message: `d"e'f&g` });
            const title = 'a&amp;b&lt;c&gt;: d&quot;e&apos;f&amp;g';
            assert.equal(attr(body, 'svg', 'aria-label'), title);
            assert.ok(body.includes(`<title>${title}</title>`));
            assert.deepEqual(
                texts(body).map((text) => text.content),
                ['a&amp;b&lt;c&gt;', 'd&quot;e&apos;f&amp;g'],
            );
        });

        test('only the expected elements are emitted', () => {
            assert.deepEqual(tags(svg({ label: 'Hi', message: 'Yo' })), PARTS);
            assert.deepEqual(tags(svg({ label: 'Hi', message: 'Yo', border: '#fff' })), PARTS);
            const icons = tags(svg({ label: 'Hi', message: 'Yo', icon: 'check', trail: 'check', border: '#fff' }));
            for (const name of icons) assert.ok(PARTS.has(name) || SHAPES.has(name), name);
        });

        test('rect and text counts', () => {
            const plain = svg({ label: 'Hi', message: 'Yo' });
            assert.equal(openings(plain, 'rect').length, 3);
            assert.equal(openings(plain, 'text').length, 2);
            assert.equal(openings(plain, 'linearGradient').length, 2);
            assert.equal(openings(plain, 'clipPath').length, 1);
            assert.equal(openings(svg({ label: 'Hi', message: 'Yo', border: '#fff' }), 'rect').length, 4);
        });

        test('the border is a fill-none stroke rect drawn after the parts', () => {
            for (const [name, spec] of Object.entries(SIZES)) {
                const body = svg({ label: 'Hi', message: 'Yo', size: name, border: '#ff0000' });
                const width = Number(attr(body, 'svg', 'width'));
                const rects = openings(body, 'rect');
                assert.equal(rects.length, 4, name);
                const border = rects[3]!;
                assert.equal(attr(border, 'rect', 'x'), '0.5', name);
                assert.equal(attr(border, 'rect', 'y'), '0.5', name);
                assert.equal(attr(border, 'rect', 'width'), String(width - 1), name);
                assert.equal(attr(border, 'rect', 'height'), String(spec.height - 1), name);
                assert.equal(attr(border, 'rect', 'rx'), String(spec.height / 2 - 0.5), name);
                assert.equal(attr(border, 'rect', 'fill'), 'none', name);
                assert.equal(attr(border, 'rect', 'stroke'), '#ff0000', name);
                assert.equal(attr(border, 'rect', 'stroke-width'), '1', name);
                assert.ok(body.indexOf(border) > body.indexOf('</g>'), name);
                assert.ok(body.indexOf(border) < body.indexOf('<text'), name);
                for (const part of rects.slice(0, 3)) assert.ok(!part.includes('stroke'), name);
            }
        });

        test('a border does not change the size', () => {
            const plain = svg({ label: 'Hi', message: 'Yo', size: 'lg' });
            const body = svg({ label: 'Hi', message: 'Yo', size: 'lg', border: '#000' });
            assert.equal(attr(body, 'svg', 'width'), attr(plain, 'svg', 'width'));
            assert.equal(attr(body, 'svg', 'height'), attr(plain, 'svg', 'height'));
        });

        test('lift adds to the height only', () => {
            const plain = svg({ label: 'Hi', message: 'Yo' });
            const body = svg({ label: 'Hi', message: 'Yo', lift: 3 });
            assert.equal(attr(body, 'svg', 'width'), attr(plain, 'svg', 'width'));
            assert.equal(attr(body, 'svg', 'height'), '26');
        });

        test('output is deterministic', () => {
            const options = { label: 'Same', message: 'Same', icon: 'check', angle: 30 };
            assert.equal(svg(options), svg(options));
        });

        describe('ids', () => {
            const configs: Parameters<typeof badge>[0][] = [
                { label: 'Hi', message: 'Yo' },
                { label: 'Hi', message: 'Yo', start: '#0969da', messageStart: '#0969da' },
                {
                    label: 'Hi',
                    message: 'Yo',
                    start: '#112233',
                    end: '#112233',
                    messageStart: '#112233',
                    messageEnd: '#112233',
                },
                { label: 'Hi', message: 'Yo', angle: 45 },
                { label: 'Hi', message: 'Yo', start: '#abcdef', messageStart: '#abcdef', angle: 0 },
                { label: 'Hi', message: 'Yo', border: '#fff', radius: 0, icon: 'check', trail: 'check' },
                { label: 'Hi', message: 'Yo', size: 'lg', lift: 4 },
            ];

            test('no id is declared twice, even with identical colors on both sides', () => {
                for (const options of configs) {
                    const found = ids(svg(options));
                    assert.equal(found.length, 3, JSON.stringify(options));
                    assert.equal(new Set(found).size, found.length, JSON.stringify(options));
                }
            });

            test('the left and the right gradients and the clip have their own prefix', () => {
                const found = ids(svg({ label: 'Hi', message: 'Yo', start: '#112233', messageStart: '#112233' }));
                assert.deepEqual(
                    found.map((id) => id.split('-')[0]),
                    ['g', 'm', 'c'],
                );
                assert.equal(found[0]!.slice(1), found[1]!.slice(1));
            });

            test('every reference points at a declared id', () => {
                for (const options of configs) {
                    const body = svg(options);
                    const declared = new Set(ids(body));
                    const used = [...body.matchAll(/url\(#([^)]*)\)/g)].map((match) => match[1]!);
                    assert.equal(used.length, 3, JSON.stringify(options));
                    for (const id of used) assert.ok(declared.has(id), `${id} in ${JSON.stringify(options)}`);
                    assert.equal(new Set(used).size, 3, JSON.stringify(options));
                }
            });

            test('ids hold only safe characters', () => {
                for (const options of configs) {
                    for (const id of ids(svg(options))) assert.match(id, /^[a-z]-[0-9a-zA-Z.-]+$/, id);
                }
            });

            test('a single part badge declares a single id', () => {
                assert.deepEqual(ids(svg({ label: 'Hi' })), ['g-2d333b-2d333b']);
            });
        });

        describe('validation', () => {
            test('blank messages throw', () => {
                for (const message of [' ', '   ', '\u00a0', ' \u00a0 ', '\n', '\t', ' \t\n ']) {
                    assert.throws(() => badge({ label: 'Hi', message }), { message: 'Please provide a valid message' });
                }
            });

            test('non-string messages throw', () => {
                for (const message of [123, 0, true, false, {}, [], ['a']]) {
                    assert.throws(() => badge({ label: 'Hi', message } as never), {
                        message: 'Please provide a valid message',
                    });
                }
            });

            test('65 characters are too many, in characters and not in UTF-16 units', () => {
                const message = 'Message cannot exceed 64 characters';
                assert.throws(() => badge({ label: 'Hi', message: 'a'.repeat(65) }), { message });
                assert.throws(() => badge({ label: 'Hi', message: 'a'.repeat(5000) }), { message });
                assert.throws(() => badge({ label: 'Hi', message: '😀'.repeat(65) }), { message });
                assert.doesNotThrow(() => badge({ label: 'Hi', message: '😀'.repeat(64) }));
            });

            test('spaces count after they collapse', () => {
                assert.doesNotThrow(() =>
                    badge({ label: 'Hi', message: `${'a'.repeat(32)}${' '.repeat(40)}${'b'.repeat(31)}` }),
                );
            });

            test('control and invisible characters throw', () => {
                const message = 'Message cannot contain control or invisible characters';
                const bad = [
                    '\n',
                    '\r',
                    '\t',
                    '\u0000',
                    '\u001f',
                    '\u007f',
                    '\u0085',
                    '\u009f',
                    '​',
                    '‏',
                    '‪',
                    '‮',
                    ' ',
                    ' ',
                    '⁦',
                    '⁩',
                    '﻿',
                    '￾',
                    '￿',
                    '\ud800',
                ];
                for (const char of bad) {
                    assert.throws(
                        () => badge({ label: 'Hi', message: `a${char}b` }),
                        { message },
                        JSON.stringify(char),
                    );
                }
            });

            test('a bad message does not hide behind a good label and a bad label comes first', () => {
                assert.throws(() => badge({ label: 'Hi', message: 'a\nb' }), /Message cannot contain/);
                assert.throws(() => badge({ label: '', message: 'a'.repeat(65) }), {
                    message: 'Please provide a label (?label={text})',
                });
                assert.throws(() => badge({ label: 'a'.repeat(65), message: 'a\nb' }), {
                    message: 'Label cannot exceed 64 characters',
                });
            });

            test('bad messageStart, messageEnd and messageInk throw with the parameter name', () => {
                for (const name of ['messageStart', 'messageEnd', 'messageInk'] as const) {
                    for (const value of ['nope', '#12', '#ggg', '#ffff', '##fff', 'red', ' fff']) {
                        assert.throws(() => badge({ label: 'Hi', message: 'Yo', [name]: value }), {
                            message: `Invalid ${name} color (use hex like ff6600)`,
                        });
                    }
                }
            });

            test('non-string messageStart, messageEnd and messageInk throw', () => {
                for (const name of ['messageStart', 'messageEnd', 'messageInk'] as const) {
                    for (const value of [123, true, {}, ['#fff']]) {
                        assert.throws(() => badge({ label: 'Hi', message: 'Yo', [name]: value } as never), {
                            message: `Please provide a valid ${name} color`,
                        });
                    }
                }
            });

            test('colors are checked even when the message is absent', () => {
                assert.throws(() => badge({ label: 'Hi', messageStart: 'nope' }), /Invalid messageStart color/);
                assert.throws(
                    () => badge({ label: 'Hi', message: '', messageInk: 'nope' }),
                    /Invalid messageInk color/,
                );
            });

            test('a valid messageStart does not hide a bad messageEnd', () => {
                assert.throws(
                    () => badge({ label: 'Hi', message: 'Yo', messageStart: '#fff', messageEnd: 'xyz' }),
                    /Invalid messageEnd color/,
                );
            });
        });
    });

    describe('radius', () => {
        const message = 'Invalid radius (use a number from 0 to 100)';

        /**
         * Reads the rx of the first rect that draws the badge fill.
         *
         * @param options - Badge options
         * @returns The rx attribute
         */
        function rx(options: Parameters<typeof badge>[0]): string {
            return attr(svg(options), 'rect', 'rx');
        }

        test('the default is a pill on every size', () => {
            for (const [name, spec] of Object.entries(SIZES)) {
                assert.equal(rx({ label: 'Hi', size: name }), String(spec.height / 2), name);
            }
        });

        test('a radius of half the height is the default output', () => {
            for (const [name, spec] of Object.entries(SIZES)) {
                const options = { label: 'Hi', size: name };
                assert.equal(svg({ ...options, radius: spec.height / 2 }), svg(options), name);
                assert.equal(
                    svg({ ...options, radius: spec.height / 2, message: 'Yo' }),
                    svg({ ...options, message: 'Yo' }),
                    name,
                );
            }
        });

        test('zero is square', () => {
            assert.equal(rx({ label: 'Hi', radius: 0 }), '0');
            for (const name of Object.keys(SIZES)) assert.equal(rx({ label: 'Hi', radius: 0, size: name }), '0', name);
        });

        test('an intermediate radius is used as given', () => {
            assert.equal(rx({ label: 'Hi', radius: 4 }), '4');
            assert.equal(rx({ label: 'Hi', radius: 2.5 }), '2.5');
            assert.equal(rx({ label: 'Hi', radius: 9.99 }), '9.99');
            assert.equal(rx({ label: 'Hi', radius: 13, size: 'lg' }), '13');
        });

        test('values above half the height are clamped to the pill on every size', () => {
            for (const [name, spec] of Object.entries(SIZES)) {
                for (const radius of [spec.height / 2 + 0.01, spec.height / 2 + 1, spec.height, 50, 100]) {
                    assert.equal(rx({ label: 'Hi', radius, size: name }), String(spec.height / 2), `${name} ${radius}`);
                    assert.equal(
                        svg({ label: 'Hi', radius, size: name }),
                        svg({ label: 'Hi', size: name }),
                        `${name} ${radius}`,
                    );
                }
            }
        });

        test('the radius does not change the size', () => {
            const plain = svg({ label: 'Hello' });
            const body = svg({ label: 'Hello', radius: 3 });
            assert.equal(attr(body, 'svg', 'width'), attr(plain, 'svg', 'width'));
            assert.equal(attr(body, 'svg', 'height'), attr(plain, 'svg', 'height'));
        });

        test('0 and 100 are accepted, null means the default', () => {
            assert.doesNotThrow(() => badge({ label: 'Hi', radius: 0 }));
            assert.doesNotThrow(() => badge({ label: 'Hi', radius: 100 }));
            assert.equal(svg({ label: 'Hi', radius: null as unknown as number }), svg({ label: 'Hi' }));
            assert.equal(svg({ label: 'Hi', radius: undefined }), svg({ label: 'Hi' }));
        });

        test('out of range, not-a-number and non-number values are rejected', () => {
            for (const radius of [101, 100.01, 100.004, 1000, -1, -0.01, NaN, Infinity, -Infinity]) {
                assert.throws(() => badge({ label: 'Hi', radius }), { message }, String(radius));
            }
            for (const radius of ['3', '', 'abc', true, false, {}, [], [3]]) {
                assert.throws(() => badge({ label: 'Hi', radius } as never), { message }, String(radius));
            }
        });

        test('values are rounded to two decimals', () => {
            assert.equal(rx({ label: 'Hi', radius: 3.456 }), '3.46');
            assert.equal(rx({ label: 'Hi', radius: 3.454 }), '3.45');
            assert.equal(rx({ label: 'Hi', radius: 3.004 }), '3');
            assert.equal(rx({ label: 'Hi', radius: 0.004 }), '0');
            assert.equal(rx({ label: 'Hi', radius: 5.5 }), '5.5');
        });

        test('with a border the rx is the radius minus half a pixel', () => {
            assert.equal(rx({ label: 'Hi', radius: 4, border: '#fff' }), '3.5');
            assert.equal(rx({ label: 'Hi', radius: 5.25, border: '#fff' }), '4.75');
            assert.equal(rx({ label: 'Hi', border: '#fff' }), '9.5');
            for (const [name, spec] of Object.entries(SIZES)) {
                assert.equal(
                    rx({ label: 'Hi', radius: 100, border: '#fff', size: name }),
                    String(spec.height / 2 - 0.5),
                    name,
                );
            }
        });

        test('the rx with a border keeps two decimals at most', () => {
            for (const radius of [0.51, 0.52, 0.55, 1.1, 3.33, 7.77]) {
                const value = rx({ label: 'Hi', radius, border: '#fff' });
                assert.ok(!/\.\d{3}/.test(value), `${radius} -> ${value}`);
                const two = svg({ label: 'Hi', radius, border: '#fff', message: 'Yo' });
                for (const opening of openings(two, 'rect').filter((tag) => tag.includes('rx='))) {
                    assert.ok(!/rx="\d+\.\d{3}/.test(opening), `${radius} -> ${opening}`);
                }
            }
            assert.equal(rx({ label: 'Hi', radius: 0.51, border: '#fff' }), '0.01');
            assert.equal(rx({ label: 'Hi', radius: 1.1, border: '#fff' }), '0.6');
        });

        test('the rx is never negative', () => {
            for (const radius of [0, 0.01, 0.25, 0.5]) {
                assert.equal(rx({ label: 'Hi', radius, border: '#fff' }), '0', String(radius));
                assert.equal(
                    openings(svg({ label: 'Hi', radius, border: '#fff', message: 'Yo' }), 'rect')
                        .pop()!
                        .includes('rx="0"'),
                    true,
                    String(radius),
                );
            }
            assert.ok(Math.abs(Number(rx({ label: 'Hi', radius: 0.51, border: '#fff' })) - 0.01) < 1e-9);
            for (const options of [
                { label: 'Hi', radius: 0, border: '#fff' },
                { label: 'Hi', radius: 0, border: '#fff', message: 'Yo' },
                { label: 'Hi', radius: 0.3, border: '#fff', message: 'Yo' },
            ]) {
                assert.ok(!/rx="-/.test(svg(options)), JSON.stringify(options));
            }
        });

        describe('with a message', () => {
            test('the radius applies to the clip rect', () => {
                for (const [name, spec] of Object.entries(SIZES)) {
                    const clip = (radius?: number): string =>
                        attr(
                            openings(svg({ label: 'Hi', message: 'Yo', size: name, radius }), 'rect')[0]!,
                            'rect',
                            'rx',
                        );
                    assert.equal(clip(), String(spec.height / 2), name);
                    assert.equal(clip(0), '0', name);
                    assert.equal(clip(3), '3', name);
                    assert.equal(clip(3.456), '3.46', name);
                    assert.equal(clip(100), String(spec.height / 2), name);
                    assert.equal(clip(spec.height / 2 + 1), String(spec.height / 2), name);
                }
            });

            test('the two part rects carry no radius of their own', () => {
                const rects = openings(svg({ label: 'Hi', message: 'Yo', radius: 3 }), 'rect');
                assert.ok(!rects[1]!.includes('rx='));
                assert.ok(!rects[2]!.includes('rx='));
            });

            test('with a border the clip and the stroke rect share the same inset box', () => {
                const rects = openings(svg({ label: 'Hi', message: 'Yo', radius: 4, border: '#fff' }), 'rect');
                for (const name of ['x', 'y', 'width', 'height', 'rx']) {
                    assert.equal(attr(rects[0]!, 'rect', name), attr(rects[3]!, 'rect', name), name);
                }
                assert.equal(attr(rects[0]!, 'rect', 'x'), '0.5');
                assert.equal(attr(rects[0]!, 'rect', 'y'), '0.5');
                assert.equal(attr(rects[0]!, 'rect', 'width'), '60');
                assert.equal(attr(rects[0]!, 'rect', 'height'), '19');
                assert.equal(attr(rects[0]!, 'rect', 'rx'), '3.5');
                assert.ok(rects[3]!.includes('fill="none"'));
                assert.ok(rects[3]!.includes('stroke="#fff"'));
                const pill = openings(svg({ label: 'Hi', message: 'Yo', border: '#fff' }), 'rect');
                assert.equal(attr(pill[0]!, 'rect', 'rx'), '9.5');
                assert.equal(attr(pill[3]!, 'rect', 'rx'), '9.5');
            });

            test('without a border the clip is the whole badge and there is no stroke rect', () => {
                const rects = openings(svg({ label: 'Hi', message: 'Yo', radius: 4 }), 'rect');
                assert.equal(rects.length, 3);
                assert.equal(attr(rects[0]!, 'rect', 'x'), '0');
                assert.equal(attr(rects[0]!, 'rect', 'y'), '0');
                assert.equal(attr(rects[0]!, 'rect', 'width'), '61');
                assert.equal(attr(rects[0]!, 'rect', 'height'), '20');
                assert.equal(attr(rects[0]!, 'rect', 'rx'), '4');
            });

            test('the clip id tells a bordered badge from a plain one', () => {
                const plain = attr(svg({ label: 'Hi', message: 'Yo', radius: 4 }), 'clipPath', 'id');
                const bordered = attr(svg({ label: 'Hi', message: 'Yo', radius: 4, border: '#fff' }), 'clipPath', 'id');
                assert.equal(plain, 'c-61-20-4');
                assert.equal(bordered, 'c-61-20-4-b');
            });

            test('the leading rect runs one pixel under the trailing one, never past the badge', () => {
                for (const [name, spec] of Object.entries(SIZES)) {
                    for (const options of [{}, { icon: 'check', trail: 'check' }]) {
                        const body = svg({ label: 'Hi', message: 'Yo', size: name, ...options });
                        const rects = openings(body, 'rect');
                        const split = Number(attr(rects[2]!, 'rect', 'x'));
                        const width = Number(attr(body, 'svg', 'width'));
                        assert.equal(Number(attr(rects[1]!, 'rect', 'width')), split + 1, name);
                        assert.ok(split + 1 <= width, name);
                        assert.equal(Number(attr(rects[2]!, 'rect', 'width')), width - split, name);
                        assert.equal(Number(attr(rects[1]!, 'rect', 'height')), spec.height, name);
                    }
                }
            });

            test('square two-part badge', () => {
                const body = svg({ label: 'Hi', message: 'Yo', radius: 0, border: '#fff' });
                const rects = openings(body, 'rect');
                assert.equal(attr(rects[0]!, 'rect', 'rx'), '0');
                assert.equal(attr(rects[3]!, 'rect', 'rx'), '0');
                assert.ok(body.includes('id="c-61-20-0-b"'));
            });

            test('the radius does not change the geometry', () => {
                const plain = svg({ label: 'Hi', message: 'Yo' });
                const body = svg({ label: 'Hi', message: 'Yo', radius: 2 });
                assert.equal(attr(body, 'svg', 'width'), attr(plain, 'svg', 'width'));
                assert.deepEqual(texts(body), texts(plain));
            });

            test('the radius is validated as well', () => {
                assert.throws(() => badge({ label: 'Hi', message: 'Yo', radius: 101 }), { message });
            });
        });
    });

    describe('angle', () => {
        const message = 'Invalid angle (use a number from 0 to 360)';

        /**
         * Reads the points of the first gradient of a badge.
         *
         * @param options - Badge options
         * @returns The four coordinates
         */
        function first(options: Parameters<typeof badge>[0]): string {
            const body = svg(options);
            return points(body, attr(body, 'linearGradient', 'id'));
        }

        test('absent keeps the corner to corner gradient and the old id', () => {
            const body = svg({ label: 'Hi' });
            assert.equal(first({ label: 'Hi' }), '0 0 1 1');
            assert.equal(attr(body, 'linearGradient', 'id'), 'g-2d333b-2d333b');
            assert.equal(svg({ label: 'Hi', angle: undefined }), body);
            assert.equal(svg({ label: 'Hi', angle: null as unknown as number }), body);
        });

        test('90 runs from left to right', () => {
            assert.equal(first({ label: 'Hi', angle: 90 }), '0 0.5 1 0.5');
        });

        test('180 runs from top to bottom', () => {
            assert.equal(first({ label: 'Hi', angle: 180 }), '0.5 0 0.5 1');
        });

        test('0 runs from bottom to top', () => {
            assert.equal(first({ label: 'Hi', angle: 0 }), '0.5 1 0.5 0');
        });

        test('270 runs from right to left', () => {
            assert.equal(first({ label: 'Hi', angle: 270 }), '1 0.5 0 0.5');
        });

        test('45 and 135 run along the diagonals', () => {
            // The reach grows to the diagonals, so each one runs from corner to corner
            assert.equal(first({ label: 'Hi', angle: 135 }), '0 0 1 1');
            assert.equal(first({ label: 'Hi', angle: 45 }), '0 1 1 0');
            assert.equal(first({ label: 'Hi', angle: 225 }), '1 0 0 1');
            assert.equal(first({ label: 'Hi', angle: 315 }), '1 1 0 0');
        });

        test('135 gives the same points as the default gradient', () => {
            assert.equal(first({ label: 'Hi', angle: 135 }), first({ label: 'Hi' }));
            const defaults = svg({ label: 'Hi' });
            const angled = svg({ label: 'Hi', angle: 135 });
            for (const name of ['x1', 'y1', 'x2', 'y2']) {
                assert.equal(attr(angled, 'linearGradient', name), attr(defaults, 'linearGradient', name), name);
            }
        });

        test('360 is the same direction as 0 and is accepted', () => {
            assert.equal(first({ label: 'Hi', angle: 360 }), first({ label: 'Hi', angle: 0 }));
        });

        test('no coordinate is negative zero or noisy', () => {
            for (let angle = 0; angle <= 360; angle++) {
                const body = svg({ label: 'Hi', angle });
                const tag = openings(body, 'linearGradient')[0]!;
                for (const name of ['x1', 'y1', 'x2', 'y2']) {
                    const value = attr(tag, 'linearGradient', name);
                    assert.match(value, /^-?(0|[1-9]\d*)(\.\d{1,4})?$/, `${angle} ${name}`);
                    assert.notEqual(value, '-0', `${angle} ${name}`);
                    // The reach lets the line pass the box a little, by 0.6036 around the center at most
                    assert.ok(Math.abs(Number(value) - 0.5) <= 0.6037, `${angle} ${name}`);
                }
            }
        });

        test('every whole angle runs through the center in the CSS direction', () => {
            for (let angle = 0; angle <= 360; angle++) {
                const [x1, y1, x2, y2] = first({ label: 'Hi', angle }).split(' ').map(Number) as [
                    number,
                    number,
                    number,
                    number,
                ];
                assert.ok(Math.abs(x1 + x2 - 1) < 2e-4, `${angle} center x`);
                assert.ok(Math.abs(y1 + y2 - 1) < 2e-4, `${angle} center y`);
                const radians = (angle * Math.PI) / 180;
                // The line follows the CSS direction, and its length is the CSS gradient line of a square box
                const reach = Math.abs(Math.sin(radians)) + Math.abs(Math.cos(radians));
                assert.ok(Math.abs(x2 - x1 - Math.sin(radians) * reach) < 2e-4, `${angle} dx`);
                assert.ok(Math.abs(y2 - y1 + Math.cos(radians) * reach) < 2e-4, `${angle} dy`);
            }
        });

        test('angles are rounded to whole degrees', () => {
            assert.equal(first({ label: 'Hi', angle: 89.6 }), first({ label: 'Hi', angle: 90 }));
            assert.equal(first({ label: 'Hi', angle: 89.5 }), first({ label: 'Hi', angle: 90 }));
            assert.equal(first({ label: 'Hi', angle: 89.4 }), first({ label: 'Hi', angle: 89 }));
            assert.equal(first({ label: 'Hi', angle: 0.4 }), first({ label: 'Hi', angle: 0 }));
            assert.equal(first({ label: 'Hi', angle: 359.6 }), first({ label: 'Hi', angle: 360 }));
            assert.equal(
                attr(svg({ label: 'Hi', angle: 89.6 }), 'linearGradient', 'id'),
                attr(svg({ label: 'Hi', angle: 90 }), 'linearGradient', 'id'),
            );
            assert.equal(svg({ label: 'Hi', angle: 89.996 }), svg({ label: 'Hi', angle: 90 }));
        });

        test('invalid values are rejected', () => {
            for (const angle of [361, 360.01, 360.004, 1000, -1, -0.01, NaN, Infinity, -Infinity]) {
                assert.throws(() => badge({ label: 'Hi', angle }), { message }, String(angle));
            }
            for (const angle of ['90', '', 'abc', true, false, {}, [], [90]]) {
                assert.throws(() => badge({ label: 'Hi', angle } as never), { message }, String(angle));
            }
        });

        test('the angle shows in the gradient id', () => {
            assert.equal(attr(svg({ label: 'Hi', angle: 90 }), 'linearGradient', 'id'), 'g-2d333b-2d333b-90');
            assert.equal(attr(svg({ label: 'Hi', angle: 0 }), 'linearGradient', 'id'), 'g-2d333b-2d333b-0');
            assert.equal(
                attr(svg({ label: 'Hi', angle: 45, start: '#ff0000', end: '#0000ff' }), 'linearGradient', 'id'),
                'g-ff0000-0000ff-45',
            );
            assert.notEqual(
                attr(svg({ label: 'Hi', angle: 0 }), 'linearGradient', 'id'),
                attr(svg({ label: 'Hi' }), 'linearGradient', 'id'),
            );
        });

        test('the rect points at the gradient with the angle', () => {
            const body = svg({ label: 'Hi', angle: 120 });
            assert.equal(attr(body, 'rect', 'fill'), 'url(#g-2d333b-2d333b-120)');
        });

        test('the angle shows in both gradient ids and both gradients share it', () => {
            const body = svg({ label: 'Hi', message: 'Yo', angle: 135 });
            assert.deepEqual(ids(body).slice(0, 2), ['g-2d333b-2d333b-135', 'm-0969da-0969da-135']);
            assert.equal(points(body, 'g-2d333b-2d333b-135'), '0 0 1 1');
            assert.equal(points(body, 'm-0969da-0969da-135'), points(body, 'g-2d333b-2d333b-135'));
            const rects = openings(body, 'rect');
            assert.equal(attr(rects[1]!, 'rect', 'fill'), 'url(#g-2d333b-2d333b-135)');
            assert.equal(attr(rects[2]!, 'rect', 'fill'), 'url(#m-0969da-0969da-135)');
        });

        test('without an angle both parts keep the old corner to corner gradient', () => {
            const body = svg({ label: 'Hi', message: 'Yo' });
            assert.equal(points(body, 'g-2d333b-2d333b'), '0 0 1 1');
            assert.equal(points(body, 'm-0969da-0969da'), '0 0 1 1');
        });

        test('the angle leaves the colors, the size and the text alone', () => {
            const plain = svg({ label: 'Hi', message: 'Yo', start: '#112233', end: '#445566' });
            const body = svg({ label: 'Hi', message: 'Yo', start: '#112233', end: '#445566', angle: 200 });
            assert.equal(attr(body, 'svg', 'width'), attr(plain, 'svg', 'width'));
            assert.deepEqual(texts(body), texts(plain));
            assert.deepEqual(
                [...body.matchAll(/stop-color="([^"]*)"/g)].map((match) => match[1]),
                [...plain.matchAll(/stop-color="([^"]*)"/g)].map((match) => match[1]),
            );
        });

        test('different angles give different ids, so inlined badges do not clash', () => {
            const a = ids(svg({ label: 'Hi', message: 'Yo', angle: 10 }));
            const b = ids(svg({ label: 'Hi', message: 'Yo', angle: 20 }));
            assert.equal(new Set([...a.slice(0, 2), ...b.slice(0, 2)]).size, 4);
        });
    });

    describe('HTML injection', () => {
        const payloads = [
            '<script>alert(1)</script>',
            '"/><script>alert(1)</script>',
            '" onload="alert(1)',
            `'><img src=x onerror=alert(1)>`,
            ']]><script>alert(1)</script>',
            '</text><rect onload="x"/>',
            '</svg><svg onload=alert(1)>',
            '&lt;b&gt;&amp;&#x3c;',
            '<!-- x -->',
            '<![CDATA[x]]>',
            'javascript:alert(1)',
            '{{7*7}}${7*7}',
        ];

        /**
         * Lists the element names of a document in order, with the attribute names of each opening tag.
         *
         * @param markup - SVG markup
         * @returns One entry per tag
         */
        function skeleton(markup: string): string[] {
            return [...markup.matchAll(/<\/?[a-zA-Z][^>]*>/g)].map((match) => {
                const name = match[0].match(/^<\/?([a-zA-Z]+)/)![1]!;
                return match[0].startsWith('</') ? `/${name}` : `${name}(${attrNames(match[0]).join(',')})`;
            });
        }

        test('a message cannot add elements or attributes', () => {
            const reference = skeleton(
                svg({ label: 'Hi', message: 'x', icon: 'check', trail: 'check', border: '#fff' }),
            );
            for (const payload of payloads) {
                const body = svg({ label: 'Hi', message: payload, icon: 'check', trail: 'check', border: '#fff' });
                assert.deepEqual(skeleton(body), reference, payload);
                assert.ok(!/<script|<img|<!--|<!\[CDATA/i.test(body), payload);
            }
        });

        test('a message is escaped in the text, the title and the aria-label', () => {
            for (const payload of payloads) {
                const body = svg({ label: 'Hi', message: payload });
                const content = texts(body)[1]!.content;
                assert.ok(!/[<>"']/.test(content), payload);
                assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(content), payload);
                const label = attr(body, 'svg', 'aria-label');
                assert.ok(!/[<>"']/.test(label), payload);
                assert.equal(label, `Hi: ${content}`, payload);
                assert.ok(body.includes(`<title>Hi: ${content}</title>`), payload);
            }
        });

        test('an escaped message decodes back to what was sent', () => {
            const decode = (text: string): string =>
                text
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'")
                    .replace(/&amp;/g, '&');
            for (const payload of payloads) {
                const body = svg({ label: 'Hi', message: payload });
                assert.equal(
                    decode(texts(body)[1]!.content),
                    payload.normalize('NFC').replace(/ {2,}/g, ' ').trim(),
                    payload,
                );
            }
        });

        test('a payload in the label and the message at once stays inert', () => {
            const reference = skeleton(svg({ label: 'x', message: 'y' }));
            for (const payload of payloads) {
                assert.deepEqual(skeleton(svg({ label: payload, message: payload })), reference, payload);
            }
        });

        test('the root keeps its six attributes whatever the message', () => {
            for (const payload of payloads) {
                const names = attrNames(svg({ label: 'Hi', message: payload }).match(/<svg\b[^>]*>/)![0]);
                assert.deepEqual(names, ['xmlns', 'width', 'height', 'viewBox', 'role', 'aria-label'], payload);
            }
        });

        test('message colors reject every payload', () => {
            const colors = [...payloads, '#fff\n', '#fff;}</style>', 'url(#x)', '#fff" fill="red', 'fff fff'];
            for (const name of ['messageStart', 'messageEnd', 'messageInk'] as const) {
                for (const payload of colors) {
                    assert.throws(
                        () => badge({ label: 'Hi', message: 'Yo', [name]: payload }),
                        { message: `Invalid ${name} color (use hex like ff6600)` },
                        `${name} ${payload}`,
                    );
                }
            }
        });

        test('numbers cannot carry markup', () => {
            for (const name of ['radius', 'angle', 'lift'] as const) {
                for (const payload of payloads) {
                    assert.throws(
                        () => badge({ label: 'Hi', [name]: payload } as never),
                        /Invalid (radius|angle|lift)/,
                        name,
                    );
                }
            }
        });

        test('accepted values never leave the expected characters in the output', () => {
            const body = svg({
                label: 'Hi',
                message: 'Yo',
                messageStart: 'ABC',
                messageEnd: '#def012',
                messageInk: '123',
                radius: 3.456,
                angle: 33.3,
                border: '#fff',
            });
            assert.ok(!/[<>"']\s*(javascript|script)/i.test(body));
            for (const value of [...body.matchAll(/="([^"]*)"/g)].map((match) => match[1]!)) {
                assert.ok(!/[<>&]/.test(value), value);
            }
        });
    });

    describe('font and weight', () => {
        const FACES: Face[] = FONTS.flatMap((font) => WEIGHTS.map((weight) => ({ font, weight })));
        const fontMessage = 'Invalid font (use sans, serif or mono)';
        const weightMessage = 'Invalid weight (use normal or bold)';

        /**
         * Renders a badge in a face.
         *
         * @param options - Badge options
         * @param face - Font and weight
         * @returns The SVG body
         */
        function inFace(options: Parameters<typeof badge>[0], face: Face): string {
            return svg({ ...options, font: face.font, weight: face.weight });
        }

        /**
         * Names a face for assertion messages.
         *
         * @param face - Font and weight
         * @returns The font and the weight joined by a space
         */
        function name(face: Face): string {
            return `${face.font} ${face.weight}`;
        }

        describe('defaults', () => {
            test('the default is sans bold, drawn with the Verdana stack and weight 600', () => {
                const body = svg({ label: 'Hi' });
                assert.equal(attr(body, 'text', 'font-family'), 'Verdana,DejaVu Sans,Geneva,sans-serif');
                assert.equal(attr(body, 'text', 'font-weight'), '600');
                assert.equal(textLength(body), expectedText('Hi', 11, { font: 'sans', weight: 'bold' }));
            });

            test('the text element is exactly the one drawn before the options existed', () => {
                // Hi is 1714 + 702 = 2416 units in the bold face (hmtx of DejaVuSans-Bold), 2416 / 2048 * 11 = 12.98
                const body = svg({ label: 'Hi' });
                assert.ok(
                    body.includes(
                        '<text x="8" y="14.0" fill="#ffffff" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" ' +
                            'font-weight="600" font-size="11" textLength="13">Hi</text>',
                    ),
                );
            });

            test('explicit sans and bold give the byte-identical default output', () => {
                for (const options of [
                    { label: 'Hello' },
                    { label: 'Hi', message: 'Yo', icon: 'check', trail: 'star', border: '#fff', angle: 30 },
                    { label: 'Mis à jour', size: 'lg', radius: 3, lift: 2 },
                ]) {
                    const reference = svg(options);
                    assert.equal(svg({ ...options, font: 'sans' }), reference, JSON.stringify(options));
                    assert.equal(svg({ ...options, weight: 'bold' }), reference, JSON.stringify(options));
                    assert.equal(svg({ ...options, font: 'sans', weight: 'bold' }), reference, JSON.stringify(options));
                }
            });

            test('undefined and null mean the default, like the other optional parameters', () => {
                const reference = svg({ label: 'Hi', message: 'Yo' });
                assert.equal(svg({ label: 'Hi', message: 'Yo', font: undefined, weight: undefined }), reference);
                const nulls = { label: 'Hi', message: 'Yo', font: null, weight: null };
                assert.equal(svg(nulls as unknown as Parameters<typeof badge>[0]), reference);
            });

            test('the stacks and weights are pinned', () => {
                assert.deepEqual(STACKS, {
                    sans: 'Verdana,DejaVu Sans,Geneva,sans-serif',
                    serif: 'Georgia,DejaVu Serif,Times New Roman,serif',
                    mono: 'Menlo,DejaVu Sans Mono,Consolas,monospace',
                });
                assert.deepEqual(FONT_WEIGHTS, { normal: '400', bold: '600' });
            });
        });

        describe('attributes', () => {
            for (const face of FACES) {
                test(`${name(face)}: stack and weight on the label and the message`, () => {
                    const body = inFace({ label: 'Hi', message: 'Yo' }, face);
                    const [left, right] = openings(body, 'text');
                    for (const opening of [left!, right!]) {
                        assert.equal(attr(opening, 'text', 'font-family'), STACKS[face.font], name(face));
                        assert.equal(attr(opening, 'text', 'font-weight'), FONT_WEIGHTS[face.weight], name(face));
                    }
                    assert.equal(openings(body, 'text').length, 2);
                });

                test(`${name(face)}: the single part badge carries them as well`, () => {
                    const body = inFace({ label: 'Hi' }, face);
                    assert.equal(attr(body, 'text', 'font-family'), STACKS[face.font]);
                    assert.equal(attr(body, 'text', 'font-weight'), FONT_WEIGHTS[face.weight]);
                    assert.equal(openings(body, 'text').length, 1);
                });
            }

            test('the stack names no family but its own', () => {
                for (const font of FONTS) {
                    const other = FONTS.filter((candidate) => candidate !== font);
                    const body = svg({ label: 'Hi', font });
                    const family = attr(body, 'text', 'font-family');
                    assert.equal(family, STACKS[font]);
                    for (const candidate of other) assert.notEqual(family, STACKS[candidate]);
                }
            });

            test('font and weight are independent of one another', () => {
                const normal = svg({ label: 'Hi', font: 'serif', weight: 'normal' });
                const bold = svg({ label: 'Hi', font: 'serif', weight: 'bold' });
                assert.equal(attr(normal, 'text', 'font-family'), attr(bold, 'text', 'font-family'));
                assert.notEqual(attr(normal, 'text', 'font-weight'), attr(bold, 'text', 'font-weight'));
                const sans = svg({ label: 'Hi', font: 'sans', weight: 'normal' });
                assert.equal(attr(sans, 'text', 'font-weight'), attr(normal, 'text', 'font-weight'));
                assert.notEqual(attr(sans, 'text', 'font-family'), attr(normal, 'text', 'font-family'));
            });

            test('the attribute order and the other text attributes do not move', () => {
                for (const face of FACES) {
                    const opening = openings(inFace({ label: 'Hi' }, face), 'text')[0]!;
                    assert.deepEqual(attrNames(opening), [
                        'x',
                        'y',
                        'fill',
                        'font-family',
                        'font-weight',
                        'font-size',
                        'textLength',
                    ]);
                    assert.equal(attr(opening, 'text', 'y'), '14.0');
                    assert.equal(attr(opening, 'text', 'font-size'), '11');
                }
            });

            test('the face leaves the title, the aria-label and the colors alone', () => {
                for (const face of FACES) {
                    const options = { label: 'a&b', message: 'c<d', start: '#112233', end: '#445566', ink: '#aabbcc' };
                    const body = inFace(options, face);
                    const reference = svg(options);
                    assert.equal(attr(body, 'svg', 'aria-label'), attr(reference, 'svg', 'aria-label'), name(face));
                    assert.ok(body.includes('<title>a&amp;b: c&lt;d</title>'), name(face));
                    // The clip id holds the width, which depends on the face
                    assert.deepEqual(ids(body).slice(0, 2), ids(reference).slice(0, 2), name(face));
                    assert.deepEqual(
                        texts(body).map((text) => [text.content, text.fill]),
                        texts(reference).map((text) => [text.content, text.fill]),
                        name(face),
                    );
                }
            });
        });

        describe('text widths', () => {
            // Advances in font units (2048 per em), read from the horizontal metrics (hmtx) of the DejaVu fonts in
            // /usr/share/fonts/truetype/dejavu with a TTF parser and checked with PIL ImageFont.getlength at size 2048
            const ANCHORS: Record<string, Record<string, number>> = {
                'sans normal': { a: 1255, W: 2025, i: 569, ' ': 651, é: 1260, П: 1540, α: 1350, '€': 1303, '→': 1716 },
                'sans bold': { a: 1382, W: 2259, i: 702, ' ': 713, é: 1389, П: 1714, α: 1407, '€': 1425, '→': 1716 },
                'serif normal': { a: 1221, W: 2105, i: 655, ' ': 651, é: 1212, П: 1786, α: 1383, '€': 1303, '→': 1716 },
                'serif bold': { a: 1327, W: 2300, i: 778, ' ': 713, é: 1303, П: 1934, α: 1576, '€': 1425, '→': 1716 },
            };

            for (const [key, anchors] of Object.entries(ANCHORS)) {
                const [font, weight] = key.split(' ') as [Font & ('sans' | 'serif'), Weight];
                test(`${key}: single characters take their font advance, at every size`, () => {
                    for (const [char, units] of Object.entries(anchors)) {
                        assert.equal(
                            tableWidth(char.codePointAt(0)!, TABLES[font][weight]),
                            units,
                            `${key} ${char} table`,
                        );
                        if (char === ' ') continue;
                        for (const [size, spec] of Object.entries(SIZES)) {
                            const body = svg({ label: char, font, weight, size });
                            assert.equal(
                                textLength(body),
                                Math.round((units / 2048) * spec.font),
                                `${key} ${char} ${size}`,
                            );
                        }
                    }
                });
            }

            test('Hello World at sm is 64, 72, 67 and 74 pixels in the four proportional faces', () => {
                // Sums of the per-character hmtx advances, kerning left out: 11831, 13471, 12475 and 13828 units, then
                // times 11 / 2048
                const lengths = {
                    'sans normal': 64,
                    'sans bold': 72,
                    'serif normal': 67,
                    'serif bold': 74,
                } as const;
                for (const [key, length] of Object.entries(lengths)) {
                    const [font, weight] = key.split(' ');
                    assert.equal(textLength(svg({ label: 'Hello World', font, weight })), length, key);
                }
                assert.equal(new Set(Object.values(lengths)).size, 4);
                assert.equal(textLength(svg({ label: 'Hello World', font: 'mono' })), 73);
            });

            test('Mis à jour at sm is 53, 61, 56 and 62 pixels in the four proportional faces', () => {
                // Sums of the hmtx advances: 9922, 11344, 10492 and 11626 units
                const lengths = { 'sans normal': 53, 'sans bold': 61, 'serif normal': 56, 'serif bold': 62 } as const;
                for (const [key, length] of Object.entries(lengths)) {
                    const [font, weight] = key.split(' ');
                    assert.equal(textLength(svg({ label: 'Mis à jour', font, weight })), length, key);
                }
                assert.equal(textLength(svg({ label: 'Mis à jour', font: 'mono' })), 66);
            });

            test('every face matches the tables for words in several scripts', () => {
                const words = [
                    'Hello World',
                    'WWWWWWWW',
                    'iiiiiiii',
                    'Mis à jour',
                    'Çà et là, où ñ ü Ö ÿ',
                    'Привет мир',
                    'Αθήνα αβγ',
                    '€ 5 → 6 ™ …',
                    'a日b',
                    'x😀y',
                ];
                for (const face of FACES) {
                    for (const word of words) {
                        for (const [size, spec] of Object.entries(SIZES)) {
                            const body = inFace({ label: word, message: word, size }, face);
                            const expected = expectedText(word, spec.font, face);
                            const [left, right] = texts(body);
                            assert.equal(left!.length, expected, `${name(face)} ${word} ${size}`);
                            assert.equal(right!.length, expected, `${name(face)} ${word} ${size} message`);
                        }
                    }
                }
            });

            test('the four proportional faces measure Latin, Cyrillic and Greek words differently', () => {
                for (const word of ['Hello World', 'Mis à jour', 'Привет мир', 'Αθήνα αβγ']) {
                    const units = (['sans', 'serif'] as const).flatMap((font) =>
                        WEIGHTS.map((weight) => {
                            let sum = 0;
                            for (const char of word) sum += faceWidth(char.codePointAt(0)!, { font, weight });
                            return sum;
                        }),
                    );
                    assert.equal(new Set(units).size, 4, `${word}: ${units.join(' ')}`);
                    // Bold is wider than regular in both families for these words
                    assert.ok(units[1]! > units[0]!, `${word} sans`);
                    assert.ok(units[3]! > units[2]!, `${word} serif`);
                }
            });

            test('every code point of the tables is measured in every face', () => {
                const hidden = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
                const forbidden = (code: number): boolean => hidden.test(String.fromCodePoint(code));
                let checked = 0;
                for (const [first, list] of SANS_BOLD) {
                    for (let offset = 0; offset < list.length; offset++) {
                        const code = first + offset;
                        const char = String.fromCodePoint(code);
                        // The bars keep a combining mark from composing with a letter, and a space from collapsing
                        const label = `|${char}|`;
                        if (forbidden(code) || label.normalize('NFC') !== label) continue;
                        checked++;
                        for (const face of FACES) {
                            const units = 2 * faceWidth(0x7c, face) + faceWidth(code, face);
                            assert.equal(
                                textLength(inFace({ label, size: 'lg' }, face)),
                                Math.round((units / UNITS_PER_EM) * 13),
                                `${name(face)} U+${code.toString(16)}`,
                            );
                        }
                    }
                }
                assert.ok(checked > 1200, `${checked} code points checked`);
            });

            test('combining marks that stay decomposed take no width in the proportional faces', () => {
                for (const font of ['sans', 'serif'] as const) {
                    for (const weight of WEIGHTS) {
                        const plain = textLength(svg({ label: '|', font, weight }));
                        assert.equal(textLength(svg({ label: '|̣̣', font, weight })), plain, `${font} ${weight}`);
                    }
                }
            });

            test('combining marks that stay decomposed take no width in the monospace face either', () => {
                for (const weight of WEIGHTS) {
                    const plain = textLength(svg({ label: 'xy', font: 'mono', weight }));
                    // No composed form exists for these, so they are measured one by one
                    assert.equal(textLength(svg({ label: 'x\u0301y', font: 'mono', weight })), plain, weight);
                    assert.equal(textLength(svg({ label: 'a\u0483b', font: 'mono', weight })), plain, weight);
                    assert.equal(textLength(svg({ label: 'x\u036fy', font: 'mono', weight })), plain, weight);
                }
            });

            test('a character outside the tables is a full em in every face', () => {
                for (const face of FACES) {
                    for (const char of ['日', '😀', '한', 'ا']) {
                        assert.equal(textLength(inFace({ label: char }, face)), 11, `${name(face)} ${char}`);
                        assert.equal(
                            textLength(inFace({ label: char, size: 'lg' }, face)),
                            13,
                            `${name(face)} ${char}`,
                        );
                        assert.equal(textLength(inFace({ label: char.repeat(3) }, face)), 33, `${name(face)} ${char}`);
                    }
                }
            });
        });

        describe('monospace', () => {
            test('every character of a label counts 1233 units, whatever it is', () => {
                for (const label of ['iiiiiiii', 'WWWWWWWW', 'Hello', 'Привет', 'Αθήνα', 'Mis à jour', '€ → ™']) {
                    const count = [...label].length;
                    for (const weight of WEIGHTS) {
                        assert.equal(
                            textLength(svg({ label, font: 'mono', weight, size: 'lg' })),
                            Math.round(((count * 1233) / 2048) * 13),
                            `${label} ${weight}`,
                        );
                    }
                }
            });

            test('the advance is 1233 units, 0.6021 em', () => {
                assert.equal(MONO_ADVANCE, 1233);
                // Ten characters at 12 px are 12330 / 2048 * 12 = 72.2 pixels
                assert.equal(textLength(svg({ label: 'abcdefghij', font: 'mono', size: 'md' })), 72);
                assert.equal(textLength(svg({ label: 'iiiiiiiiii', font: 'mono', size: 'md' })), 72);
                assert.equal(textLength(svg({ label: 'WWWWWWWWWW', font: 'mono', size: 'md' })), 72);
            });

            test('the soft hyphen is 0 in the table and its neighbours are not', () => {
                assert.equal(faceWidth(0xad, { font: 'mono', weight: 'bold' }), 0);
                assert.equal(faceWidth(0xa0, { font: 'mono', weight: 'bold' }), 1233);
            });

            test('a character outside the tables takes the fallback width, not 1233', () => {
                // 日 and 😀 are a full em: 2048 units each, the others 1233
                assert.equal(textLength(svg({ label: '日', font: 'mono' })), 11);
                assert.equal(textLength(svg({ label: '😀', font: 'mono' })), 11);
                assert.equal(textLength(svg({ label: 'a日', font: 'mono' })), 18);
                assert.equal(textLength(svg({ label: '日a', font: 'mono' })), 18);
                assert.equal(textLength(svg({ label: '日😀日', font: 'mono' })), 33);
                assert.equal(Math.round(((1233 + FALLBACK_WIDTH) / UNITS_PER_EM) * 11), 18);
            });

            test('regular and bold are the same widths, and the same markup bar the weight', () => {
                for (const options of [
                    { label: 'Hello World' },
                    { label: 'Mis à jour', message: 'Привет 日本', icon: 'check', trail: 'star' },
                    { label: 'WWW', message: 'iii', border: '#fff', radius: 2, angle: 10, size: 'lg' },
                ]) {
                    const normal = svg({ ...options, font: 'mono', weight: 'normal' });
                    const bold = svg({ ...options, font: 'mono', weight: 'bold' });
                    assert.notEqual(normal, bold);
                    assert.equal(
                        normal.replaceAll('font-weight="400"', 'font-weight="600"'),
                        bold,
                        JSON.stringify(options),
                    );
                    assert.deepEqual(
                        texts(normal).map((text) => text.length),
                        texts(bold).map((text) => text.length),
                    );
                    assert.equal(attr(normal, 'svg', 'width'), attr(bold, 'svg', 'width'));
                }
            });

            test('the monospace width is the proportional width of no face', () => {
                const word = 'Hello World';
                const mono = textLength(svg({ label: word, font: 'mono' }));
                // An i takes the same room as a W here, which no proportional face does
                assert.equal(
                    textLength(svg({ label: 'i', font: 'mono' })),
                    textLength(svg({ label: 'W', font: 'mono' })),
                );
                assert.notEqual(
                    textLength(svg({ label: 'i', font: 'sans' })),
                    textLength(svg({ label: 'W', font: 'sans' })),
                );
                assert.equal(mono, 73);
            });

            test('the message is measured in the monospace face too', () => {
                const [left, right] = texts(svg({ label: 'iiii', message: 'WWWWWWWW', font: 'mono' }));
                assert.equal(left!.length, Math.round(((4 * 1233) / 2048) * 11));
                assert.equal(right!.length, Math.round(((8 * 1233) / 2048) * 11));
            });
        });

        describe('layout', () => {
            test('a single part badge is padding, optional icons, the text and padding on every face and size', () => {
                for (const face of FACES) {
                    for (const [size, spec] of Object.entries(SIZES)) {
                        for (const label of ['Hi', 'Hello World', 'Привет', '日本']) {
                            const length = expectedText(label, spec.font, face);
                            const plain = inFace({ label, size }, face);
                            const where = `${name(face)} ${size} ${label}`;
                            assert.equal(attr(plain, 'svg', 'width'), String(2 * spec.pad + length), where);
                            assert.equal(
                                attr(plain, 'svg', 'viewBox'),
                                `0 0 ${2 * spec.pad + length} ${spec.height}`,
                                where,
                            );
                            assert.equal(attr(plain, 'rect', 'width'), String(2 * spec.pad + length), where);
                            assert.equal(textLength(plain), length, where);
                            assert.equal(attr(plain, 'text', 'x'), String(spec.pad), where);

                            const icons = inFace({ label, size, icon: 'check', trail: 'check' }, face);
                            const textX = spec.pad + spec.icon + spec.gap;
                            const trailX = textX + length + spec.gap - 1;
                            assert.equal(attr(icons, 'text', 'x'), String(textX), where);
                            assert.equal(attr(icons, 'svg', 'width'), String(trailX + spec.icon + spec.pad), where);
                            assert.ok(icons.includes(`translate(${trailX} ${(spec.height - spec.icon) / 2})`), where);
                        }
                    }
                }
            });

            test('a two part badge follows the formula on every face, size, icon choice and pair of texts', () => {
                const cases: [string, string][] = [
                    ['Hi', 'Yo'],
                    ['Build', 'passing'],
                    ['W', 'iiiiii'],
                    ['Mis à jour', 'Très long message ici'],
                    ['Привет', 'Αθήνα'],
                    ['日本語', '世界'],
                    ['a\u00b7b', 'x\u00b7y'],
                ];
                for (const face of FACES) {
                    for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
                        for (const [label, message] of cases) {
                            for (const icons of [false, true]) {
                                const expected = geometry(size, label, message, icons, face);
                                const body = inFace(
                                    { label, message, size, ...(icons ? { icon: 'check', trail: 'check' } : {}) },
                                    face,
                                );
                                const where = `${name(face)} ${size} ${label} ${message} ${icons}`;
                                const [left, right] = texts(body);
                                assert.equal(attr(body, 'svg', 'width'), String(expected.width), where);
                                assert.equal(
                                    attr(openings(body, 'rect')[2]!, 'rect', 'x'),
                                    String(expected.split),
                                    where,
                                );
                                assert.equal(left!.x, expected.labelX, where);
                                assert.equal(left!.length, expected.labelLength, where);
                                assert.equal(right!.x, expected.messageX, where);
                                assert.equal(right!.length, expectedText(message, SIZES[size].font, face), where);
                                if (icons) {
                                    const trail = [...body.matchAll(/<g transform="translate\(([\d.]+) /g)][1]![1];
                                    assert.equal(trail, String(expected.trailX), where);
                                }
                            }
                        }
                    }
                }
            });

            test('hard-coded widths of Hi and Yo at sm in each face', () => {
                // hmtx advances of H, i, Y and o, then left = 8 + label + 8 and right = 8 + message + 8 at 11 px:
                // sans 1540 569 1251 1253, bold 1714 702 1483 1407, serif 1786 655 1352 1233,
                // serif bold 1935 778 1462 1366, mono 1233 for each
                const expected: Record<string, [number, number]> = {
                    'sans normal': [56, 27],
                    'sans bold': [61, 29],
                    'serif normal': [59, 29],
                    'serif bold': [62, 31],
                    'mono normal': [58, 29],
                    'mono bold': [58, 29],
                };
                for (const face of FACES) {
                    const [width, split] = expected[name(face)]!;
                    const body = inFace({ label: 'Hi', message: 'Yo' }, face);
                    assert.equal(attr(body, 'svg', 'width'), String(width), name(face));
                    assert.equal(attr(openings(body, 'rect')[2]!, 'rect', 'x'), String(split), name(face));
                }
            });

            test('the split sits one padding after the label, the message one padding after the split', () => {
                for (const face of FACES) {
                    for (const [size, spec] of Object.entries(SIZES)) {
                        const body = inFace({ label: 'Status', message: 'ok', size }, face);
                        const [left, right] = texts(body);
                        const split = Number(attr(openings(body, 'rect')[2]!, 'rect', 'x'));
                        assert.equal(split, left!.x + left!.length + spec.pad, `${name(face)} ${size}`);
                        assert.equal(right!.x, split + spec.pad, `${name(face)} ${size}`);
                        assert.equal(
                            Number(attr(body, 'svg', 'width')),
                            right!.x + right!.length + spec.pad,
                            `${name(face)} ${size}`,
                        );
                    }
                }
            });

            test('a wider face makes a wider badge, a narrower one a narrower badge', () => {
                const width = (face: Face): number =>
                    Number(attr(inFace({ label: 'Hello World', message: 'passing' }, face), 'svg', 'width'));
                assert.ok(width({ font: 'sans', weight: 'bold' }) > width({ font: 'sans', weight: 'normal' }));
                assert.ok(width({ font: 'serif', weight: 'bold' }) > width({ font: 'serif', weight: 'normal' }));
                assert.ok(width({ font: 'serif', weight: 'normal' }) > width({ font: 'sans', weight: 'normal' }));
            });

            test('the clip id follows the width of the face, and nothing else changes in the ids', () => {
                for (const face of FACES) {
                    const body = inFace({ label: 'Hello', message: 'World', radius: 4 }, face);
                    const width = attr(body, 'svg', 'width');
                    assert.equal(attr(body, 'clipPath', 'id'), `c-${width}-20-4`, name(face));
                    assert.deepEqual(ids(body).slice(0, 2), ['g-2d333b-2d333b', 'm-0969da-0969da'], name(face));
                }
            });
        });

        describe('combined with the other options', () => {
            const options = {
                label: 'Build',
                message: 'passing',
                icon: 'check',
                trail: 'star',
                border: '#112233',
                radius: 4,
                angle: 45,
                size: 'md',
                lift: 2,
                start: '#16a34a',
                end: '#15803d',
                messageStart: '#0969da',
                messageEnd: '#1f6feb',
                ink: '#fefefe',
                messageInk: '#ffeedd',
            };

            for (const face of FACES) {
                test(`${name(face)}: geometry, ids, colors and shapes with every other option`, () => {
                    const body = inFace(options, face);
                    const spec = SIZES.md;
                    const expected = geometry('md', 'Build', 'passing', true, face);
                    const where = name(face);
                    assert.equal(attr(body, 'svg', 'width'), String(expected.width), where);
                    assert.equal(attr(body, 'svg', 'height'), String(spec.height + 4), where);
                    assert.equal(attr(body, 'svg', 'viewBox'), `0 0 ${expected.width} ${spec.height + 4}`, where);
                    assert.deepEqual(
                        texts(body).map((text) => [text.x, text.length, text.fill, text.content]),
                        [
                            [expected.labelX, expected.labelLength, '#fefefe', 'Build'],
                            [expected.messageX, expectedText('passing', spec.font, face), '#ffeedd', 'passing'],
                        ],
                        where,
                    );
                    assert.deepEqual(
                        ids(body),
                        ['g-16a34a-15803d-45', 'm-0969da-1f6feb-45', `c-${expected.width}-24-4-b`],
                        where,
                    );
                    assert.equal(points(body, 'g-16a34a-15803d-45'), '0 1 1 0', where);
                    assert.equal(points(body, 'm-0969da-1f6feb-45'), '0 1 1 0', where);
                    const rects = openings(body, 'rect');
                    assert.equal(rects.length, 4, where);
                    assert.equal(attr(rects[0]!, 'rect', 'rx'), '3.5', where);
                    assert.equal(attr(rects[3]!, 'rect', 'rx'), '3.5', where);
                    assert.equal(attr(rects[3]!, 'rect', 'stroke'), '#112233', where);
                    assert.equal(attr(rects[3]!, 'rect', 'width'), String(expected.width - 1), where);
                    assert.equal(attr(rects[2]!, 'rect', 'x'), String(expected.split), where);
                    const groups = openings(body, 'g').filter((tag) => tag.includes('transform'));
                    const top = (spec.height - spec.icon) / 2;
                    assert.deepEqual(
                        groups.map((group) => attr(group, 'g', 'transform')),
                        [
                            `translate(${spec.pad} ${top}) scale(0.5833)`,
                            `translate(${expected.trailX} ${top}) scale(0.5833)`,
                        ],
                        where,
                    );
                    assert.deepEqual(
                        groups.map((group) => attr(group, 'g', 'stroke')),
                        ['#fefefe', '#ffeedd'],
                        where,
                    );
                    assert.deepEqual([...tags(body)].sort(), [...tags(svg(options))].sort(), where);
                });
            }

            test('only the text attributes, the widths and the positions depend on the face', () => {
                const strip = (markup: string): string =>
                    markup
                        .replace(/ font-family="[^"]*" font-weight="[^"]*"/g, '')
                        .replace(/ textLength="\d+"/g, '')
                        .replace(/ x="[\d.]+"/g, ' x=""')
                        .replace(/ width="[\d.]+"/g, ' width=""')
                        .replace(/viewBox="[^"]*"/, 'viewBox=""')
                        .replace(/translate\([\d.]+ /g, 'translate(')
                        .replace(/id="c-[^"]*"|url\(#c-[^)]*\)/g, 'c')
                        .replace(/clip-path="[^"]*"/, 'clip-path=""');
                const reference = strip(svg(options));
                for (const face of FACES) assert.equal(strip(inFace(options, face)), reference, name(face));
            });

            test('a face with a border and a message keeps the stroke rect after the parts and before the text', () => {
                for (const face of FACES) {
                    const body = inFace(options, face);
                    assert.ok(body.indexOf('stroke="#112233"') < body.indexOf('<text'), name(face));
                    assert.ok(body.indexOf('stroke="#112233"') > body.indexOf('</g>'), name(face));
                }
            });

            test('square and fully rounded badges keep their radius in every face', () => {
                for (const face of FACES) {
                    assert.equal(attr(inFace({ label: 'Hi', radius: 0 }, face), 'rect', 'rx'), '0', name(face));
                    assert.equal(attr(inFace({ label: 'Hi' }, face), 'rect', 'rx'), '10', name(face));
                    assert.equal(
                        attr(inFace({ label: 'Hi', radius: 100, message: 'Yo' }, face), 'rect', 'rx'),
                        '10',
                        name(face),
                    );
                }
            });

            test('every face is deterministic', () => {
                for (const face of FACES) assert.equal(inFace(options, face), inFace(options, face), name(face));
            });

            test('the six faces give six different documents for the same badge', () => {
                const documents = FACES.map((face) => inFace({ label: 'Hello World', message: 'passing' }, face));
                // Mono regular and bold differ by the weight attribute only, so all six are still distinct
                assert.equal(new Set(documents).size, 6);
            });
        });

        describe('validation', () => {
            test('unknown fonts throw', () => {
                for (const font of [
                    'arial',
                    'monospace',
                    'bold',
                    'Verdana',
                    '12',
                    'sans-serif',
                    'sans serif',
                    ' sans',
                    'sans ',
                ]) {
                    assert.throws(() => badge({ label: 'Hi', font }), { message: fontMessage }, JSON.stringify(font));
                }
            });

            test('unknown weights throw', () => {
                for (const weight of ['light', '400', '600', '700', 'bolder', 'regular', 'sans', ' bold', 'bold ']) {
                    assert.throws(
                        () => badge({ label: 'Hi', weight }),
                        { message: weightMessage },
                        JSON.stringify(weight),
                    );
                }
            });

            test('names are case sensitive', () => {
                for (const font of ['SANS', 'Sans', 'Serif', 'MONO', 'sAnS']) {
                    assert.throws(() => badge({ label: 'Hi', font }), { message: fontMessage }, font);
                }
                for (const weight of ['BOLD', 'Bold', 'NORMAL', 'Normal']) {
                    assert.throws(() => badge({ label: 'Hi', weight }), { message: weightMessage }, weight);
                }
            });

            test('empty strings throw, they do not fall back to the default', () => {
                assert.throws(() => badge({ label: 'Hi', font: '' }), { message: fontMessage });
                assert.throws(() => badge({ label: 'Hi', weight: '' }), { message: weightMessage });
            });

            test('prototype property names are rejected', () => {
                for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
                    assert.throws(() => badge({ label: 'Hi', font: name }), { message: fontMessage }, name);
                    assert.throws(() => badge({ label: 'Hi', weight: name }), { message: weightMessage }, name);
                }
            });

            test('non-string values throw', () => {
                for (const value of [12, 0, true, false, {}, [], ['sans'], ['bold'], NaN, () => 'sans']) {
                    assert.throws(
                        () => badge({ label: 'Hi', font: value } as never),
                        { message: fontMessage },
                        String(value),
                    );
                    assert.throws(
                        () => badge({ label: 'Hi', weight: value } as never),
                        { message: weightMessage },
                        String(value),
                    );
                }
            });

            test('a font value cannot be a weight and the other way round', () => {
                assert.throws(() => badge({ label: 'Hi', font: 'bold' }), { message: fontMessage });
                assert.throws(() => badge({ label: 'Hi', weight: 'mono' }), { message: weightMessage });
            });

            test('injection attempts are rejected before anything is drawn', () => {
                const payloads = [
                    'sans"><script>alert(1)</script>',
                    'sans" onload="alert(1)',
                    '" onload="alert(1)',
                    'sans;fill:red',
                    'sans,serif',
                    "sans'><img src=x onerror=alert(1)>",
                    '</text><rect onload="x"/>',
                    'bold"><script>',
                    'normal" font-size="99',
                    '{{7*7}}',
                    'javascript:alert(1)',
                    'sans\n',
                    'sans\u0000',
                ];
                for (const payload of payloads) {
                    assert.throws(() => badge({ label: 'Hi', font: payload }), { message: fontMessage }, payload);
                    assert.throws(() => badge({ label: 'Hi', weight: payload }), { message: weightMessage }, payload);
                    assert.throws(
                        () => badge({ label: 'Hi', message: 'Yo', font: payload, weight: payload }),
                        { message: fontMessage },
                        payload,
                    );
                }
            });

            test('an accepted face never lets a character other than the stack into the attributes', () => {
                for (const face of FACES) {
                    const body = inFace({ label: '<b>', message: '"x"' }, face);
                    assert.ok(!body.includes('<b>'), name(face));
                    assert.ok(!/font-family="[^"]*[<>&'][^"]*"/.test(body), name(face));
                    assert.match(attr(body, 'text', 'font-family'), /^[A-Za-z ,-]+$/, name(face));
                    assert.match(attr(body, 'text', 'font-weight'), /^(400|600)$/, name(face));
                }
            });

            test('an invalid font or weight is refused whatever the other options are', () => {
                const rich = {
                    label: 'Hi',
                    message: 'Yo',
                    icon: 'check',
                    trail: 'star',
                    border: '#fff',
                    radius: 3,
                    angle: 20,
                };
                assert.throws(() => badge({ ...rich, font: 'nope' }), { message: fontMessage });
                assert.throws(() => badge({ ...rich, weight: 'nope' }), { message: weightMessage });
                assert.throws(() => badge({ ...rich, font: 'nope', weight: 'nope' }), { message: fontMessage });
            });

            test('the font is checked after the size and the colors, before the weight, lift, radius and angle', () => {
                assert.throws(() => badge({ label: 'Hi', size: 'huge', font: 'nope' }), /Invalid size/);
                assert.throws(() => badge({ label: 'Hi', start: 'nope', font: 'nope' }), /Invalid start color/);
                assert.throws(() => badge({ label: 'Hi', icon: 'nope', font: 'nope' }), /Unknown icon/);
                assert.throws(() => badge({ label: '', font: 'nope' }), /Please provide a label/);
                assert.throws(() => badge({ label: 'Hi', message: 'a\nb', font: 'nope' }), /Message cannot contain/);
                assert.throws(() => badge({ label: 'Hi', font: 'nope', weight: 'nope' }), { message: fontMessage });
                assert.throws(() => badge({ label: 'Hi', weight: 'nope', lift: 99 }), { message: weightMessage });
                assert.throws(() => badge({ label: 'Hi', font: 'nope', radius: 999 }), { message: fontMessage });
                assert.throws(() => badge({ label: 'Hi', font: 'nope', angle: 999 }), { message: fontMessage });
            });

            test('a valid font does not hide a bad weight', () => {
                for (const font of FONTS) {
                    assert.throws(
                        () => badge({ label: 'Hi', font, weight: 'light' }),
                        { message: weightMessage },
                        font,
                    );
                }
                for (const weight of WEIGHTS) {
                    assert.throws(
                        () => badge({ label: 'Hi', weight, font: 'arial' }),
                        { message: fontMessage },
                        weight,
                    );
                }
            });
        });
    });

    describe('width tables', () => {
        const ALL: [string, WidthRanges][] = [
            ['SANS_REGULAR', SANS_REGULAR],
            ['SANS_BOLD', SANS_BOLD],
            ['SERIF_REGULAR', SERIF_REGULAR],
            ['SERIF_BOLD', SERIF_BOLD],
        ];

        /**
         * Flattens a width table into a map by code point.
         *
         * @param ranges - Width table
         * @returns The widths by code point
         */
        function flat(ranges: WidthRanges): Map<number, number> {
            const widths = new Map<number, number>();
            for (const [first, list] of ranges) list.forEach((width, offset) => widths.set(first + offset, width));
            return widths;
        }

        test('the em is 2048 units, the fallback a full em and the monospace advance 1233', () => {
            assert.equal(UNITS_PER_EM, 2048);
            assert.equal(FALLBACK_WIDTH, 2048);
            assert.equal(MONO_ADVANCE, 1233);
        });

        test('every table covers exactly the code points of the sans bold one', () => {
            const reference = [...flat(SANS_BOLD).keys()];
            assert.ok(reference.length > 1200);
            for (const [key, ranges] of ALL) {
                assert.deepEqual([...flat(ranges).keys()], reference, key);
            }
        });

        test('the ranges are well formed: not empty, ascending and without overlap', () => {
            for (const [key, ranges] of ALL) {
                let next = -1;
                for (const [first, list] of ranges) {
                    assert.ok(Number.isInteger(first) && first >= 0, `${key} ${first}`);
                    assert.ok(list.length > 0, `${key} ${first}`);
                    assert.ok(first > next, `${key} ${first} starts after the previous range`);
                    next = first + list.length - 1;
                    assert.ok(next <= 0x10ffff, key);
                }
            }
        });

        test('every width is a non-negative integer within two em', () => {
            for (const [key, ranges] of ALL) {
                for (const [code, width] of flat(ranges)) {
                    assert.ok(Number.isInteger(width), `${key} U+${code.toString(16)}`);
                    assert.ok(width >= 0 && width <= 2 * UNITS_PER_EM, `${key} U+${code.toString(16)} is ${width}`);
                }
            }
        });

        test('the soft hyphen and the common combining marks have no width in all four tables', () => {
            for (const [key, ranges] of ALL) {
                const widths = flat(ranges);
                assert.equal(widths.get(0xad), 0, `${key} soft hyphen`);
                // Grave, acute, circumflex, tilde, diaeresis and dot below, zero in the hmtx of the four fonts
                for (const code of [0x300, 0x301, 0x302, 0x303, 0x308, 0x323]) {
                    assert.equal(widths.get(code), 0, `${key} U+${code.toString(16)}`);
                }
            }
        });

        test('every combining mark has no width in all four tables, even the ones a font lacks', () => {
            for (const [key, ranges] of ALL) {
                const widths = flat(ranges);
                for (let code = 0x300; code <= 0x36f; code++)
                    assert.equal(widths.get(code), 0, `${key} U+${code.toString(16)}`);
                for (let code = 0x483; code <= 0x487; code++)
                    assert.equal(widths.get(code), 0, `${key} U+${code.toString(16)}`);
            }
        });

        test('the faces have their known advances for a, W, i, space and the accented, Cyrillic and Greek anchors', () => {
            // hmtx advances read from DejaVuSans, DejaVuSans-Bold, DejaVuSerif and DejaVuSerif-Bold
            const expected: Record<string, number[]> = {
                //            a     W     i    space  é     П     α     €     →
                SANS_REGULAR: [1255, 2025, 569, 651, 1260, 1540, 1350, 1303, 1716],
                SANS_BOLD: [1382, 2259, 702, 713, 1389, 1714, 1407, 1425, 1716],
                SERIF_REGULAR: [1221, 2105, 655, 651, 1212, 1786, 1383, 1303, 1716],
                SERIF_BOLD: [1327, 2300, 778, 713, 1303, 1934, 1576, 1425, 1716],
            };
            const codes = [0x61, 0x57, 0x69, 0x20, 0xe9, 0x41f, 0x3b1, 0x20ac, 0x2192];
            for (const [key, ranges] of ALL) {
                assert.deepEqual(
                    codes.map((code) => tableWidth(code, ranges)),
                    expected[key],
                    key,
                );
            }
        });

        test('a space is narrower than a W, and an i narrower than a W, in every table', () => {
            for (const [key, ranges] of ALL) {
                const space = tableWidth(0x20, ranges)!;
                const i = tableWidth(0x69, ranges)!;
                const w = tableWidth(0x57, ranges)!;
                assert.ok(space < w, key);
                assert.ok(i < w, key);
                assert.ok(w < UNITS_PER_EM + UNITS_PER_EM / 4, key);
            }
        });

        test('accented letters have the advance of their base letter in the sans faces', () => {
            for (const ranges of [SANS_REGULAR, SANS_BOLD]) {
                assert.equal(tableWidth(0xe9, ranges), tableWidth(0x65, ranges));
                assert.equal(tableWidth(0xe0, ranges), tableWidth(0x61, ranges));
            }
        });

        test('bold is wider than regular over printable ASCII in both families', () => {
            const total = (ranges: WidthRanges): number => {
                let sum = 0;
                for (let code = 0x20; code <= 0x7e; code++) sum += tableWidth(code, ranges)!;
                return sum;
            };
            assert.ok(total(SANS_BOLD) > total(SANS_REGULAR));
            assert.ok(total(SERIF_BOLD) > total(SERIF_REGULAR));
            // Sums of the hmtx advances of U+0020 to U+007E
            assert.equal(total(SANS_REGULAR), 116178);
            assert.equal(total(SANS_BOLD), 128237);
            assert.equal(total(SERIF_REGULAR), 120452);
            assert.equal(total(SERIF_BOLD), 129778);
        });

        test('the tables of the four faces are four different tables', () => {
            const dump = ALL.map(([, ranges]) => JSON.stringify(ranges));
            assert.equal(new Set(dump).size, 4);
        });

        test('the monospace advance is the one of the DejaVu Sans Mono hmtx for every table character', () => {
            // Read from DejaVuSansMono.ttf and DejaVuSansMono-Bold.ttf: a, W, i, space, é, П, α all advance 1233
            for (const code of [0x61, 0x57, 0x69, 0x20, 0xe9, 0x41f, 0x3b1]) {
                assert.ok(tableWidth(code) !== undefined, `U+${code.toString(16)} is in the tables`);
                assert.equal(faceWidth(code, { font: 'mono', weight: 'normal' }), 1233);
                assert.equal(faceWidth(code, { font: 'mono', weight: 'bold' }), 1233);
            }
        });
    });

    describe('parity with the original tool', () => {
        test('Nouveau at xs with an icon is 76 wide', () => {
            const body = svg({
                label: 'Nouveau',
                icon: 'sparkles',
                start: '#16a34a',
                end: '#15803d',
                size: 'xs',
                lift: 1,
            });
            assert.equal(attr(body, 'svg', 'width'), '76');
            assert.equal(attr(body, 'svg', 'height'), '18');
            assert.equal(attr(body, 'svg', 'viewBox'), '0 0 76 18');
            assert.equal(textLength(body), 50);
            assert.equal(attr(body, 'text', 'x'), '20');
            assert.equal(attr(body, 'text', 'y'), '11.6');
            assert.ok(body.includes('translate(6 3) scale(0.4167)'));
        });

        test('Mis a jour at xs with an icon is 81 wide', () => {
            const body = svg({ label: 'Mis à jour', icon: 'sparkles', size: 'xs' });
            assert.equal(attr(body, 'svg', 'width'), '81');
            assert.equal(attr(body, 'svg', 'height'), '16');
            assert.equal(textLength(body), 55);
        });
    });
});
