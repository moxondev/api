import { api, define } from './define.js';

// POST flavour from v6, the checks stay in run to keep their order
export default define({
    name: 'levenshtein',
    method: 'post',
    path: '/levenshtein',
    category: 'text',
    since: 6,
    params: {
        str1: { type: 'string' },
        str2: { type: 'string' },
    },
    example: { str1: 'kitten', str2: 'sitting' },
    run: ({ str1, str2 }, req) => {
        if (!str1 || typeof str1 !== 'string') throw new Error('Please provide a first string (str1={string})');
        if (!str2 || typeof str2 !== 'string') throw new Error('Please provide a second string (str2={string})');
        return api(req).levenshtein(str1, str2);
    },
});

// Query string flavour of the same endpoint, served until v5
export const legacy = define({
    name: 'levenshtein',
    method: 'get',
    path: '/levenshtein',
    category: 'text',
    until: 5,
    params: {
        str1: { type: 'string' },
        str2: { type: 'string' },
    },
    example: { str1: 'kitten', str2: 'sitting' },
    run: ({ str1, str2 }, req) => {
        if (!str1 || typeof str1 !== 'string') throw new Error('Please provide a first string (?str1={string})');
        if (!str2 || typeof str2 !== 'string') throw new Error('Please provide a second string (&str2={string})');
        return api(req).levenshtein(str1, str2);
    },
});
