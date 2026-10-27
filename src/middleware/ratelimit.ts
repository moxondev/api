import { isIP, isIPv4, isIPv6 } from 'node:net';

import type { NextFunction, Request, Response } from 'express';

import { getPlan, globalLimit } from '../config/plans.js';
import {
    RATE_LIMIT_IPV6_NETWORK,
    RATE_LIMIT_IPV6_PREFIX,
    RATE_LIMIT_NETWORK_FACTOR,
    RATE_LIMIT_WINDOW,
    SESSION_TTL,
} from '../constants.js';
import { ipLimits } from '../storage/index.js';
import type { IpLimits } from '../types/storage.js';
import { error } from '../utils/response.js';

export interface RateLimiterOptions {
    now?: () => number;
    burst?: boolean;
    global?: number;
    limits?: IpLimits;
}

/**
 * Expands an IPv6 address into its eight 16-bit groups.
 *
 * @param address - IPv6 address accepted by node:net, without a zone index
 * @returns The eight groups, in lowercase hex without leading zeros
 */
function expandIPv6(address: string): string[] {
    let text = address.toLowerCase();
    const last = text.lastIndexOf(':');
    const tail = text.slice(last + 1);

    if (isIPv4(tail)) {
        const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
        text = `${text.slice(0, last + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }

    const [head = '', rest] = text.split('::');
    const left = head ? head.split(':') : [];
    const right = rest ? rest.split(':') : [];
    const fill = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');

    return [...left, ...fill, ...right].map((group) => parseInt(group, 16).toString(16));
}

/**
 * Tells whether expanded IPv6 groups hold an IPv4-mapped address.
 *
 * @param groups - The eight groups returned by expandIPv6
 * @returns true for ::ffff:a.b.c.d in any spelling
 */
function isMapped(groups: string[]): boolean {
    return groups.slice(0, 5).every((group) => group === '0') && groups[5] === 'ffff';
}

/**
 * Derives the key a client is rate limited under.
 *
 * An IPv4-mapped IPv6 address counts as its IPv4 form, so a dual-stack socket
 * and a proxy header naming the same caller share one quota. Any other IPv6
 * address counts as its /64 prefix, the block a single subscriber is usually
 * handed, so rotating addresses inside it does not reset the quota.
 *
 * @param ip - Client address as resolved by Express
 * @returns The IPv4 address, the IPv6 prefix, or the input unchanged when it is not an IP address
 */
export function clientKey(ip: string): string {
    const address = ip.split('%')[0] ?? '';
    if (!isIPv6(address)) return ip;

    const groups = expandIPv6(address);
    if (isMapped(groups)) {
        const high = parseInt(groups[6]!, 16);
        const low = parseInt(groups[7]!, 16);
        return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }

    return `${groups.slice(0, RATE_LIMIT_IPV6_PREFIX / 16).join(':')}::/${RATE_LIMIT_IPV6_PREFIX}`;
}

/**
 * Derives the IPv6 network a client belongs to, the largest block one subscriber is usually handed.
 *
 * @param ip - Client address as resolved by Express
 * @returns The /48 prefix of an IPv6 address, or null for IPv4, IPv4-mapped and non-IP input
 */
export function networkKey(ip: string): string | null {
    const address = ip.split('%')[0] ?? '';
    if (!isIPv6(address)) return null;

    const groups = expandIPv6(address);
    if (isMapped(groups)) return null;
    return `${groups.slice(0, RATE_LIMIT_IPV6_NETWORK / 16).join(':')}::/${RATE_LIMIT_IPV6_NETWORK}`;
}

/**
 * Drops the hourly counters left from past hours and the burst timestamps outside the window.
 *
 * @param limits - Hourly counters, keyed by client
 * @param bursts - Timestamps of recent requests, keyed by client
 * @param now - Current time in milliseconds
 * @param networks - Admitted requests per IPv6 network, with the epoch hour they were counted in
 */
export function sweep(
    limits: IpLimits,
    bursts: Map<string, number[]>,
    now: number,
    networks: Map<string, { hour: number; count: number }> = new Map(),
): void {
    const currentHour = String(Math.floor(now / 3600000) % 24);
    for (const key of Object.keys(limits)) {
        const hours = Object.keys(limits[key]!);
        if (hours.length === 0 || (hours.length === 1 && hours[0] !== currentHour)) {
            delete limits[key];
        }
    }

    for (const [key, times] of bursts) {
        const recent = times.filter((t) => now - t < RATE_LIMIT_WINDOW);
        if (recent.length) bursts.set(key, recent);
        else bursts.delete(key);
    }

    for (const [key, { hour }] of networks) {
        if (hour !== Math.floor(now / 3600000)) networks.delete(key);
    }
}

/**
 * Builds a rate limiting middleware with its own counters.
 *
 * A request is checked against the instance-wide hourly budget, then against
 * the burst window and the hourly quota of its plan for its client key, and an
 * IPv6 client also against a larger quota for its whole /48 network. Only a
 * request that passes every check uses the instance-wide and network budgets,
 * so a client being refused cannot exhaust them for everybody else. A forged
 * proxy header that is not an IP address counts as the socket peer instead.
 *
 * @param options - Clock, burst switch, instance-wide budget and hourly store, each with a production default
 * @returns An Express middleware enforcing the limits
 */
export function createRateLimiter(
    options: RateLimiterOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
    const { now = Date.now, burst = true, global = globalLimit, limits = ipLimits } = options;
    const bursts = new Map<string, number[]>();
    const networks = new Map<string, { hour: number; count: number }>();

    let requests = 0;
    let resetTime = now() + SESSION_TTL;

    setInterval(() => sweep(limits, bursts, now(), networks), SESSION_TTL).unref();

    return (req: Request, res: Response, next: NextFunction): void => {
        const address = req.ip && isIP(req.ip) ? req.ip : req.socket.remoteAddress || '';
        const key = clientKey(address);
        const network = networkKey(address);
        const token = req.headers.authorization?.split(' ')[1] || '';

        const time = now();
        const minute = String(Math.floor(time / 60000) % 60);
        const hour = String(Math.floor(time / 3600000) % 24);
        const epochHour = Math.floor(time / 3600000);

        const match = getPlan(token);
        if (!match) {
            error(res, 401, 'Invalid token.');
            return;
        }

        const { plan } = match;

        if (time > resetTime) {
            requests = 0;
            resetTime = time + SESSION_TTL;
        }

        if (requests >= Math.max(global, plan.hourly)) {
            res.setHeader('Retry-After', Math.ceil((resetTime - time) / 1000));
            error(res, 429, 'Global rate limit exceeded.');
            return;
        }

        if (burst) {
            const recent = (bursts.get(key) ?? []).filter((t) => time - t < RATE_LIMIT_WINDOW);
            recent.push(time);
            bursts.set(key, recent);

            if (recent.length > plan.burst) {
                res.setHeader('Retry-After', Math.ceil(RATE_LIMIT_WINDOW / 1000));
                error(res, 429, 'Too many requests, please slow down.');
                return;
            }
        }

        if (!Object.hasOwn(limits, key)) limits[key] = Object.create(null);
        const hours = limits[key]!;
        if (!Object.hasOwn(hours, hour)) hours[hour] = Object.create(null);
        const minutes = hours[hour]!;
        minutes[minute] = (minutes[minute] ?? 0) + 1;

        const hourTotal = Object.values(minutes).reduce((sum, count) => sum + count, 0);
        const hourEnds = Math.ceil(time / 3600000) * 3600000;

        res.setHeader('X-RateLimit-Limit', plan.hourly);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, plan.hourly - hourTotal));
        res.setHeader('X-RateLimit-Reset', Math.floor(hourEnds / 1000));

        if (hourTotal > plan.hourly) {
            res.setHeader('Retry-After', Math.ceil((hourEnds - time) / 1000));
            error(res, 429, `You have exceeded the limit of ${plan.hourly} requests per hour.`);
            return;
        }

        for (const h of Object.keys(hours)) {
            if (h !== hour) delete hours[h];
        }

        // Each /64 has its own quota, so a subscriber holding many of them is also capped as a whole
        const used = network ? networks.get(network) : undefined;
        const networkTotal = used?.hour === epochHour ? used.count : 0;
        if (network && networkTotal >= plan.hourly * RATE_LIMIT_NETWORK_FACTOR) {
            res.setHeader('Retry-After', Math.ceil((hourEnds - time) / 1000));
            error(res, 429, 'Too many requests from your network.');
            return;
        }

        requests++;
        if (network) networks.set(network, { hour: epochHour, count: networkTotal + 1 });
        next();
    };
}

// Burst protection stays off under test, where every suite shares one client address
export const rateLimitMiddleware = createRateLimiter({ burst: process.env.NODE_ENV !== 'test' });
