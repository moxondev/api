import { api, define } from './define.js';

// Issues the challenge only: the verification of a solved one stays a hand-written POST route
export default define({
    name: 'pow',
    method: 'get',
    path: '/pow',
    category: 'security',
    since: 5,
    params: {
        difficulty: { type: 'integer', default: '4' },
    },
    example: { difficulty: '2' },
    run: ({ difficulty }, req) => api(req).pow(difficulty !== undefined ? Number(difficulty) : undefined),
});
