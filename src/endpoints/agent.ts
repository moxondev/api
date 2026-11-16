import { api, define } from './define.js';

// Without a ua parameter the User-Agent header of the caller is parsed, and an empty one is refused by the module
export default define({
    name: 'agent',
    method: 'get',
    path: '/agent',
    category: 'network',
    params: {
        ua: { type: 'string' },
    },
    example: {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    run: ({ ua }, req) =>
        api(req).agent(((ua as string | undefined) ?? (req.headers['user-agent'] as string) ?? '') as string),
});
