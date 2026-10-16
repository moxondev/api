import type { Category, Param } from './endpoints/define.js';
import { endpoints } from './endpoints/index.js';

export interface ManifestEntry {
    name: string;
    method: 'get' | 'post';
    path: string;
    category: Category;
    since?: number;
    params: Record<string, Param>;
    example: Record<string, string>;
}

// Declared endpoints without their run function, for the documentation sidebar, parameter lists and playground
export const manifest: ManifestEntry[] = endpoints.map(({ name, method, path, category, since, params, example }) => ({
    name,
    method,
    path,
    category,
    ...(since ? { since } : {}),
    params,
    example: example as Record<string, string>,
}));
