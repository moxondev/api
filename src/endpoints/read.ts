import { api, define } from './define.js';

export default define({
    name: 'read',
    method: 'post',
    path: '/read',
    category: 'text',
    since: 5,
    params: {
        text: { required: true, type: 'string', missing: 'Please provide a text' },
        lang: { type: 'string', options: ['en', 'fr'], default: 'en' },
    },
    example: { text: 'The cat sat on the mat. It was a sunny day.', lang: 'en' },
    run: ({ text, lang }, req) => {
        if (!text || typeof text !== 'string') throw new Error('Please provide a text');
        return api(req).read(text, lang as string | undefined);
    },
});
