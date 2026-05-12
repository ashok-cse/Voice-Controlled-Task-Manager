import type { ConversationContext, Task, TaskTarget } from '../types';
import { parseNaturalTime } from './timeParser';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(' ').filter((t) => t.length > 2));
  const tb = new Set(normalize(b).split(' ').filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits += 1;
  return hits / Math.max(ta.size, tb.size);
}

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  '1st': 1,
  '2nd': 2,
  '3rd': 3
};

export interface MatchResult {
  matches: Task[];
  ambiguous: boolean;
  reason: 'exact' | 'partial' | 'time' | 'context' | 'ordinal' | 'none';
}

export function matchTasks(
  target: TaskTarget | undefined,
  allTasks: Task[],
  context: ConversationContext,
  now: Date = new Date()
): MatchResult {
  if (!target) return { matches: [], ambiguous: false, reason: 'none' };

  // 1. Direct ID.
  if (target.taskId) {
    const t = allTasks.find((x) => x.id === target.taskId);
    return { matches: t ? [t] : [], ambiguous: false, reason: 'exact' };
  }

  // 2. Search text — try this BEFORE context refs so "this <title>" still wins.
  const search = target.searchText?.trim();
  let candidates: Task[] = [];
  let reason: MatchResult['reason'] = 'none';
  if (search) {
    const n = normalize(search);
    const exact = allTasks.filter((t) => normalize(t.title) === n);
    if (exact.length) {
      candidates = exact;
      reason = 'exact';
    } else {
      const partial = allTasks.filter(
        (t) => normalize(t.title).includes(n) || n.includes(normalize(t.title))
      );
      if (partial.length) {
        candidates = partial;
        reason = 'partial';
      } else {
        const scored = allTasks
          .map((t) => ({ t, score: tokenOverlap(t.title, search) }))
          .filter((x) => x.score >= 0.4)
          .sort((a, b) => b.score - a.score);
        candidates = scored.map((x) => x.t);
        if (candidates.length) reason = 'partial';
      }
    }
  }

  // 3. Context reference — only when search produced nothing (or no search at all).
  const ctxRef = target.contextReference;
  const ordinal =
    target.ordinal ??
    (ctxRef && ORDINALS[ctxRef] ? ORDINALS[ctxRef] : undefined);

  if (!candidates.length) {
    if (ctxRef === 'previous' || ctxRef === 'last' || ctxRef === 'that' || ctxRef === 'this') {
      // Prefer whatever the agent just acted on in the previous turn, since
      // "this/that" almost always refers to the most-recently-mentioned task.
      const lastIntent = context.lastAction?.intent;
      const orderedPools =
        lastIntent === 'READ_TASKS'
          ? [context.lastListedTaskIds, context.lastCreatedTaskIds, context.lastUpdatedTaskIds]
          : lastIntent === 'CREATE_TASK'
            ? [context.lastCreatedTaskIds, context.lastListedTaskIds, context.lastUpdatedTaskIds]
            : lastIntent === 'UPDATE_TASK' || lastIntent === 'COMPLETE_TASK'
              ? [context.lastUpdatedTaskIds, context.lastListedTaskIds, context.lastCreatedTaskIds]
              : [context.lastListedTaskIds, context.lastCreatedTaskIds, context.lastUpdatedTaskIds];

      let resolved: Task | undefined;
      for (const pool of orderedPools) {
        for (let i = pool.length - 1; i >= 0; i--) {
          const t = allTasks.find((x) => x.id === pool[i]);
          if (t) {
            resolved = t;
            break;
          }
        }
        if (resolved) break;
      }
      // If still nothing and only one pending task exists, that's almost certainly "this".
      if (!resolved) {
        const pending = allTasks.filter((t) => t.status === 'pending');
        if (pending.length === 1) resolved = pending[0];
      }
      if (resolved) {
        candidates = [resolved];
        reason = 'context';
      }
    }

    if (!candidates.length && ordinal && context.lastListedTaskIds.length >= ordinal) {
      const id = context.lastListedTaskIds[ordinal - 1];
      const t = allTasks.find((x) => x.id === id);
      if (t) {
        candidates = [t];
        reason = 'ordinal';
      }
    }
  }

  // 4. Time expression filter.
  if (target.timeExpression && candidates.length !== 1) {
    const when = parseNaturalTime(target.timeExpression, now);
    if (when) {
      const tolMs = 30 * 60 * 1000;
      const pool = candidates.length ? candidates : allTasks;
      const byTime = pool.filter((t) => {
        if (!t.scheduledAt) return false;
        const d = new Date(t.scheduledAt).getTime();
        return Math.abs(d - when.getTime()) <= tolMs;
      });
      if (byTime.length) {
        candidates = byTime;
        reason = candidates.length === 1 ? 'time' : reason || 'time';
      }
    }
  }

  // 5. hasTime disambiguator — "the one without time" / "the timed one".
  if (target.hasTime && candidates.length > 1) {
    const want = target.hasTime;
    const filtered = candidates.filter((t) =>
      want === 'no' ? !t.scheduledAt : !!t.scheduledAt
    );
    if (filtered.length) candidates = filtered;
  }

  if (!candidates.length) return { matches: [], ambiguous: false, reason: 'none' };

  return {
    matches: candidates,
    ambiguous: candidates.length > 1,
    reason
  };
}

export function describeTaskForVoice(t: Task, now: Date = new Date()): string {
  if (!t.scheduledAt) return t.title;
  const d = new Date(t.scheduledAt);
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: d.getMinutes() ? '2-digit' : undefined,
    hour12: true
  });
  const startOfDay = (x: Date) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c.getTime();
  };
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  let dayLabel = '';
  if (dayDiff === 0) dayLabel = '';
  else if (dayDiff === 1) dayLabel = 'tomorrow ';
  else if (dayDiff === -1) dayLabel = 'yesterday ';
  else if (dayDiff > 1 && dayDiff < 7) {
    dayLabel = `${d.toLocaleDateString('en-US', { weekday: 'long' })} `;
  } else {
    dayLabel = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} `;
  }
  return `${t.title} ${dayLabel}at ${time}`.replace(/\s+/g, ' ');
}
