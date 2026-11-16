import { api, define } from './define.js';

// The checks stay in run: a value that is not a string names its own parameter before the next one is looked at
export default define({
    name: 'diff',
    method: 'post',
    path: '/diff',
    category: 'text',
    since: 5,
    params: {
        a: { type: 'string' },
        b: { type: 'string' },
        mode: { type: 'string', options: ['line', 'word'], default: 'line' },
    },
    example: { a: 'one\ntwo\nthree', b: 'one\n2\nthree', mode: 'line' },
    run: ({ a, b, mode }, req) => {
        if (typeof a !== 'string') throw new Error('Please provide a first text (a={text})');
        if (typeof b !== 'string') throw new Error('Please provide a second text (b={text})');
        return api(req).diff(a, b, mode as string | undefined);
    },
});
