import { randomBytes } from 'crypto';

import {
    GAME_CLEANUP_TTL,
    MAX_ID_LENGTH,
    MAX_USERNAME_LENGTH,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW,
    SESSION_TTL,
} from '../../constants.js';
import type { TicTacToeGame, TicTacToeMove, TicTacToeStorage } from '../../types/storage.js';
import { checkString } from '../../utils/helpers.js';

interface TicTacToeParams {
    username?: string;
    move?: string;
    session?: string;
    game?: string;
    private?: boolean;
    storage: TicTacToeStorage;
}

interface GameResult {
    winner?: string | null;
    loser?: string | null;
    tie?: boolean;
}

/**
 * Handles Tic-Tac-Toe game actions including playing a move, fetching game state, listing games, and forfeiting.
 *
 * @param action - The action to perform: "play", "fetch", "list", or "forfeit"
 * @param params - Game parameters including username, move, session, game ID, and shared storage
 * @returns Game state or action result depending on the action
 * @throws Error if a required parameter is missing, the action is invalid, or a rate limit is exceeded
 */
export default function tic_tac_toe(action: string, params: TicTacToeParams): Record<string, unknown> {
    const storage = params.storage;

    storage.games ??= Object.create(null);
    storage.sessions ??= Object.create(null);
    storage.rateLimits ??= Object.create(null);

    const { games, sessions, rateLimits } = storage;

    if (action === 'list') return listGames(games);

    if (!params.username) throw new Error('Please provide a username');

    checkString(params.username, 'username', MAX_USERNAME_LENGTH);
    checkString(params.session, 'session ID', MAX_ID_LENGTH);
    checkString(params.game, 'game ID', MAX_ID_LENGTH);

    const u = params.username.toLowerCase();
    const now = Date.now();

    rateLimits[u] = (Object.hasOwn(rateLimits, u) ? rateLimits[u]! : []).filter((ts) => now - ts < RATE_LIMIT_WINDOW);
    if (rateLimits[u]!.length >= RATE_LIMIT_MAX) {
        const remainingTime = Math.ceil((rateLimits[u]![0]! + RATE_LIMIT_WINDOW - now) / 1000);
        throw new Error(`Rate limit exceeded. Try again in ${remainingTime} seconds.`);
    }
    rateLimits[u]!.push(now);

    if (action === 'play') {
        return playMove(params, games, sessions, u, now);
    } else if (action === 'fetch') {
        return fetchGame(params, games, u);
    } else if (action === 'forfeit') {
        return forfeitGame(params, games, sessions);
    } else {
        throw new Error('Invalid action. Use "play", "fetch", "list", or "forfeit"');
    }
}

/**
 * Ends a game on behalf of one of its players, the other player winning.
 *
 * @param params - Game parameters holding the game ID, session and username
 * @param games - Games keyed by ID
 * @param sessions - Session bound to each lowercased username
 * @returns Forfeit message with the winner, or null when the player was alone, and the loser
 * @throws Error if the game or session is missing, the game does not exist, the session does not match, or the user is not a player
 */
function forfeitGame(
    params: TicTacToeParams,
    games: Record<string, TicTacToeGame>,
    sessions: Record<string, { user: string; last: number }>,
): Record<string, unknown> {
    const { game, session } = params;

    if (!game) throw new Error('Please provide a valid game ID');
    if (!session) throw new Error('Please provide a valid session ID');
    if (!Object.hasOwn(games, game)) throw new Error('Game not found');

    const u = params.username!.toLowerCase();
    if (Object.hasOwn(sessions, u) && sessions[u]!.user !== session) {
        throw new Error('Session ID mismatch');
    }

    const players = games[game]!.players;
    if (!players.includes(u)) throw new Error('You are not a player in this game');

    const winner = players.find((p) => p !== u) ?? null;
    delete games[game];
    delete sessions[u];

    return {
        message: `${params.username} forfeited the game.${winner ? ` ${winner} wins.` : ''}`,
        winner,
        loser: params.username,
    };
}

/**
 * Records a move in a game, creating the game on its first move.
 *
 * @param params - Game parameters holding the move, session, game ID and username
 * @param games - Games keyed by ID
 * @param sessions - Session bound to each lowercased username
 * @param u - Lowercased username
 * @param now - Current timestamp in milliseconds
 * @returns Confirmation message, with the winner, loser or tie once the game is over
 * @throws Error if a parameter is missing or invalid, the session does not match, the game is full, or it is not the user's turn
 */
