import { api, define } from './define.js';

// The module is served in every version, even though the v6 list of documented endpoints leaves it out
export default define({
    name: 'hyperplanning',
    method: 'post',
    path: '/hyperplanning',
    category: 'network',
    params: {
        url: { required: true, type: 'string', missing: 'Please provide a valid ICS file URL (?url={URL})' },
        detail: { type: 'string', options: ['list', 'full'], default: 'summary' },
    },
    example: { url: 'https://example.com/planning.ics', detail: 'list' },
    run: ({ url, detail }, req) => api(req).hyperplanning(url as string, detail as string | undefined),
});
