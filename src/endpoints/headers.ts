import { define } from './define.js';

// Headers whose value is never echoed back
const REDACTED = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);

export default define({
    name: 'headers',
    method: 'get',
    path: '/headers',
    category: 'network',
    params: {
        filter: { type: 'string' },
    },
    example: { filter: 'accept,user-agent' },
    run: ({ filter: filterParam }, req) => {
        let headers: Record<string, unknown> = {};

        for (const [k, v] of Object.entries(req.headers)) {
            headers[k] = REDACTED.has(k) ? '[redacted]' : v;
        }

        const filter = Array.isArray(filterParam) ? filterParam.join(',') : (filterParam as string | undefined);
        if (filter) {
            const keys = new Set(filter.split(',').map((k) => k.trim().toLowerCase()));
            headers = Object.fromEntries(Object.entries(headers).filter(([k]) => keys.has(k)));
        }

        return {
            count: Object.keys(headers).length,
            headers,
            ip: req.ip,
            method: req.method,
            url: req.originalUrl,
        };
    },
});
