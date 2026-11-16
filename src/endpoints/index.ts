import address from './address.js';
import agent from './agent.js';
import algorithms from './algorithms.js';
import asymmetric from './asymmetric.js';
import base from './base.js';
import caseConvert from './case.js';
import color from './color.js';
import convert from './convert.js';
import credit from './credit.js';
import cron from './cron.js';
import csv from './csv.js';
import type { Endpoint } from './define.js';
import dice from './dice.js';
import diff from './diff.js';
import domain from './domain.js';
import encode from './encode.js';
import evaluate from './evaluate.js';
import geo from './geo.js';
import hash from './hash.js';
import headers from './headers.js';
import hyperplanning from './hyperplanning.js';
import ip from './ip.js';
import jwt from './jwt.js';
import levenshtein, { legacy as levenshteinLegacy } from './levenshtein.js';
import matrix from './matrix.js';
import otp from './otp.js';
import palette from './palette.js';
import password from './password.js';
import personal from './personal.js';
import pow from './pow.js';
import read from './read.js';
import regex from './regex.js';
import semver from './semver.js';
import statistics from './statistics.js';
import symmetric from './symmetric.js';
import text from './text.js';
import time from './time.js';
import token from './token.js';
import url from './url.js';
import username from './username.js';
import uuid from './uuid.js';
import validate from './validate.js';

// Endpoints declared as contracts; the others are still hand-written in routes/ and move here one by one
export const endpoints: Endpoint[] = [
    address,
    agent,
    algorithms,
    asymmetric,
    base,
    caseConvert,
    color,
    convert,
    credit,
    cron,
    csv,
    dice,
    diff,
    domain,
    encode,
    evaluate,
    geo,
    hash,
    headers,
    hyperplanning,
    ip,
    jwt,
    levenshtein,
    levenshteinLegacy,
    matrix,
    otp,
    palette,
    password,
    personal,
    pow,
    read,
    regex,
    semver,
    statistics,
    symmetric,
    text,
    time,
    token,
    url,
    username,
    uuid,
    validate,
];
