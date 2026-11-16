import { api, define } from './define.js';

export default define({
    name: 'case',
    method: 'get',
    path: '/case',
    category: 'text',
    since: 5,
    params: {
        text: { required: true, type: 'string', missing: 'Please provide a text (?text={text})' },
        to: {
            type: 'string',
            options: ['camel', 'pascal', 'snake', 'kebab', 'constant', 'title', 'sentence', 'upper', 'lower'],
            default: 'camel',
        },
    },
    example: { text: 'hello big world', to: 'snake' },
    run: ({ text, to }, req) => {
        if (!text || typeof text !== 'string') throw new Error('Please provide a text (?text={text})');
        return api(req).caseConvert(text, to as string | undefined);
    },
});
