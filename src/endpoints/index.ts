import address from './address.js';
import algorithms from './algorithms.js';
import base from './base.js';
import caseConvert from './case.js';
import convert from './convert.js';
import credit from './credit.js';
import cron from './cron.js';
import csv from './csv.js';
import type { Endpoint } from './define.js';
import dice from './dice.js';
import diff from './diff.js';
import encode from './encode.js';
import evaluate from './evaluate.js';
import hash from './hash.js';
import levenshtein, { legacy as levenshteinLegacy } from './levenshtein.js';
import matrix from './matrix.js';
import personal from './personal.js';
import read from './read.js';
import regex from './regex.js';
import semver from './semver.js';
import statistics from './statistics.js';
import text from './text.js';
import time from './time.js';
import username from './username.js';
import uuid from './uuid.js';
import validate from './validate.js';

// Endpoints declared as contracts; the others are still hand-written in routes/ and move here one by one
export const endpoints: Endpoint[] = [
    address,
    algorithms,
    base,
    caseConvert,
    convert,
    credit,
    cron,
    csv,
    dice,
    diff,
    encode,
    evaluate,
    hash,
    levenshtein,
    levenshteinLegacy,
    matrix,
    personal,
    read,
    regex,
    semver,
    statistics,
    text,
    time,
    username,
    uuid,
    validate,
];
