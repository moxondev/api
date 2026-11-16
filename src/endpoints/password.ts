import { api, define } from './define.js';

// Nothing is required: every parameter has a default, and a value that does not parse reaches the module as NaN
export default define({
    name: 'password',
    method: 'get',
    path: '/password',
    category: 'security',
    params: {
        type: { type: 'string', options: ['random', 'passphrase'], default: 'random' },
        length: { type: 'integer', default: '16' },
        uppercase: { type: 'boolean', default: 'true' },
        lowercase: { type: 'boolean', default: 'true' },
        digits: { type: 'boolean', default: 'true' },
        symbols: { type: 'boolean', default: 'false' },
        exclude: { type: 'string' },
        count: { type: 'integer', default: '1' },
        separator: { type: 'string', default: '-' },
    },
    example: { type: 'random', length: '16' },
    run: ({ type, length, uppercase, lowercase, digits, symbols, exclude, count, separator }, req) => {
        // Only the exact string "false" turns a flag off
        const flag = (value: unknown, fallback: boolean): boolean =>
            value === undefined ? fallback : value !== 'false';

        return api(req).password(
            (type as string) ?? 'random',
            length !== undefined ? parseInt(length as string, 10) : 16,
            {
                uppercase: flag(uppercase, true),
                lowercase: flag(lowercase, true),
                digits: flag(digits, true),
                symbols: flag(symbols, false),
                exclude: (exclude as string) ?? '',
                count: count !== undefined ? parseInt(count as string, 10) : 1,
                separator: (separator as string) ?? '-',
            },
        );
    },
});
