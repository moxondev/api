import { api, define } from './define.js';

export default define({
    name: 'personal',
    method: 'get',
    path: '/personal',
    category: 'fakeData',
    params: {},
    example: {},
    run: (_values, req) => api(req).personal(),
});
