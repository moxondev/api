import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { endpoints } from '../../src/endpoints/index.js';
import { manifest } from '../../src/manifest.js';

describe('manifest', () => {
    test('describes every declared endpoint', () => {
        assert.deepEqual(
            manifest.map((e) => e.name),
            endpoints.map((e) => e.name),
        );
    });

    test('carries no function', () => {
        for (const entry of manifest) {
            assert.ok(!('run' in entry), `${entry.name} leaks its run function`);
        }
    });

    test('runs every example to a real result', async () => {
        for (const endpoint of endpoints) {
            const values = Object.fromEntries(Object.keys(endpoint.params).map((k) => [k, undefined]));
            const result = await endpoint.run({ ...values, ...endpoint.example }, {} as never);
            assert.ok(result, `${endpoint.name} example returned nothing`);
        }
    });

    test('describes /hash', () => {
        const hash = manifest.find((e) => e.name === 'hash');
        assert.ok(hash);
        assert.equal(hash.method, 'post');
        assert.equal(hash.category, 'security');
        assert.equal(hash.params.text?.required, true);
        assert.deepEqual(hash.params.encoding?.options, ['hex', 'base64']);
    });
});
