import { api, define } from './define.js';

export default define({
    name: 'base',
    method: 'get',
    path: '/base',
    category: 'text',
    since: 5,
    params: {
        value: { required: true, type: 'string', missing: 'Please provide a value (?value={value})' },
        from: { type: 'integer', default: '10' },
        to: { type: 'integer', default: '16' },
    },
    example: { value: '255', from: '10', to: '16' },
    run: ({ value, from, to }, req) => {
        if (!value || typeof value !== 'string') throw new Error('Please provide a value (?value={value})');
        return api(req).base(
            value,
            from !== undefined ? Number(from) : undefined,
            to !== undefined ? Number(to) : undefined,
        );
    },
});
