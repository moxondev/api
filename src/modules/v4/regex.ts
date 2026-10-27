import { createContext, Script } from 'node:vm';

import { MAX_PATTERN_LENGTH, MAX_REGEX_MATCHES, MAX_STRING_LENGTH, REGEX_TIMEOUT } from '../../constants.js';

const VALID_FLAGS = new Set(['g', 'i', 'm', 's', 'u']);

// Compile and match loop, run in a separate context so a catastrophic pattern can be interrupted
const MATCH_SCRIPT = new Script(`(() => {
    const { pattern, text, flags, max } = input;
    let re;
    try {
        re = new RegExp(pattern, flags);
    } catch {
        return null;
    }
    const matches = [];
    let result;
    while ((result = re.exec(text)) !== null && matches.length < max) {
        matches.push({
            match: result[0],
            index: result.index,
            groups: result.slice(1).map((g) => g ?? ''),
            namedGroups: result.groups ? { ...result.groups } : {},
        });

        // Prevent infinite loop on zero-length matches
        if (result[0].length === 0) re.lastIndex++;
    }
    return matches;
})()`);

const MATCH_CONTEXT = createContext({ input: null });

export interface RegexMatch {
    match: string;
    index: number;
    groups: string[];
    namedGroups: Record<string, string>;
}

export interface RegexResult {
    valid: boolean;
    pattern: string;
    flags: string;
    matches: RegexMatch[];
    count: number;
}

/**
 * Compiles the pattern and collects its matches inside the sandbox, bounded by the regex timeout.
 *
 * @param pattern - The regex pattern to compile
 * @param text - The text to match against
 * @param flags - The cleaned flags, g included
 * @returns Matches copied into this realm, or null if the pattern does not compile
 * @throws Error if the evaluation runs longer than the regex timeout
 */
const runMatch = (pattern: string, text: string, flags: string): RegexMatch[] | null => {
    MATCH_CONTEXT.input = { pattern, text, flags, max: MAX_REGEX_MATCHES };
    let found: RegexMatch[] | null;
    try {
        found = MATCH_SCRIPT.runInContext(MATCH_CONTEXT, { timeout: REGEX_TIMEOUT }) as RegexMatch[] | null;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
            throw new Error('Pattern took too long to evaluate');
        }
        throw err;
    } finally {
        MATCH_CONTEXT.input = null;
    }
    if (found === null) return null;

    // The sandbox objects belong to another realm, so rebuild them as plain local objects
    return Array.from(found, (m) => ({
        match: m.match,
        index: m.index,
        groups: [...m.groups],
        namedGroups: { ...m.namedGroups },
    }));
};

/**
 * Tests a regular expression pattern against a text and returns structured match results.
 *
 * @param pattern - The regex pattern to test (max 200 characters)
 * @param text - The text to match against (max 1000 characters)
 * @param flags - Optional regex flags; only g, i, m, s, u are accepted (g is always forced)
 * @returns Match results with groups and named groups, or { valid: false } if the pattern is invalid
 * @throws Error if pattern or text is missing, exceeds the maximum length, or takes too long to evaluate
 */
export default function regex(pattern: string, text: string, flags: string = 'g'): RegexResult {
    // A repeated query key arrives as an array, whose element count would slip past the length caps
    if (!pattern || typeof pattern !== 'string') {
        throw new Error('Please provide a pattern (?pattern={regex})');
    }
    if (!text || typeof text !== 'string') {
        throw new Error('Please provide a text (&text={string})');
    }
    if (pattern.length > MAX_PATTERN_LENGTH) {
        throw new Error(`Pattern must be under ${MAX_PATTERN_LENGTH} characters`);
    }
    if (text.length > MAX_STRING_LENGTH) {
        throw new Error(`Text must be under ${MAX_STRING_LENGTH} characters`);
    }

    const cleanedFlags = [...new Set(['g', ...flags.split('').filter((f) => VALID_FLAGS.has(f))])].join('');

    const matches = runMatch(pattern, text, cleanedFlags);
    if (matches === null) {
        return { valid: false, pattern, flags: cleanedFlags, matches: [], count: 0 };
    }

    return { valid: true, pattern, flags: cleanedFlags, matches, count: matches.length };
}
