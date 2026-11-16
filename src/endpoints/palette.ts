import { api, define } from './define.js';

export default define({
    name: 'palette',
    method: 'get',
    path: '/palette',
    category: 'images',
    params: {
        color: { required: true, type: 'string', missing: 'Please provide a base color (?color=#ff6600)' },
        type: {
            required: true,
            type: 'string',
            missing: 'Please provide a palette type (&type=complementary)',
        },
    },
    example: { color: '#ff6600', type: 'complementary' },
    run: ({ color, type }, req) => api(req).palette(color as string, type as string),
});
