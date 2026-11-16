import { type Request, type Response, Router } from 'express';

import { env } from '../config/env.js';
import { versions } from '../config/versions.js';
import type { AvatarOptions, AvatarResult } from '../modules/v4/avatar.js';
import type { BarcodeOptions, BarcodeResult } from '../modules/v4/barcode.js';
import type { CaptchaOptions, CaptchaResult } from '../modules/v4/captcha.js';
import type { PasswordResult } from '../modules/v4/password.js';
import type { QRCodeOptions, QRCodeResult } from '../modules/v4/qrcode.js';
import type { CaptchaChallenge } from '../modules/v5/captcha.js';
import type { BadgeOptions, BadgeResult } from '../modules/v6/badge.js';
import { chatStorage } from '../storage/index.js';
import { since } from '../utils/helpers.js';
import { error } from '../utils/response.js';

const router = Router();

const postOnly = (name: string) => (req: Request, res: Response) => {
    const available = versions[req.version]?.endpoints.post.some((e) => e.name === name);
    if (!available) {
        error(res, 404, `Endpoint not available in ${req.version}.`);
        return;
    }
    error(res, 405, 'This endpoint only supports POST requests.');
};

// Display version information
router.get('/:version', (req: Request, res: Response) => {
    const version = req.params.version as string;
    const versionConfig = versions[version]!;

    const endpoints = Object.keys(versionConfig.endpoints).reduce<Record<string, unknown>>((acc, method) => {
        const endpointList = versionConfig.endpoints[method as keyof typeof versionConfig.endpoints];
        if (!endpointList) return acc;
        acc[method] = endpointList
            .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
            .reduce<Record<string, unknown>>(
                (
                    group: Record<string, unknown>,
                    endpoint: { name: string; path?: string; children?: Record<string, string> },
                ) => {
                    if (endpoint.children) {
                        group[endpoint.name] = Object.keys(endpoint.children)
                            .sort((a: string, b: string) => a.localeCompare(b))
                            .reduce<Record<string, string>>((childGroup, childName) => {
                                childGroup[childName] = `/${version}${endpoint.children![childName]}`;
                                return childGroup;
                            }, {});
                    } else {
                        group[endpoint.name] = `/${version}${endpoint.path}`;
                    }
                    return group;
                },
                {},
            );
        return acc;
    }, {});

    res.jsonResponse({
        version,
        ...(env.DOCS_URL ? { documentation: `${env.DOCS_URL}/${version}` } : {}),
        endpoints,
    });
});

// GET asymmetric error
router.get('/:version/asymmetric', postOnly('asymmetric'));

