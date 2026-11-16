import { api, define } from './define.js';

type Encoders = Record<string, (value: string, shift?: string) => string>;

export default define({
    name: 'encode',
    method: 'get',
    path: '/encode',
    category: 'text',
    params: {
        method: {
            required: true,
            type: 'string',
            options: [
                'base64encode',
                'base64decode',
                'urlencode',
                'urldecode',
                'binary',
                'unbinary',
                'morse',
                'unmorse',
                'caesar',
                'rot13',
            ],
            missing: 'Please provide a valid method (?method={method})',
        },
        text: { type: 'string' },
        shift: { type: 'number' },
    },
    example: { method: 'base64encode', text: 'hello' },
    run: ({ method, text, shift }, req) => {
        const encode = api(req).encode as unknown as Encoders;
        if (!method || !Object.hasOwn(encode, method as string))
            throw new Error('Please provide a valid method (?method={method})');
        const result = encode[method as string]!(text as string, shift as string);
        return { method, result };
    },
});
