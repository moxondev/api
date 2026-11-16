import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { type GoldenCase, type Recorded, replay, start, stop, VERSIONS } from '../golden/harness.js';

const CASES = join(import.meta.dirname, '..', 'golden', 'cases');
const RECORDED = join(import.meta.dirname, '..', 'golden', 'recorded');

before(() => start());
after(() => stop());

// GOLDEN_ONLY=<category> replays a single file, while the others are being recorded
const only = process.env.GOLDEN_ONLY;

for (const file of readdirSync(CASES).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`))) {
    const category = file.replace(/\.json$/, '');
    const cases = JSON.parse(readFileSync(join(CASES, file), 'utf8')) as GoldenCase[];
    const recorded = JSON.parse(readFileSync(join(RECORDED, file), 'utf8')) as Recorded[];

    describe(`golden answers: ${category}`, () => {
        test('every request that is not skipped has a recording for each of its versions', () => {
            for (const entry of cases) {
                if (entry.skip) continue;
                for (const version of entry.versions ?? VERSIONS) {
                    assert.ok(
                        recorded.some((r) => r.id === entry.id && r.version === version),
                        `${entry.id} ${version} is not recorded`,
                    );
                }
            }
            assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'case ids must be unique');
        });

        for (const entry of cases) {
            if (entry.skip) continue;
            test(entry.id, async () => {
                for (const answer of recorded.filter((r) => r.id === entry.id)) await replay(entry, answer);
            });
        }
    });
}
