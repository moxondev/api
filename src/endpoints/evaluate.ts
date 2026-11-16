import { api, define } from './define.js';

export default define({
    name: 'evaluate',
    method: 'get',
    path: '/evaluate',
    category: 'compute',
    since: 5,
    params: {
        expr: { type: 'string' },
        precision: { type: 'integer', default: '10' },
    },
    example: { expr: '2 * (3 + 4)', precision: '2' },
    run: ({ expr, precision }, req) => {
        if (!expr || typeof expr !== 'string') throw new Error('Please provide a math expression (?expr={expression})');
        return api(req).evaluate(expr, precision !== undefined ? parseInt(precision as string, 10) : undefined);
    },
});
