import * as chrono from 'chrono-node';

const TIME_OF_DAY_DEFAULTS: Record<string, { h: number; m: number }> = {
  morning: { h: 9, m: 0 },
  afternoon: { h: 14, m: 0 },
  evening: { h: 18, m: 0 },
  night: { h: 21, m: 0 }
};

export function parseNaturalTime(expression: string | null | undefined, now: Date = new Date()): Date | null {
  if (!expression) return null;
  const text = expression.trim().toLowerCase();
  if (!text) return null;

  // Pure time-of-day expressions like "tomorrow morning" or "this evening".
  const todayMatch = text.match(/^(this|today)\s+(morning|afternoon|evening|night)$/);
  const tomorrowMatch = text.match(/^tomorrow\s+(morning|afternoon|evening|night)$/);
  const bareTod = text.match(/^(morning|afternoon|evening|night)$/);

  const applyTod = (base: Date, tod: string) => {
    const def = TIME_OF_DAY_DEFAULTS[tod];
    const d = new Date(base);
    d.setHours(def.h, def.m, 0, 0);
    return d;
  };

  if (bareTod) return applyTod(now, bareTod[1]);
  if (todayMatch) return applyTod(now, todayMatch[2]);
  if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return applyTod(d, tomorrowMatch[1]);
  }

  // chrono mis-parses "day after tomorrow" as +1 day. Handle it (and an optional time-of-day) explicitly.
  const datMatch = text.match(/^(?:the\s+)?day\s+after\s+tomorrow(?:\s+(morning|afternoon|evening|night|at\s+.+))?$/);
  if (datMatch) {
    const base = new Date(now);
    base.setDate(base.getDate() + 2);
    const tail = datMatch[1];
    if (!tail) {
      base.setHours(9, 0, 0, 0);
      return base;
    }
    if (TIME_OF_DAY_DEFAULTS[tail]) return applyTod(base, tail);
    // "at <time>" — let chrono resolve just the time part against our shifted base.
    const timePart = tail.replace(/^at\s+/, '');
    const parsedTime = chrono.parseDate(timePart, base, { forwardDate: false });
    return parsedTime ?? base;
  }

  const parsed = chrono.parseDate(expression, now, { forwardDate: true });
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
  night: { start: { h: 21, m: 0 }, end: { h: 28, m: 59 } } // wraps to 04:59 next day
};

export function dayWindow(base: Date): { start: Date; end: Date } {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function resolveDateFilter(
  filter: 'today' | 'tomorrow' | 'this_week' | 'all' | undefined,
  now: Date = new Date()
): { start: Date; end: Date } | null {
  if (!filter || filter === 'all') return null;
  if (filter === 'today') return dayWindow(now);
  if (filter === 'tomorrow') {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return dayWindow(t);
  }
  if (filter === 'this_week') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  return null;
}
