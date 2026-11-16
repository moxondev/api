/**
 * Records the answers of the endpoints, to pin their behaviour before the code behind them changes.
 *
 * Each file of tests/golden/cases holds the requests of one category. Every request is sent several times to every
 * version it targets, whatever differs from one run to the next is stored as a volatile value, and the result is
 * written to tests/golden/recorded. tests/integration/golden.test.ts then replays the requests against the code.
 *
 * Record from the code whose behaviour must be kept, never from the code under change:
 *
 *   NODE_ENV=test DOCS_URL=https://docs.example.test node --import tsx tests/golden/capture.ts [category]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { force, type GoldenCase, merge, type Recorded, send, start, stop, VERSIONS } from './harness.js';

const RUNS = 5;
const CASES = join(import.meta.dirname, 'cases');
const RECORDED = join(import.meta.dirname, 'recorded');

const only = process.argv[2];
const files = readdirSync(CASES).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`));
if (files.length === 0) throw new Error(`No case file${only ? ` named ${only}` : ''}`);

await start();
try {
    for (const file of files) {
        const cases = JSON.parse(readFileSync(join(CASES, file), 'utf8')) as GoldenCase[];
        const recorded: Recorded[] = [];

        for (const entry of cases) {
            if (entry.skip) continue;
            for (const version of entry.versions ?? VERSIONS) {
                const runs = [];
                for (let i = 0; i < RUNS; i++) runs.push(await send(version, entry));

                const statuses = new Set(runs.map((r) => r.status));
                if (statuses.size > 1) throw new Error(`${entry.id} ${version}: the status changes between runs`);

                const body = force(merge(runs.map((r) => r.body)), entry.volatile ?? []);
                recorded.push({ id: entry.id, version, status: runs[0]!.status, type: runs[0]!.type, body });
            }
        }

        writeFileSync(join(RECORDED, file), JSON.stringify(recorded, null, 4) + '\n');
        console.log(`${file}: ${recorded.length} answers recorded`);
    }
} finally {
    await stop();
}
