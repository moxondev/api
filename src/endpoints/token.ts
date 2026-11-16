import { MAX_TOKEN_LENGTH, MIN_TOKEN_LENGTH } from '../constants.js';
import { api, define } from './define.js';

// The length is checked here, with its own messages, before the module is called: nothing is required
export default define({
    name: 'token',
    method: 'post',
    path: '/token',
    category: 'security',
    params: {
        len: { type: 'integer', default: '24' },
        type: {
            type: 'string',
            options: ['alpha', 'alphanum', 'base64', 'hex', 'num', 'punct', 'urlsafe', 'uuid'],
            default: 'alpha',
        },
    },
    example: { len: 24, type: 'hex' },
    run: ({ len, type }, req) => {
        const length = parseInt(String(len ?? 24), 10);
        const kind = type ? String(type).toLowerCase() : 'alpha';

        if (isNaN(length) || length < 0) throw new Error('Invalid number.');
        if (length > MAX_TOKEN_LENGTH) throw new Error('Length cannot exceed 4096.');
        if (length < MIN_TOKEN_LENGTH) throw new Error('Length cannot be less than 12.');

        return { token: api(req).token(length, kind) };
    },
});
