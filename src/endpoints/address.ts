import { api, define } from './define.js';

export default define({
    name: 'address',
    method: 'get',
    path: '/address',
    category: 'fakeData',
    params: {
        country: { type: 'string', options: ['fr', 'us', 'uk', 'de', 'es'], default: 'random' },
        count: { type: 'integer', default: '1' },
    },
    example: { country: 'fr', count: '2' },
    run: ({ country, count }, req) => {
        const parsed = count !== undefined ? parseInt(count as string, 10) : 1;
        if (isNaN(parsed)) throw new Error('Please provide a valid count (&count={n})');
        return api(req).address(country as string | undefined, parsed);
    },
});
