import { api, define } from './define.js';

/**
 * Puts back the plus signs of a version that the query string decoded as spaces. No version contains a space, so
 * every one of them stands for a plus sign (the separator of the build metadata).
 *
 * @param value - Version or comparison target as received
 * @returns The same text with its spaces turned into plus signs
 */
function restorePlus(value: string): string {
    return value.replace(/ /g, '+');
}

export default define({
    name: 'semver',
    method: 'get',
    path: '/semver',
    category: 'compute',
    since: 5,
    params: {
        version: { type: 'string' },
        action: { type: 'string', options: ['parse', 'bump', 'compare'], default: 'parse' },
        part: { type: 'string', options: ['major', 'minor', 'patch'], default: 'patch' },
        other: { type: 'string' },
    },
    example: { version: '1.2.3', action: 'bump', part: 'minor' },
    run: ({ version, action, part, other }, req) => {
        if (!version || typeof version !== 'string') throw new Error('Please provide a version (?version={version})');
        return api(req).semver(
            restorePlus(version),
            action as string | undefined,
            part as string | undefined,
            typeof other === 'string' ? restorePlus(other) : undefined,
        );
    },
});
