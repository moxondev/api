import { api, define } from './define.js';

export default define({
    name: 'color',
    method: 'get',
    path: '/color',
    category: 'images',
    params: {
        hex: { type: 'string' },
    },
    example: { hex: '#ff6600' },
    run: ({ hex }, req) => api(req).color((hex as string | undefined) || undefined),
});
