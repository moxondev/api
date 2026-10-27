import type { ChallengeStorage, ChatStorage, IpLimits, TicTacToeStorage } from '../types/storage.js';

// Keys come from clients, so the stores have no prototype ('constructor' or '__proto__' stay plain keys)
export const ipLimits: IpLimits = Object.create(null);

export const challengeStorage: ChallengeStorage = { usedNonces: new Map(), attempts: new Map() };

export const chatStorage: ChatStorage = {
    messages: [],
    privateChats: Object.create(null),
    sessions: Object.create(null),
    rateLimits: Object.create(null),
};

export const ticTacToeStorage: TicTacToeStorage = {
    games: Object.create(null),
    sessions: Object.create(null),
    rateLimits: Object.create(null),
};
