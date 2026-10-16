import type { Endpoint } from './define.js';
import hash from './hash.js';

// Endpoints declared as contracts; the others are still hand-written in routes/ and move here one by one
export const endpoints: Endpoint[] = [hash];
