import { api, define } from './define.js';

type Methods = Record<string, (...args: string[]) => unknown>;

export default define({
    name: 'text',
    method: 'get',
    path: '/text',
    category: 'text',
    params: {
        method: {
            required: true,
            type: 'string',
            options: ['slug', 'stats', 'lorem', 'number'],
            missing: 'Please provide a valid method (?method={slug|stats|lorem|number})',
        },
        value: { type: 'string' },
        text: { type: 'string' },
        type: { type: 'string', options: ['words', 'sentences', 'paragraphs'], default: 'words' },
        count: { type: 'number', default: '5' },
        lang: { type: 'string', options: ['en', 'fr'], default: 'en' },
    },
    example: { method: 'slug', value: 'Hello Big World' },
    run: ({ method, value, text, type, count, lang }, req) => {
        const textMod = api(req).text as unknown as Methods;
        if (!method || !Object.hasOwn(textMod, method as string))
            throw new Error('Please provide a valid method (?method={slug|stats|lorem|number})');

        let result: unknown;
        switch (method) {
            case 'slug':
            case 'stats':
                result = textMod[method as string]!((value ?? text) as string);
                break;
            case 'lorem':
                result = textMod.lorem!((type as string) || 'words', (count as string) || '5');
                break;
            case 'number':
                result = textMod.number!(value as string, (lang as string) || 'en');
                break;
            default:
                throw new Error('Unknown method');
        }
        return { method, result };
    },
});
