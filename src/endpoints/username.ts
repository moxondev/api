import { api, define } from './define.js';

export default define({
    name: 'username',
    method: 'get',
    path: '/username',
    category: 'fakeData',
    params: {},
    example: {},
    run: (_values, req) => api(req).username(),
});
