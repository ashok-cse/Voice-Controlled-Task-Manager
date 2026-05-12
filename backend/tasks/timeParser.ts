import * as chrono from 'chrono-node';
import type { ParsingReference } from 'chrono-node';
import { DateTime } from 'luxon';

const TIME_OF_DAY_DEFAULTS: Record<string, { h: number; m: number }> = {
  morning: { h: 9, m: 0 },
  afternoon: { h: 14, m: 0 },
  evening: { h: 18, m: 0 },
  night: { h: 21, m: 0 }
};

function chronoRef(instant: Date, timeZone: string): ParsingReference {
  return { instant, timezone: timeZone };
}

export function parseNaturalTime(
  expression: string | null | undefined,
  refInstant: Date,
  timeZone: string
): Date | null {
  if (!expression) return null;
  const trimmed = expression.trim();
  const text = trimmed.toLowerCase();
  if (!text) return null;

  const tz = timeZone || 'UTC';
  const ref = DateTime.fromJSDate(refInstant).setZone(tz);

  const applyTod = (dayStartInZone: DateTime, tod: string) => {
    const def = TIME_OF_DAY_DEFAULTS[tod];
    return dayStartInZone.set({ hour: def.h, minute: def.m, second: 0, millisecond: 0 }).toUTC().toJSDate();
  };

  const todayMatch = text.match(/^(this|today)\s+(morning|afternoon|evening|night)$/);
  const tomorrowMatch = text.match(/^tomorrow\s+(morning|afternoon|evening|night)$/);
  const bareTod = text.match(/^(morning|afternoon|evening|night)$/);

  if (bareTod) return applyTod(ref.startOf('day'), bareTod[1]);
  if (todayMatch) return applyTod(ref.startOf('day'), todayMatch[2]);
  if (tomorrowMatch) return applyTod(ref.plus({ days: 1 }).startOf('day'), tomorrowMatch[2]);

  const datMatch = text.match(/^(?:the\s+)?day\s+after\s+tomorrow(?:\s+(morning|afternoon|evening|night|at\s+.+))?$/);
  if (datMatch) {
    const baseDay = ref.plus({ days: 2 }).startOf('day');
    const tail = datMatch[1];
    if (!tail) {
      return baseDay.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toUTC().toJSDate();
    }
    if (TIME_OF_DAY_DEFAULTS[tail]) return applyTod(baseDay, tail);
    const timePart = tail.replace(/^at\s+/, '');
    const baseInstant = baseDay.toUTC().toJSDate();
    const parsedTime = chrono.parseDate(timePart, chronoRef(baseInstant, tz), { forwardDate: false });
    return parsedTime ?? baseInstant;
  }

  const parsed = chrono.parseDate(trimmed, chronoRef(refInstant, tz), { forwardDate: true });
  return parsed ?? null;
}

export interface TimeOfDayRange {
  start: { h: number; m: number };
  end: { h: number; m: number };
}

export const TIME_OF_DAY_RANGES: Record<string, TimeOfDayRange> = {
  morning: { start: { h: 5, m: 0 }, end: { h: 11, m: 59 } },
  afternoon: { start: { h: 12, m: 0 }, end: { h: 16, m: 59 } },
  evening: { start: { h: 17, m: 0 }, end: { h: 20, m: 59 } },
  night: { start: { h: 21, m: 0 }, end: { h: 28, m: 59 } }
};

export function resolveDateFilter(
  filter: 'today' | 'tomorrow' | 'this_week' | 'all' | undefined,
  refInstant: Date,
  timeZone: string
): { start: Date; end: Date } | null {
  if (!filter || filter === 'all') return null;
  const ref = DateTime.fromJSDate(refInstant).setZone(timeZone || 'UTC');
  if (filter === 'today') {
    const start = ref.startOf('day');
    return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate() };
  }
  if (filter === 'tomorrow') {
    const start = ref.plus({ days: 1 }).startOf('day');
    return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate() };
  }
  if (filter === 'this_week') {
    const start = ref.startOf('day');
    return { start: start.toUTC().toJSDate(), end: start.plus({ days: 7 }).toUTC().toJSDate() };
  }
  return null;
}
