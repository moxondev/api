import { type Request, type Response, Router } from 'express';

import { MAX_TOKEN_LENGTH, MIN_TOKEN_LENGTH } from '../constants.js';
import type { asymmetricAsync, default as asymmetric } from '../modules/v5/asymmetric.js';
import type { CaptchaVerification } from '../modules/v5/captcha.js';
import type { JwtResult } from '../modules/v5/jwt.js';
import { challengeStorage, chatStorage, ticTacToeStorage } from '../storage/index.js';
import type { ChallengeStorage } from '../types/storage.js';
import type { ChallengeVerification } from '../utils/challenge.js';
import { since } from '../utils/helpers.js';
import { error } from '../utils/response.js';

const router = Router();

// Asymmetric RSA key generation, encryption and decryption
router.post('/:version/asymmetric', async (req: Request, res: Response) => {
    const body = (req.body as Record<string, unknown>) || {};
    const { action, text, publicKey, privateKey, modulusLength, algorithm } = body;
    const { version } = req.params;

    // Prefer the async variant so RSA keygen does not block the event loop
    const mod = req.module as { asymmetric?: typeof asymmetric; asymmetricAsync?: typeof asymmetricAsync };
    const asymmetricFn = mod.asymmetricAsync ?? mod.asymmetric;
    if (!asymmetricFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!action) {
        error(res, 400, 'Please provide an action (?action=keygen|encrypt|decrypt)');
        return;
    }

    try {
        const result = await asymmetricFn(action as string, {
            text: text as string | undefined,
            publicKey: publicKey as string | undefined,
            privateKey: privateKey as string | undefined,
            modulusLength: modulusLength !== undefined ? Number(modulusLength) : undefined,
            algorithm: algorithm as string | undefined,
        });
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Verify a captcha answer against its token
router.post('/:version/captcha', (req: Request, res: Response) => {
    const body = (req.body as Record<string, unknown>) || {};
    const { token, answer, minLength } = body;
    const { version } = req.params;

    const verifyFn = (
        req.module as {
            verifyCaptcha?: (t: string, a: string, s: ChallengeStorage, m?: number) => CaptchaVerification;
        }
    ).verifyCaptcha;
    if (!verifyFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!token || typeof token !== 'string') {
        error(res, 400, 'Please provide a token (?token={token})');
        return;
    }
    if (!answer || typeof answer !== 'string') {
        error(res, 400, 'Please provide an answer (&answer={answer})');
        return;
    }
    const min = minLength === undefined ? undefined : Number(minLength);
    if (min !== undefined && (!Number.isInteger(min) || min < 1)) {
        error(res, 400, 'Please provide a valid minimum length (&minLength={number})');
        return;
    }

    try {
        res.jsonResponse(verifyFn(token, answer, challengeStorage, min));
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Generate a chart as SVG
router.post('/:version/chart', (req: Request, res: Response) => {
    const body = (req.body as Record<string, unknown>) || {};
    const { type, data, title, width, height, colors, bg, legend, mode } = body;
    const { version } = req.params;

    type ChartOutput = { contentType: string; body: string | Record<string, unknown> };
    const chartMod = (req.module as { chart?: Record<string, (d: unknown, o: unknown) => ChartOutput> }).chart;
    if (!chartMod) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!type || typeof type !== 'string' || !Object.hasOwn(chartMod, type)) {
        error(res, 400, 'Please provide a valid chart type (?type=bar|line|pie|donut)');
        return;
    }

    try {
        const output = chartMod[type]!(data, { title, width, height, colors, bg, legend, mode });
        if (output.contentType === 'application/json') {
            res.jsonResponse(output.body as Record<string, unknown>);
        } else {
            res.type(output.contentType).send(output.body as string);
        }
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Store chat messages
router.post('/:version/chat', (req: Request, res: Response) => {
    const { username, message, timestamp, session, token } = (req.body as Record<string, string>) || {};

    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!message) {
        error(res, 400, 'Please provide a message (&message={message})');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }

    try {
        const result = req.module.chat('message', {
            username,
            message,
            timestamp,
            session,
            token,
            storage: chatStorage,
        });
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Clear a private chat
router.post('/:version/chat/clear', (req: Request, res: Response) => {
    const { username, session, token } = (req.body as Record<string, string>) || {};
    const { version } = req.params;

    if (!since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!token) {
        error(res, 400, 'Please provide a valid token (&token={key}).');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }

    try {
        res.jsonResponse(req.module.chat('clear', { username, token, session, storage: chatStorage }));
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Display a private chat with a token
router.post('/:version/chat/private', (req: Request, res: Response) => {
    const { username, token } = (req.body as Record<string, string>) || {};

    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!token) {
        error(res, 400, 'Please provide a valid token (&token={key}).');
        return;
    }

    try {
        const messages = req.module.chat('private', {
            username,
            token,
            storage: chatStorage,
        });
        res.jsonResponse(messages);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Display a planning from an ICS file
router.post('/:version/hyperplanning', async (req: Request, res: Response) => {
    const { url, detail } = (req.body as Record<string, string>) || {};

    if (!url) {
        error(res, 400, 'Please provide a valid ICS file URL (?url={URL})');
        return;
    }

    try {
        const hyperplanning = await req.module.hyperplanning(url, detail);
        res.jsonResponse(hyperplanning);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Decode a JSON Web Token without verifying the signature
router.post('/:version/jwt', (req: Request, res: Response) => {
    const body = (req.body as Record<string, unknown>) || {};
    const { token } = body;
    const { version } = req.params;

    const jwtFn = (req.module as { jwt?: (t: string) => JwtResult }).jwt;
    if (!jwtFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!token) {
        error(res, 400, 'Please provide a token (?token={token})');
        return;
    }

    try {
        const result = jwtFn(token as string);
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Generate or verify OTP codes
router.post('/:version/otp', (req: Request, res: Response) => {
    const body = (req.body as Record<string, unknown>) || {};
    const { action, secret, code, algorithm, digits, period, counter, label, issuer } = body;
    const { version } = req.params;

    const otpFn = (req.module as { otp?: (a: string, o: Record<string, unknown>) => unknown }).otp;
    if (!otpFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!action) {
        error(res, 400, 'Please provide an action (?action=secret|generate|verify)');
        return;
    }

    try {
        const result = otpFn(action as string, {
            secret: secret as string | undefined,
            code: code as string | undefined,
            algorithm: algorithm as string | undefined,
            digits: digits !== undefined ? Number(digits) : undefined,
            period: period !== undefined ? Number(period) : undefined,
            counter: counter !== undefined ? Number(counter) : undefined,
            label: label as string | undefined,
            issuer: issuer as string | undefined,
        });
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Verify a solved proof-of-work challenge
router.post('/:version/pow', (req: Request, res: Response) => {
    const body = (req.body as Record<string, unknown>) || {};
    const { token, nonce } = body;
    const { version } = req.params;

    const verifyFn = (
        req.module as { verifyPow?: (t: string, n: string, s: ChallengeStorage) => ChallengeVerification }
    ).verifyPow;
    if (!verifyFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!token || typeof token !== 'string') {
        error(res, 400, 'Please provide a token (?token={token})');
        return;
    }
    if (nonce === undefined || nonce === null) {
        error(res, 400, 'Please provide a nonce (&nonce={nonce})');
        return;
    }

    try {
        res.jsonResponse(verifyFn(token, String(nonce), challengeStorage));
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Symmetric encrypt or decrypt text
router.post('/:version/symmetric', (req: Request, res: Response) => {
    const body = (req.body as Record<string, unknown>) || {};
    const { action, text, key, algorithm } = body;
    const { version } = req.params;

    const symmetricFn = (req.module as { symmetric?: (a: string, t: string, k: string, alg?: string) => unknown })
        .symmetric;
    if (!symmetricFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!action) {
        error(res, 400, 'Please provide an action (?action=encrypt|decrypt)');
        return;
    }
    if (!text) {
        error(res, 400, 'Please provide a text (&text={text})');
        return;
    }
    if (!key) {
        error(res, 400, 'Please provide a key (&key={key})');
        return;
    }

    try {
        const result = symmetricFn(action as string, text as string, key as string, algorithm as string | undefined);
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Store tic tac toe games
router.post('/:version/tic-tac-toe', (req: Request, res: Response) => {
    if (since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${req.version}.`);
        return;
    }

    const { username, move, session, game } = (req.body as Record<string, string>) || {};

    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!move) {
        error(res, 400, 'Please provide a valid move (&move={move})');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }
    if (!game) {
        error(res, 400, 'Please provide a valid game ID (&game={ID})');
        return;
    }

    try {
        const result = req.module.tic_tac_toe('play', {
            username,
            move,
            session,
            game,
            storage: ticTacToeStorage,
        });
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Display a tic tac toe game with a token
router.post('/:version/tic-tac-toe/fetch', (req: Request, res: Response) => {
    const { username, game } = (req.body as Record<string, string>) || {};
    const privateGame = ((req.body as Record<string, unknown>) || {}).private as boolean | undefined;

    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }

    try {
        const result = req.module.tic_tac_toe('fetch', {
            username,
            game,
            private: privateGame,
            storage: ticTacToeStorage,
        });
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Forfeit a tic-tac-toe game
router.post('/:version/tic-tac-toe/forfeit', (req: Request, res: Response) => {
    const { username, session, game } = (req.body as Record<string, string>) || {};
    const { version } = req.params;

    if (!since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }
    if (!game) {
        error(res, 400, 'Please provide a game ID (&game={ID})');
        return;
    }

    try {
        res.jsonResponse(req.module.tic_tac_toe('forfeit', { username, session, game, storage: ticTacToeStorage }));
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// List public tic tac toe games
router.post('/:version/tic-tac-toe/list', (req: Request, res: Response) => {
    try {
        const result = req.module.tic_tac_toe('list', {
            storage: ticTacToeStorage,
        });
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Play a tic-tac-toe move
router.post('/:version/tic-tac-toe/play', (req: Request, res: Response) => {
    const { username, move, session, game } = (req.body as Record<string, string>) || {};
    const { version } = req.params;

    if (!since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!move) {
        error(res, 400, 'Please provide a valid move (&move={move})');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }
    if (!game) {
        error(res, 400, 'Please provide a game ID (&game={ID})');
        return;
    }

    try {
        res.jsonResponse(req.module.tic_tac_toe('play', { username, move, session, game, storage: ticTacToeStorage }));
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Generate Token
router.post('/:version/token', (req: Request, res: Response) => {
    const body = (req.body as Record<string, unknown>) || {};
    const len = parseInt(String(body.len ?? 24), 10);
    const type = body.type ? String(body.type).toLowerCase() : 'alpha';

    if (isNaN(len) || len < 0) {
        error(res, 400, 'Invalid number.');
        return;
    }
    if (len > MAX_TOKEN_LENGTH) {
        error(res, 400, 'Length cannot exceed 4096.');
        return;
    }
    if (len < MIN_TOKEN_LENGTH) {
        error(res, 400, 'Length cannot be less than 12.');
        return;
    }

    try {
        const token = req.module.token(len, type);
        res.jsonResponse({ token });
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

export default router;
