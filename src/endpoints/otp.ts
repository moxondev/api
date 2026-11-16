import { api, define } from './define.js';

export default define({
    name: 'otp',
    method: 'post',
    path: '/otp',
    category: 'security',
    since: 5,
    params: {
        action: {
            required: true,
            type: 'string',
            options: ['secret', 'generate', 'verify'],
            missing: 'Please provide an action (?action=secret|generate|verify)',
        },
        secret: { type: 'string' },
        code: { type: 'string' },
        algorithm: { type: 'string', options: ['sha1', 'sha256', 'sha512'], default: 'sha1' },
        digits: { type: 'integer', options: ['6', '8'], default: '6' },
        period: { type: 'integer', options: ['15', '30', '60'], default: '30' },
        counter: { type: 'integer' },
        label: { type: 'string', default: 'user' },
        issuer: { type: 'string', default: 'API' },
    },
    example: { action: 'secret' },
    run: ({ action, secret, code, algorithm, digits, period, counter, label, issuer }, req) =>
        api(req).otp(action as string, {
            secret: secret as string | undefined,
            code: code as string | undefined,
            algorithm: algorithm as string | undefined,
            digits: digits !== undefined ? Number(digits) : undefined,
            period: period !== undefined ? Number(period) : undefined,
            counter: counter !== undefined ? Number(counter) : undefined,
            label: label as string | undefined,
            issuer: issuer as string | undefined,
        }),
});
