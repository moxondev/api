import { api, define } from './define.js';

export default define({
    name: 'statistics',
    method: 'get',
    path: '/statistics',
    category: 'compute',
    params: {
        values: { required: true, type: 'string', missing: 'Please provide a list of values (?values=1,2,3)' },
    },
    example: { values: '1,2,3,4,5,5' },
    run: ({ values }, req) => api(req).statistics(values as string),
});
