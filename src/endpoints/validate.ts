import { api, define } from './define.js';

type Validators = Record<string, (value: string) => unknown>;

// The type is checked before the value, so neither carries a required flag
export default define({
    name: 'validate',
    method: 'get',
    path: '/validate',
    category: 'compute',
    params: {
        type: { type: 'string', options: ['luhn', 'iban', 'email'] },
        value: { type: 'string' },
    },
    example: { type: 'email', value: 'hello@example.com' },
    run: ({ type, value }, req) => {
        const validate = api(req).validate as unknown as Validators;
        if (!type || !Object.hasOwn(validate, type as string))
            throw new Error('Please provide a valid type (?type={luhn|iban|email})');
        if (!value) throw new Error('Please provide a value (&value={value})');
        return validate[type as string]!(value as string);
    },
});
