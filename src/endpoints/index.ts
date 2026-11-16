import address from './address.js';
import credit from './credit.js';
import type { Endpoint } from './define.js';
import dice from './dice.js';
import hash from './hash.js';
import personal from './personal.js';
import username from './username.js';
import uuid from './uuid.js';

// Endpoints declared as contracts; the others are still hand-written in routes/ and move here one by one
export const endpoints: Endpoint[] = [address, credit, dice, hash, personal, username, uuid];
