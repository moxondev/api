import ical from 'ical.js';

import { ICS_FETCH_TIMEOUT, MAX_ICS_BYTES, MAX_ICS_EVENTS } from '../../constants.js';
import { formatDate } from '../../utils/helpers.js';
import { fetchRemote, type RemoteFetcher } from '../../utils/remote.js';

interface CalendarEvent {
    summary: string[] | string;
    subject?: string;
    teacher?: string;
    classes?: string[];
    type?: string;
    start: string;
    end: string;
}

/**
 * Fetches and parses an ICS calendar from a Hyperplanning URL, filtering out past events.
 *
 * @param url - HTTPS URL to the ICS calendar
 * @param detail - Level of detail: "full" (subject/teacher/classes), "list" (summary/times), or default (summary only)
 * @returns Array of calendar events sorted by start time, excluding past events
 * @throws Error if the URL is invalid, uses HTTP, points to a private host, or does not return a valid ICS file
 */
export default function hyperplanning(url: string, detail?: string): Promise<CalendarEvent[]> {
    return fetchCalendar(url, detail, fetchRemote);
}

/**
 * Same as hyperplanning, with the remote fetch implementation passed in so tests can replace it.
 *
 * @param url - HTTPS URL to the ICS calendar
 * @param detail - Level of detail: "full" (subject/teacher/classes), "list" (summary/times), or default (summary only)
 * @param fetcher - Remote fetch implementation, fetchRemote in production
 * @returns Array of calendar events sorted by start time, excluding past events
 * @throws Error if the URL is invalid or internal, the file is too large or has too many events, or is not an ICS file
 */
export async function fetchCalendar(
    url: string,
    detail: string | undefined,
    fetcher: RemoteFetcher,
): Promise<CalendarEvent[]> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('Invalid URL.');
    }

    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed.');

    const body = await fetcher(url, {
        maxBytes: MAX_ICS_BYTES,
        timeout: ICS_FETCH_TIMEOUT,
        messages: { size: 'ICS file must be under 1MB.' },
        check: ({ ok, contentType }) => {
            if (!ok || !contentType.includes('text/calendar')) throw new Error('Invalid ICS file format.');
        },
    });

    const vevents = new ical.Component(ical.parse(new TextDecoder().decode(body))).getAllSubcomponents('vevent');
    if (vevents.length > MAX_ICS_EVENTS) throw new Error(`ICS file must have at most ${MAX_ICS_EVENTS} events.`);

    const events: CalendarEvent[] = vevents
        .map((e: ical.Component) => {
            // Without an exception list, ical.js scans every sibling event for each one (quadratic)
            const evt = new ical.Event(e, { exceptions: [] });
            const summary = (evt.summary || '').split(' ').filter((part: string) => part !== '-');
            const start = formatDate(evt.startDate.toJSDate());
            const end = formatDate(evt.endDate.toJSDate());

            if (detail === 'full') {
                const desc = (evt.description || '').split('\n').map((l: string) => l.trim());
                const extract = (p: string) => (desc.find((l: string) => l.startsWith(p)) || '').replace(p, '').trim();

                return {
                    summary,
                    subject: extract('Matière :'),
                    teacher: extract('Enseignant :'),
                    classes: extract('Promotions :')
                        .split(', ')
                        .map((c: string) => c.trim()),
                    type: extract('Salle :') || undefined,
                    start,
                    end,
                };
            }

            if (detail === 'list') return { summary, start, end };

            return {
                summary: evt.summary || '',
                start,
                end,
            };
        })
        .sort((a: CalendarEvent, b: CalendarEvent) => new Date(a.start).getTime() - new Date(b.start).getTime())
        .filter((e: CalendarEvent) => new Date(e.end) >= new Date());

    return events;
}
