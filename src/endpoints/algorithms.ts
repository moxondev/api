import { api, define } from './define.js';

type Algorithm = (value: string, value2?: string) => unknown;

export default define({
    name: 'algorithms',
    method: 'get',
    path: '/algorithms',
    category: 'compute',
    params: {
        method: {
            type: 'string',
            options: [
                'anagram',
                'bubblesort',
                'factorial',
                'fibonacci',
                'gcd',
                'isprime',
                'palindrome',
                'primefactors',
                'primelist',
                'reverse',
                'roman',
            ],
        },
        value: { type: 'string' },
        value2: { type: 'string' },
    },
    example: { method: 'gcd', value: '48', value2: '18' },
    run: ({ method, value, value2 }, req) => {
        const algorithms = api(req).algorithms as unknown as Record<string, Algorithm>;
        if (!method || !Object.hasOwn(algorithms, method as string))
            throw new Error('Please provide a valid algorithm (?method={algorithm})');
        return { answer: algorithms[method as string]!(value as string, value2 as string) };
    },
});
