import { api, define } from './define.js';

export default define({
    name: 'dice',
    method: 'get',
    path: '/dice',
    category: 'fakeData',
    params: {
        roll: { required: true, type: 'string', missing: 'Please provide a roll notation (?roll=2d6+3)' },
    },
    example: { roll: '2d6+3' },
    run: ({ roll }, req) => api(req).dice(roll as string),
});
