import { api, define } from './define.js';

export default define({
    name: 'hash',
    method: 'post',
    path: '/hash',
    category: 'security',
    params: {
        text: { required: true, type: 'string', missing: 'Please provide a text (?text={text})' },
        method: {
            required: true,
            type: 'string',
            missing: 'Please provide a valid hash algorithm (&method={algorithm})',
        },
        encoding: { type: 'string', options: ['hex', 'base64'], default: 'hex' },
    },
    example: { text: 'hello', method: 'sha256' },
    run: ({ text, method, encoding }, req) =>
        api(req).hash(text as string, method as string, encoding as string | undefined),
});
