import { api, define } from './define.js';

export default define({
    name: 'domain',
    method: 'get',
    path: '/domain',
    category: 'network',
    params: {},
    example: {},
    run: (_values, req) => api(req).domain(),
});
