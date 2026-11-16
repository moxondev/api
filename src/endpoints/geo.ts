import { api, define } from './define.js';

// A coordinate counts as missing only when its key is absent: an empty value reaches the module, which reads it as 0
export default define({
    name: 'geo',
    method: 'get',
    path: '/geo',
    category: 'network',
    params: {
        lat1: { required: 'defined', type: 'number', missing: 'Please provide lat1, lon1, lat2 and lon2' },
        lon1: { required: 'defined', type: 'number', missing: 'Please provide lat1, lon1, lat2 and lon2' },
        lat2: { required: 'defined', type: 'number', missing: 'Please provide lat1, lon1, lat2 and lon2' },
        lon2: { required: 'defined', type: 'number', missing: 'Please provide lat1, lon1, lat2 and lon2' },
    },
    example: { lat1: '48.8566', lon1: '2.3522', lat2: '51.5074', lon2: '-0.1278' },
    run: ({ lat1, lon1, lat2, lon2 }, req) =>
        api(req).geo(lat1 as string, lon1 as string, lat2 as string, lon2 as string),
});
