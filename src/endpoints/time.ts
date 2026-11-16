import { api, define } from './define.js';

export default define({
    name: 'time',
    method: 'get',
    path: '/time',
    category: 'compute',
    params: {
        type: { type: 'string', options: ['live', 'random', 'countdown'], default: 'live' },
        start: { type: 'string' },
        end: { type: 'string' },
        format: {
            type: 'string',
            options: [
                'iso',
                'utc',
                'timestamp',
                'locale',
                'date',
                'time',
                'year',
                'month',
                'day',
                'hour',
                'minute',
                'second',
                'ms',
                'dayOfWeek',
                'dayOfYear',
                'weekNumber',
                'timezone',
                'timezoneOffset',
            ],
        },
        timezone: {
            type: 'string',
            options: ['UTC', 'America/New_York', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'],
        },
        target: { type: 'string' },
    },
    example: { type: 'live', format: 'iso', timezone: 'Europe/Paris' },
    run: ({ type, start, end, format, timezone, target }, req) =>
        api(req).time(
            (type ?? 'live') as string,
            start as string | undefined,
            end as string | undefined,
            format as string | undefined,
            timezone as string | undefined,
            target as string | undefined,
        ),
});