// Generate an identicon or pixel-art avatar from a seed
router.get('/:version/avatar', (req: Request, res: Response) => {
    const avatarFn = (req.module as { avatar?: (opts: AvatarOptions) => AvatarResult }).avatar;
    if (!avatarFn) {
        error(res, 404, `Endpoint not available in ${req.version}.`);
        return;
    }
    const { seed, size, type, bg, format } = req.query;
    const parsedSize = size !== undefined ? parseInt(size as string, 10) : undefined;
    if (parsedSize !== undefined && isNaN(parsedSize)) {
        error(res, 400, 'Please provide a valid size (&size={50-2000})');
        return;
    }
    try {
        const { contentType, body } = avatarFn({
            seed: seed as string | undefined,
            size: parsedSize,
            type: type as string | undefined,
            bg: bg as string | undefined,
            format: format as string | undefined,
        });
        res.type(contentType).send(body);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

/**
 * Reads a plain decimal number from a query value, so hexadecimal and exponent forms are refused.
 *
 * @param value - Raw query value
 * @returns The number, NaN for anything that is not a plain decimal of at most three digits and two decimals, or
 * undefined when the parameter is absent
 */
function decimal(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    return typeof value === 'string' && /^\d{1,3}(\.\d{1,2})?$/.test(value) ? Number(value) : NaN;
}

// Generate a badge as an SVG image
router.get('/:version/badge', (req: Request, res: Response) => {
    const badgeFn = (req.module as { badge?: (opts: BadgeOptions) => BadgeResult }).badge;
    if (!badgeFn) {
        error(res, 404, `Endpoint not available in ${req.version}.`);
        return;
    }
    const { label, icon, trail, start, end, ink, message, messageStart, messageEnd, messageInk } = req.query;
    const { border, size, font, weight, lift, radius, angle } = req.query;
    try {
        const { contentType, body } = badgeFn({
            label: label as string,
            icon: icon as string | undefined,
            trail: trail as string | undefined,
            start: start as string | undefined,
            end: end as string | undefined,
            ink: ink as string | undefined,
            message: message as string | undefined,
            messageStart: messageStart as string | undefined,
            messageEnd: messageEnd as string | undefined,
            messageInk: messageInk as string | undefined,
            border: border as string | undefined,
            size: size as string | undefined,
            font: font as string | undefined,
            weight: weight as string | undefined,
            lift: decimal(lift),
            radius: decimal(radius),
            angle: decimal(angle),
        });
        // The image only depends on the query string, so it can be cached by browsers and proxies alike
        res.set({
            'Cache-Control': 'public, max-age=86400',
            'Content-Security-Policy': "default-src 'none'",
        })
            .type(contentType)
            .send(body);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Generate a barcode image
router.get('/:version/barcode', (req: Request, res: Response) => {
    const barcodeFn = (req.module as { barcode?: (opts: BarcodeOptions) => BarcodeResult }).barcode;
    if (!barcodeFn) {
        error(res, 404, `Endpoint not available in ${req.version}.`);
        return;
    }
    const { data, type, width, height, format, color, bg } = req.query;
    if (!data) {
        error(res, 400, 'Please provide data to encode (?data={string})');
        return;
    }
    const parsedWidth = width !== undefined ? parseInt(width as string, 10) : undefined;
    const parsedHeight = height !== undefined ? parseInt(height as string, 10) : undefined;
    if ((parsedWidth !== undefined && isNaN(parsedWidth)) || (parsedHeight !== undefined && isNaN(parsedHeight))) {
        error(res, 400, 'Please provide valid dimensions (&width={px}&height={px})');
        return;
    }
    try {
        const { contentType, body } = barcodeFn({
            data: data as string,
            type: type as string | undefined,
            width: parsedWidth,
            height: parsedHeight,
            format: format as string | undefined,
            color: color as string | undefined,
            bg: bg as string | undefined,
        });
        res.type(contentType).send(body);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Generate captcha
router.get('/:version/captcha', (req: Request, res: Response) => {
    try {
        const mode = (req.query.mode as string | undefined) ?? (since(req.version, 6) ? 'challenge' : 'image');
        if (mode !== 'image' && mode !== 'challenge') {
            error(res, 400, 'Mode must be one of: image, challenge');
            return;
        }

        const challenge = mode === 'challenge';
        if (challenge && !since(req.version, 5)) {
            error(res, 404, `Challenge mode not available in ${req.version}.`);
            return;
        }
        if (challenge && req.query.text) {
            error(res, 400, 'A custom text cannot be used in challenge mode');
            return;
        }

        const options: CaptchaOptions = {
            text: req.query.text as string | undefined,
            length: req.query.length ? Number(req.query.length) : undefined,
            width: req.query.width ? Number(req.query.width) : undefined,
            height: req.query.height ? Number(req.query.height) : undefined,
            noise: req.query.noise as CaptchaOptions['noise'],
            bg: req.query.bg as string | undefined,
            color: req.query.color as string | undefined,
        };

        if (challenge) {
            const challengeFn = (req.module as { captchaChallenge: (o: CaptchaOptions) => CaptchaChallenge })
                .captchaChallenge;
            const result = challengeFn(options);
            res.set('X-Captcha-Token', result.token);
            res.type('png').send(result.body);
            return;
        }

        const captchaFn = req.module.captcha as (o: CaptchaOptions) => CaptchaResult;
        const result = captchaFn(options);
        res.set('X-Captcha-Text', result.text);
        res.type('png').send(result.body);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// GET chart error
router.get('/:version/chart', postOnly('chart'));

// Display stored data
router.get('/:version/chat', (req: Request, res: Response) => {
    try {
        const messages = req.module.chat('fetch', {
            username: `reader:${req.ip ?? 'unknown'}`,
            storage: chatStorage,
        });
        res.jsonResponse(messages);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// GET private chat error
router.get('/:version/chat/private', postOnly('chat'));

// GET csv error
router.get('/:version/csv', postOnly('csv'));

// GET diff error
router.get('/:version/diff', postOnly('diff'));

// Hash a text, answered by the declared endpoint on POST
router.get('/:version/hash', postOnly('hash'));

// GET planning error
router.get('/:version/hyperplanning', postOnly('hyperplanning'));

// Display API informations
router.get('/:version/infos', (req: Request, res: Response) => {
    const endpoints = Object.values(versions[req.version]!.endpoints).flat();

    const paths = endpoints.flatMap((e) => (e.children ? Object.values(e.children) : e.path ? [e.path] : []));

    res.jsonResponse({
        endpoints: new Set(paths).size,
        last_version: Object.keys(versions).pop(),
        ...(env.DOCS_URL ? { documentation: env.DOCS_URL } : {}),
        ...(env.REPO_URL ? { github: env.REPO_URL } : {}),
        ...(env.INSTANCE_CREATED ? { creation: env.INSTANCE_CREATED } : {}),
    });
});

// GET jwt error
router.get('/:version/jwt', postOnly('jwt'));

// GET matrix error
router.get('/:version/matrix', postOnly('matrix'));

// GET otp error
router.get('/:version/otp', postOnly('otp'));

// Generate a password or passphrase
router.get('/:version/password', (req: Request, res: Response) => {
    const { type, length, uppercase, lowercase, digits, symbols, exclude, count, separator } = req.query;
    const { version } = req.params;

    const passwordFn = (
        req.module as { password?: (t: string, l: number, o: Record<string, unknown>) => PasswordResult }
    ).password;
    if (!passwordFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }

    const parseBool = (v: unknown, def: boolean): boolean => (v === undefined ? def : v !== 'false');

    try {
        const result = passwordFn(
            (type as string) ?? 'random',
            length !== undefined ? parseInt(length as string, 10) : 16,
            {
                uppercase: parseBool(uppercase, true),
                lowercase: parseBool(lowercase, true),
                digits: parseBool(digits, true),
                symbols: parseBool(symbols, false),
                exclude: (exclude as string) ?? '',
                count: count !== undefined ? parseInt(count as string, 10) : 1,
                separator: (separator as string) ?? '-',
            },
        );
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Generate a placeholder image or skeleton
router.get('/:version/placeholder', (req: Request, res: Response) => {
    const { type = 'image' } = req.query;
    const { version } = req.params;

    const placeholder = (
        req.module as {
            placeholder?: (
                t: string,
                q: Record<string, string | undefined>,
            ) => { type: string; contentType: string; body: Buffer | string };
        }
    ).placeholder;
    if (!placeholder) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }

    try {
        const result = placeholder(type as string, req.query as Record<string, string | undefined>);
        res.type(result.contentType).send(result.body);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Issue a proof-of-work challenge
router.get('/:version/pow', (req: Request, res: Response) => {
    const { difficulty } = req.query;
    const { version } = req.params;

    const powFn = (req.module as { pow?: (d?: number) => unknown }).pow;
    if (!powFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }

    try {
        const result = powFn(difficulty !== undefined ? Number(difficulty) : undefined);
        res.jsonResponse(result);
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// Generate QR Code
router.get('/:version/qrcode', async (req: Request, res: Response) => {
    const { url } = req.query;

    if (!url) {
        error(res, 400, 'Please provide a valid url (?url={URL})');
        return;
    }

    try {
        const qrcodeFn = req.module.qrcode as (o: QRCodeOptions) => Promise<QRCodeResult>;
        const result = await qrcodeFn({
            url: url as string,
            size: req.query.size ? Number(req.query.size) : undefined,
            margin: req.query.margin ? Number(req.query.margin) : undefined,
            correction: req.query.correction as QRCodeOptions['correction'],
            dark: req.query.dark as string | undefined,
            light: req.query.light as string | undefined,
            icon: req.query.icon as string | undefined,
            iconSize: req.query.iconSize ? Number(req.query.iconSize) : undefined,
            iconPadding: req.query.iconPadding ? Number(req.query.iconPadding) : undefined,
            iconRadius: req.query.iconRadius ? Number(req.query.iconRadius) : undefined,
            format: req.query.format as QRCodeOptions['format'],
        });
        if (result.contentType === 'application/json') {
            res.jsonResponse(result.body);
        } else {
            res.type(result.contentType).send(result.body);
        }
    } catch (err) {
        error(res, 400, (err as Error).message);
    }
});

// GET read error
router.get('/:version/read', postOnly('read'));

// GET symmetric error
router.get('/:version/symmetric', postOnly('symmetric'));

// GET tic-tac-toe errors
router.get('/:version/tic-tac-toe', postOnly('tic_tac_toe'));

router.get('/:version/tic-tac-toe/fetch', postOnly('tic_tac_toe'));

router.get('/:version/tic-tac-toe/list', postOnly('tic_tac_toe'));

// GET token error
router.get('/:version/token', postOnly('token'));

export default router;
