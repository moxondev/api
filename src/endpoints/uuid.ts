import { api, define } from './define.js';

export default define({
    name: 'uuid',
    method: 'get',
    path: '/uuid',
    category: 'fakeData',
    since: 5,
    params: {
        uuid: { type: 'string' },
        count: { type: 'integer', default: '1' },
    },
    example: { count: '3' },
    run: ({ uuid, count }, req) => {
        if (uuid !== undefined && typeof uuid !== 'string')
            throw new Error('Please provide a valid UUID (?uuid={uuid})');
        return api(req).uuid(uuid, count !== undefined ? Number(count) : undefined);
    },
});
