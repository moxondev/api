import { api, define } from './define.js';

// The module only exists from v5: v4 answers that the endpoint is not available
export default define({
    name: 'url',
    method: 'get',
    path: '/url',
    category: 'network',
    since: 5,
    params: {
        url: { required: true, type: 'string', missing: 'Please provide a URL (?url={URL})' },
    },
    example: { url: 'https://user:pass@example.com:8080/path/to/page?query=1&lang=fr#section' },
    run: ({ url }, req) => {
        // A repeated key arrives as an array, which is as missing as an empty value
        if (!url || typeof url !== 'string') throw new Error('Please provide a URL (?url={URL})');
        return api(req).parseUrl(url);
    },
});
