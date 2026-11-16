import { api, define } from './define.js';

// The value is checked before the units, so none of the three carries a required flag
export default define({
    name: 'convert',
    method: 'get',
    path: '/convert',
    category: 'compute',
    params: {
        value: { type: 'number' },
        from: { type: 'string' },
        to: { type: 'string' },
    },
    example: { value: '100', from: 'km', to: 'mi' },
    run: ({ value, from, to }, req) => {
        if (!value || isNaN(Number(value))) throw new Error('Please provide a valid value (?value={value})');
        if (!from) throw new Error('Please provide a valid source unit (&from={unit})');
        if (!to) throw new Error('Please provide a valid target unit (&to={unit})');
        return api(req).convert(Number(value), from as string, to as string);
    },
});