function playMove(
    params: TicTacToeParams,
    games: Record<string, TicTacToeGame>,
    sessions: Record<string, { user: string; last: number }>,
    u: string,
    now: number,
): Record<string, unknown> {
    const { move, session, game } = params;
    const validMoves = ['1-1', '1-2', '1-3', '2-1', '2-2', '2-3', '3-1', '3-2', '3-3'];

    if (!move) throw new Error('Please provide a valid move');
    if (!session) throw new Error('Please provide a valid session ID');
    if (!game) throw new Error('Please provide a valid game ID');
    if (!validMoves.includes(move)) throw new Error('Invalid move. Please provide a valid move (e.g., 1-1, 2-2, 3-3).');

    if (Object.hasOwn(sessions, u) && sessions[u]!.user !== session) {
        throw new Error('Session ID mismatch');
    }

    if (!Object.hasOwn(games, game)) {
        games[game] = {
            moves: [],
            players: [],
            private: params.private || false,
            creation: Date.now(),
        };
    }
    const g = games[game]!;
    const moves = g.moves;

    if (!g.players.includes(u)) {
        if (g.players.length >= 2) throw new Error('Game is full, you can only watch.');
        g.players.push(u);
    }

    if (moves.length > 0 && moves[moves.length - 1]!.username === u) {
        throw new Error('Please wait for the other player to make a move.');
    }

    if (moves.some((play) => play.move === move)) {
        throw new Error('Move already made. Please choose a different move.');
    }

    const play: TicTacToeMove = { username: u, move, session };
    moves.push(play);
    g.last = now;

    const creation = g.creation;
    const result = checkGame(moves);
    if (result.winner || result.tie) {
        setTimeout(() => {
            if (Object.hasOwn(games, game!) && games[game!]!.creation === creation) delete games[game!];
        }, GAME_CLEANUP_TTL).unref();
        return {
            message: `Move sent successfully. ${result.winner ? result.winner + ' wins. ' + result.loser + ' loses.' : "It's a tie."}`,
            ...result,
        };
    }

    setTimeout(() => {
        const cur = Object.hasOwn(games, game!) ? games[game!] : undefined;
        if (cur && cur.creation === creation && Date.now() - (cur.last ?? cur.creation) >= SESSION_TTL) {
            delete games[game!];
        }
    }, SESSION_TTL).unref();

    if (!Object.hasOwn(sessions, u)) sessions[u] = { user: session, last: now };
    sessions[u]!.last = now;
    setTimeout(() => {
        if (Object.hasOwn(sessions, u) && Date.now() - sessions[u]!.last >= SESSION_TTL) delete sessions[u];
    }, SESSION_TTL).unref();

    return { message: 'Move sent successfully' };
}

/**
 * Returns the state of a game and adds the user to its players, creating it when needed.
 *
 * @param params - Game parameters holding the optional game ID, a random one being generated when absent
 * @param games - Games keyed by ID
 * @param u - Lowercased username
 * @returns Game ID, moves, players, turn, status, privacy and result so far
 */
function fetchGame(params: TicTacToeParams, games: Record<string, TicTacToeGame>, u: string): Record<string, unknown> {
    const id = params.game || generateGameId();
    if (!Object.hasOwn(games, id)) {
        games[id] = {
            moves: [],
            players: [],
            private: params.private || false,
            creation: Date.now(),
        };
    }
    if (!games[id]!.players.includes(u)) {
        games[id]!.players.push(u);
    }

    const moves = games[id]!.moves;
    const players = games[id]!.players;
    const privateGame = games[id]!.private;
    const lastPlayer = moves.length ? moves[moves.length - 1]!.username : null;
    const turn = players.find((p) => p !== lastPlayer) || players[0];
    const status = players.length >= 2 ? 'ready' : 'waiting';
    const result = moves.length ? checkGame(moves) : {};

    return {
        id,
        moves,
        players,
        turn,
        status,
        private: privateGame,
        ...result,
    };
}

function listGames(games: Record<string, TicTacToeGame>): Record<string, unknown> {
    const publicGames: Record<string, unknown>[] = [];
    const now = Date.now();

    for (const [gameId, game] of Object.entries(games)) {
        if (!game.private) {
            const result = game.moves.length ? checkGame(game.moves) : {};
            const isFinished = result.winner || result.tie;

            if (!isFinished) {
                const lastPlayer = game.moves.length ? game.moves[game.moves.length - 1]!.username : null;
                const turn = game.players.find((p) => p !== lastPlayer) || game.players[0];
                const status = game.players.length >= 2 ? 'ready' : 'waiting';

                publicGames.push({
                    id: gameId,
                    players: game.players,
                    playersCount: game.players.length,
                    moves: game.moves.length,
                    turn,
                    status,
                    creation: game.creation || now,
                });
            }
        }
    }

    publicGames.sort((a, b) => (b.creation as number) - (a.creation as number));

    return {
        message: 'Public games available',
        count: publicGames.length,
        games: publicGames,
    };
}

function generateGameId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from(randomBytes(5))
        .map((b) => chars[b % chars.length])
        .join('');
}

/**
 * Replays the moves on a board to find the winner or a tie.
 *
 * @param moves - Moves in play order, the first player taking X
 * @returns Winner and loser usernames, null when nobody won yet, and whether the board is full without a winner
 */
function checkGame(moves: TicTacToeMove[]): GameResult {
    const board: (string | null)[][] = Array(3)
        .fill(null)
        .map(() => Array(3).fill(null) as (string | null)[]);
    const playerSymbols: Record<string, string> = Object.create(null);
    const playersOrder: string[] = [];

    moves.forEach(({ username, move }) => {
        if (!playerSymbols[username]) {
            playersOrder.push(username);
            playerSymbols[username] = playersOrder.length === 1 ? 'X' : 'O';
        }
        const [row, col] = move.split('-').map(Number) as [number, number];
        board[row - 1]![col - 1] = playerSymbols[username]!;
    });

    const checkWinner = (symbol: string): boolean => {
        for (let i = 0; i < 3; i++) {
            if (board[i]![0] === symbol && board[i]![1] === symbol && board[i]![2] === symbol) return true;
            if (board[0]![i] === symbol && board[1]![i] === symbol && board[2]![i] === symbol) return true;
        }
        if (board[0]![0] === symbol && board[1]![1] === symbol && board[2]![2] === symbol) return true;
        if (board[0]![2] === symbol && board[1]![1] === symbol && board[2]![0] === symbol) return true;
        return false;
    };

    const winner = Object.keys(playerSymbols).find((player) => checkWinner(playerSymbols[player]!)) ?? null;
    const isTie = !winner && moves.length === 9;
    const loser =
        winner && playersOrder.length === 2 ? (playersOrder.find((player) => player !== winner) ?? null) : null;

    return { winner, loser, tie: isTie };
}
