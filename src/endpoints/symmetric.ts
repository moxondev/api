import { api, define } from './define.js';

export default define({
    name: 'symmetric',
    method: 'post',
    path: '/symmetric',
    category: 'security',
    since: 5,
    params: {
        action: {
            required: true,
            type: 'string',
            options: ['encrypt', 'decrypt'],
            missing: 'Please provide an action (?action=encrypt|decrypt)',
        },
        text: { required: true, type: 'string', missing: 'Please provide a text (&text={text})' },
        key: { required: true, type: 'string', missing: 'Please provide a key (&key={key})' },
        algorithm: {
            type: 'string',
            options: ['aes-256-gcm', 'aes-256-cbc', 'aes-128-gcm'],
            default: 'aes-256-gcm',
        },
    },
    example: { action: 'encrypt', text: 'hello', key: 'correct horse' },
    run: ({ action, text, key, algorithm }, req) =>
        api(req).symmetric(action as string, text as string, key as string, algorithm as string | undefined),
});
