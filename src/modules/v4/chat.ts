import {
    MAX_CHAT_MESSAGES,
    MAX_ID_LENGTH,
    MAX_PRIVATE_CHATS,
    MAX_STRING_LENGTH,
    MAX_USERNAME_LENGTH,
    SESSION_TTL,
} from '../../constants.js';
import type { ChatMessage, ChatStorage } from '../../types/storage.js';
import { checkRateLimit, checkString, isTimestamp } from '../../utils/helpers.js';

interface ChatParams {
    username: string;
    message?: string;
    timestamp?: string;
    session?: string;
    token?: string;
    storage: ChatStorage;
}

/**
 * Handles real-time chat actions including sending, fetching, and clearing messages.
 *
 * @param action - The action to perform: "message", "private", "fetch", or "clear"
 * @param params - Chat parameters including username, message, session, and shared storage
 * @returns The result of the action — a message list, a sent confirmation, or a status message
 * @throws Error if a required parameter is missing or the action is invalid
 */
export default function chat(action: string, params: ChatParams): ChatMessage[] | ChatMessage | { message: string } {
    const storage = params.storage;

    storage.messages ??= [];
    storage.privateChats ??= {};
    storage.sessions ??= {};
    storage.rateLimits ??= {};

    const { messages, privateChats, sessions, rateLimits } = storage;

    if (!params.username) throw new Error('Please provide a username');

    // Readers are keyed by their IP, which can be longer than a chat username
    checkString(params.username, 'username', action === 'fetch' ? MAX_STRING_LENGTH : MAX_USERNAME_LENGTH);
    checkString(params.message, 'message', MAX_STRING_LENGTH);
    checkString(params.session, 'session ID', MAX_ID_LENGTH);
    checkString(params.token, 'token', MAX_ID_LENGTH);

    const u = params.username.toLowerCase();
    const now = Date.now();

    checkRateLimit(rateLimits, u, now);

    if (action === 'message') {
        return sendMessage(params, messages, privateChats, sessions, u, now);
    } else if (action === 'private') {
        return getPrivateChat(params, privateChats);
    } else if (action === 'fetch') {
        return fetchMessages(messages);
    } else if (action === 'clear') {
        return clearPrivateChat(params, privateChats, sessions, u);
    } else {
        throw new Error('Invalid action. Use "message", "private", "fetch", or "clear"');
    }
}

/**
 * Stores a message in the public room or in the private thread of its token.
 *
 * @param params - Chat parameters holding the message, session and optional private token
 * @param messages - Public room, trimmed to its newest MAX_CHAT_MESSAGES entries
 * @param privateChats - Private threads keyed by token, each trimmed the same way
 * @param sessions - Session bound to each lowercased username
 * @param u - Lowercased username
 * @param now - Current timestamp in milliseconds
 * @returns Confirmation message
 * @throws Error if the message or session is missing, the session does not match, or too many private chats exist
 */
function sendMessage(
    params: ChatParams,
    messages: ChatMessage[],
    privateChats: Record<string, ChatMessage[]>,
    sessions: Record<string, { user: string; last: number }>,
    u: string,
    now: number,
): { message: string } {
    const { message, session, token } = params;

    if (!message) throw new Error('Please provide a message');
    if (!session) throw new Error('Please provide a valid session ID');

    if (Object.hasOwn(sessions, u) && sessions[u]!.user !== session) {
        throw new Error('Session ID mismatch');
    }

    const msg: ChatMessage = {
        username: params.username,
        message,
        timestamp: params.timestamp && isTimestamp(params.timestamp) ? params.timestamp : new Date().toISOString(),
    };

    if (token) {
        if (!Object.hasOwn(privateChats, token)) {
            if (Object.keys(privateChats).length >= MAX_PRIVATE_CHATS) throw new Error('Too many active private chats');
            privateChats[token] = [];
        }
        const thread = privateChats[token]!;
        thread.push(msg);
        if (thread.length > MAX_CHAT_MESSAGES) thread.splice(0, thread.length - MAX_CHAT_MESSAGES);
        setTimeout(() => {
            delete privateChats[token];
        }, SESSION_TTL).unref();
    } else {
        messages.push(msg);
        if (messages.length > MAX_CHAT_MESSAGES) messages.splice(0, messages.length - MAX_CHAT_MESSAGES);
        setTimeout(() => {
            const idx = messages.indexOf(msg);
            if (idx !== -1) messages.splice(idx, 1);
        }, SESSION_TTL).unref();
    }

    if (!Object.hasOwn(sessions, u)) sessions[u] = { user: session, last: now };
    sessions[u]!.last = now;

    setTimeout(() => {
        if (Object.hasOwn(sessions, u) && now - sessions[u]!.last >= SESSION_TTL) delete sessions[u];
    }, SESSION_TTL).unref();

    return { message: 'Message sent successfully' };
}

/**
 * Returns the messages of a private thread.
 *
 * @param params - Chat parameters holding the private token
 * @param privateChats - Private threads keyed by token
 * @returns Messages of the thread, oldest first
 * @throws Error if the token is missing or no thread exists for it
 */
function getPrivateChat(params: ChatParams, privateChats: Record<string, ChatMessage[]>): ChatMessage[] {
    const { token } = params;

    if (!token) throw new Error('Please provide a valid token');

    if (Object.hasOwn(privateChats, token)) return privateChats[token]!;

    throw new Error('Invalid or expired token.');
}

function fetchMessages(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length > 0) return messages;
    throw new Error('No messages stored.');
}

/**
 * Deletes a private thread and the session of the user clearing it.
 *
 * @param params - Chat parameters holding the private token and session
 * @param privateChats - Private threads keyed by token
 * @param sessions - Session bound to each lowercased username
 * @param u - Lowercased username
 * @returns Confirmation message
 * @throws Error if the token or session is missing, the session does not match, or no thread exists for the token
 */
function clearPrivateChat(
    params: ChatParams,
    privateChats: Record<string, ChatMessage[]>,
    sessions: Record<string, { user: string; last: number }>,
    u: string,
): { message: string } {
    const { token, session } = params;

    if (!token) throw new Error('Please provide a valid token');
    if (!session) throw new Error('Please provide a valid session ID');
    if (Object.hasOwn(sessions, u) && sessions[u]!.user !== session) {
        throw new Error('Session ID mismatch');
    }
    if (!Object.hasOwn(privateChats, token)) throw new Error('Invalid or expired token.');

    delete privateChats[token];
    delete sessions[u];

    return { message: 'Private chat cleared successfully' };
}
