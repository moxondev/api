import { api, define } from './define.js';

export default define({
    name: 'asymmetric',
    method: 'post',
    path: '/asymmetric',
    category: 'security',
    since: 5,
    params: {
        action: {
            required: true,
            type: 'string',
            options: ['keygen', 'encrypt', 'decrypt'],
            missing: 'Please provide an action (?action=keygen|encrypt|decrypt)',
        },
        text: { type: 'string' },
        publicKey: { type: 'string' },
        privateKey: { type: 'string' },
        modulusLength: { type: 'integer', default: '2048' },
        algorithm: { type: 'string', default: 'rsa-oaep-sha256' },
    },
    example: { action: 'keygen' },

    // The async variant keeps the RSA key generation off the event loop
    run: ({ action, text, publicKey, privateKey, modulusLength, algorithm }, req) =>
        api(req).asymmetricAsync(action as string, {
            text: text as string | undefined,
            publicKey: publicKey as string | undefined,
            privateKey: privateKey as string | undefined,
            modulusLength: modulusLength !== undefined ? Number(modulusLength) : undefined,
            algorithm: algorithm as string | undefined,
        }),
});
