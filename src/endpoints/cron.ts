import { api, define } from './define.js';

export default define({
    name: 'cron',
    method: 'get',
    path: '/cron',
    category: 'compute',
    params: {
        expr: { required: true, type: 'string', missing: 'Please provide a cron expression (?expr=* * * * *)' },
        count: { type: 'integer', default: '5' },
        from: { type: 'string' },
        timezone: { type: 'string', default: 'UTC' },
    },
    example: { expr: '*/15 * * * *', count: '3', from: '2026-01-01T00:00:00Z' },
    run: ({ expr, count, from, timezone }, req) => {
        const parsedCount = count !== undefined ? parseInt(count as string, 10) : 5;
        if (isNaN(parsedCount)) throw new Error('Please provide a valid count (&count={n})');
        return api(req).cron(expr as string, parsedCount, from as string | undefined, (timezone as string) ?? 'UTC');
    },
});
