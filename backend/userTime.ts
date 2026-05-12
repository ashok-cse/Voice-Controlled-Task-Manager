import { DateTime } from 'luxon';

/** Normalize client IANA zone (e.g. from Intl). Invalid strings fall back to UTC. */
export function resolveUserTimeZone(input: string | undefined): string {
  const tz = typeof input === 'string' ? input.trim() : '';
  if (!tz) return 'UTC';
  const probe = DateTime.now().setZone(tz);
  return probe.isValid ? tz : 'UTC';
}

/** Assistant-facing date/time string in the user's zone (matches browser Task list). */
export function formatSpeechDateTime(isoOrDate: string | Date, timeZone: string): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    month: 'short',
    day: 'numeric'
  }).format(d);
}
