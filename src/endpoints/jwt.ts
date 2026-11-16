import { api, define } from './define.js';

export default define({
    name: 'jwt',
    method: 'post',
    path: '/jwt',
    category: 'security',
    since: 5,
    params: {
        token: { required: true, type: 'string', missing: 'Please provide a token (?token={token})' },
    },
    example: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.c2lnbmF0dXJl',
    },
    run: ({ token }, req) => api(req).jwt(token as string),
});
