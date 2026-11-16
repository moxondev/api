import { api, define } from './define.js';

// Without an address parameter the caller is analysed
export default define({
    name: 'ip',
    method: 'get',
    path: '/ip',
    category: 'network',
    params: {
        address: { type: 'string' },
    },
    example: { address: '8.8.8.8' },
    run: ({ address }, req) => api(req).ip(((address as string | undefined) ?? req.ip ?? '') as string),
});
