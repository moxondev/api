import type { Request } from 'express';

import type * as modules from '../modules/v6.js';

export type Category = 'security' | 'text' | 'images' | 'compute' | 'fakeData' | 'network' | 'realtime';

export interface Param {
    required?: boolean | 'defined';
    missing?: string;
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    options?: readonly string[];
    default?: string;
}

export type Values<P extends string> = Record<P, unknown>;

export interface Endpoint<P extends string = string> {
    name: string;
    method: 'get' | 'post';
    path: string;
    category: Category;
    since?: number;
    until?: number;
    params: Record<P, Param>;
    example: Partial<Record<P, unknown>>;
    run(values: Values<P>, req: Request): unknown;
}

/**
 * Error that carries the status of the answer, for the endpoints that refuse with something other than a 400.
 */
export class HttpError extends Error {
    status: number;

    /**
     * Builds the error.
     *
     * @param status - HTTP status of the answer
     * @param message - Message sent in the body of the answer
     */
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/**
 * Result of an endpoint that answers with a status other than 200.
 */
export class Reply {
    body: unknown;
    status: number;

    /**
     * Builds the reply.
     *
     * @param body - Value sent as the JSON body
     * @param status - HTTP status of the answer
     */
    constructor(body: unknown, status: number) {
        this.body = body;
        this.status = status;
    }
}

/**
 * Declares an endpoint contract and infers its parameter names, so `run` receives typed values.
 * The HTTP router and the documentation manifest are both built from it, so the two cannot drift apart.
 *
 * @param endpoint - Contract of the route: `since` and `until` are the first and the last API version serving it
 * (all of them when omitted), `params` are read from the query string on GET and from the JSON body on POST,
 * `example` is the input the documentation runs to show a real output, and an error thrown by `run` becomes a 400
 * carrying its message, or the status of an HttpError
 * @returns The same contract, typed with its parameter names
 */
export function define<P extends string>(endpoint: Endpoint<P>): Endpoint<P> {
    return endpoint;
}

/**
 * Gives a contract the modules of the version being served, so that it follows the overrides of every version.
 * A contract must never import a module itself: that would freeze it on one version and make the manifest load
 * the native libraries.
 *
 * @param req - Request the contract is run for
 * @returns The modules of the requested version, typed as the latest one
 */
export function api(req: Request): typeof modules {
    return req.module as typeof modules;
}
