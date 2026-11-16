import { api, define } from './define.js';

export default define({
    name: 'regex',
    method: 'get',
    path: '/regex',
    category: 'text',
    params: {
        pattern: { required: true, type: 'string', missing: 'Please provide a pattern (?pattern={regex})' },
        text: { required: true, type: 'string', missing: 'Please provide a text (&text={string})' },
        flags: { type: 'string', default: 'g' },
    },
    example: { pattern: '\\d+', text: 'a1b22c333', flags: 'g' },
    run: ({ pattern, text, flags }, req) =>
        api(req).regex(pattern as string, text as string, flags as string | undefined),
});
