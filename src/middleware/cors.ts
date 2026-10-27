import cors from 'cors';
import express, { type Express } from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Applies the proxy setting, the security headers, CORS and the robots.txt route.
 *
 * The security headers come first so that every response carries them,
 * preflights and errors included. Body parsing is mounted separately by
 * setupParsers, after the rate limiter.
 *
 * @param app - Express application to configure
 */
export function setupCors(app: Express): void {
    app.set('trust proxy', env.TRUSTED_PROXIES ?? 1);
    if (!env.TRUSTED_PROXIES && process.env.NODE_ENV !== 'test') {
        console.warn(
            'TRUSTED_PROXIES is unset: client addresses are read assuming exactly one reverse proxy in front of the API.',
        );
    }

    app.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        next();
    });

    app.use(
        cors({
            methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
            exposedHeaders: [
                'X-Captcha-Text',
                'X-Captcha-Token',
                'X-RateLimit-Limit',
                'X-RateLimit-Remaining',
                'X-RateLimit-Reset',
                'Retry-After',
            ],
        }),
    );

    app.use('/robots.txt', express.static(join(__dirname, '..', '..', 'robots.txt')));
}

/**
 * Mounts the URL-encoded and JSON body parsers, both capped at 10 KB.
 *
 * @param app - Express application to configure
 */
export function setupParsers(app: Express): void {
    app.use(express.urlencoded({ extended: true, limit: '10kb' }));
    app.use(express.json({ limit: '10kb' }));
}
