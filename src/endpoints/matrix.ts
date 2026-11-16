import { api, define } from './define.js';

type Operations = Record<string, (...args: unknown[]) => unknown>;

export default define({
    name: 'matrix',
    method: 'post',
    path: '/matrix',
    category: 'compute',
    since: 5,
    params: {
        operation: {
            type: 'string',
            options: ['add', 'subtract', 'multiply', 'scalar', 'transpose', 'determinant', 'inverse', 'identity'],
        },
        matrix: { type: 'array' },
        matrix2: { type: 'array' },
        scalar: { type: 'number' },
    },
    example: {
        operation: 'multiply',
        matrix: [
            [1, 2],
            [3, 4],
        ],
        matrix2: [
            [5, 6],
            [7, 8],
        ],
    },
    run: ({ operation, matrix, matrix2, scalar }, req) => {
        const operations = api(req).matrix as unknown as Operations;
        if (!operation || typeof operation !== 'string' || !Object.hasOwn(operations, operation))
            throw new Error(
                'Please provide a valid operation (?operation=add|subtract|multiply|scalar|transpose|determinant|inverse|identity)',
            );

        switch (operation) {
            case 'add':
            case 'subtract':
            case 'multiply':
                return operations[operation]!(matrix, matrix2);
            case 'scalar':
                return operations.scalar!(matrix, scalar);
            case 'transpose':
            case 'determinant':
            case 'inverse':
                return operations[operation]!(matrix);
            case 'identity':
                return operations.identity!(scalar);
            default:
                throw new Error('Unknown operation');
        }
    },
});
