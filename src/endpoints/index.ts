import address from './address.js';
import base from './base.js';
import caseConvert from './case.js';
import credit from './credit.js';
import type { Endpoint } from './define.js';
import dice from './dice.js';
import diff from './diff.js';
import encode from './encode.js';
import hash from './hash.js';
import levenshtein, { legacy as levenshteinLegacy } from './levenshtein.js';
import personal from './personal.js';
import read from './read.js';
import regex from './regex.js';
import text from './text.js';
import username from './username.js';
import uuid from './uuid.js';

// Endpoints declared as contracts; the others are still hand-written in routes/ and move here one by one
export const endpoints: Endpoint[] = [
    address,
    base,
    caseConvert,
    credit,
    dice,
    diff,
    encode,
    hash,
    levenshtein,
    levenshteinLegacy,
    personal,
    read,
    regex,
    text,
    username,
    uuid,
];
