import { DEFAULT_USER_ID } from '../db';
import type {
  AgentAction,
  AgentCommandResponse,
  ConversationContext,
  ParsedTaskInput,
  PendingConfirmation,
  PendingDraft,
  RepeatSpec,
  Task
} from '../types';
import {
  createTask,
  deleteTask,
  findDuplicateTask,
  getContext,
  getTasksByIds,
  listAllTasks,
  listTasksByFilter,
  saveContext,
  updateTask
} from './taskStore';
import { describeTaskForVoice, matchTasks } from './taskMatcher';
import { parseNaturalTime } from './timeParser';

function isNonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

function mergeDraft(draft: PendingDraft | null, input: ParsedTaskInput): ParsedTaskInput {
  if (!draft) return input;
  return {
    title: isNonEmpty(input.title) ? input.title : (draft.title ?? ''),
    timeExpression: input.timeExpression ?? draft.timeExpression ?? null,
    priority: input.priority ?? draft.priority ?? 'normal'
  };
}

function normalizeRepeat(repeat: RepeatSpec | undefined): RepeatSpec | null {
  if (!repeat) return null;
  const count = Math.max(1, Math.min(60, Math.floor(repeat.count)));
  if (count <= 1) return null;
  const unit = repeat.unit === 'week' ? 'week' : 'day';
  return { count, unit };
}

function shiftDate(iso: string, steps: number, unit: 'day' | 'week'): string {
  const d = new Date(iso);
  const days = unit === 'week' ? steps * 7 : steps;
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function materializeRepeats(
  base: { title: string; scheduledAt: string; timeLabel: string | null; priority: Task['priority'] },
  repeat: RepeatSpec,
  userId: string
): Promise<Task[]> {
  const created: Task[] = [];
  for (let i = 1; i < repeat.count; i++) {
    const scheduledAt = shiftDate(base.scheduledAt, i, repeat.unit);
    const existing = await findDuplicateTask(base.title, scheduledAt, userId);
    if (existing) continue;
    const t = await createTask(
      {
        title: base.title,
        scheduledAt,
        timeLabel: base.timeLabel,
        priority: base.priority
      },
      userId
    );
    created.push(t);
  }
  return created;
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function countWord(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function filterScope(
  filters: { date?: string; status?: string; timeOfDay?: string } | undefined
): string {
  const parts: string[] = [];
  if (filters?.status && filters.status !== 'all') parts.push(filters.status);
  if (filters?.timeOfDay) parts.push(filters.timeOfDay);
  if (filters?.date === 'today') parts.push('for today');
  else if (filters?.date === 'tomorrow') parts.push('for tomorrow');
  else if (filters?.date === 'this_week') parts.push('this week');
  return parts.join(' ');
}

function summarizeAgenda(
  tasks: Task[],
  filters: { date?: string; status?: string; timeOfDay?: string } | undefined,
  fallbackTasks: Task[] = []
): string {
  const scope = filterScope(filters);
  if (!tasks.length) {
    const head = scope ? `You have no ${scope} tasks` : 'You have no tasks';
    // Surface the actual tasks the user does have, with their times.
    if (fallbackTasks.length && (filters?.timeOfDay || filters?.date)) {
      const items = fallbackTasks.slice(0, 5).map(describeTaskForVoice);
      const count =
        fallbackTasks.length === 1
          ? 'one pending task'
          : `${countWord(fallbackTasks.length)} pending tasks`;
      const extra =
        fallbackTasks.length > 5
          ? ` ${joinList(items)}, and ${countWord(fallbackTasks.length - 5)} more.`
          : `: ${joinList(items)}.`;
      return `${head}, but you have ${count}${extra}`;
    }
    return `${head}.`;
  }
  const items = tasks.map(describeTaskForVoice);
  const head =
    tasks.length === 1
      ? `You have one ${scope || ''} task`.replace(/\s+/g, ' ').trim()
      : `You have ${countWord(tasks.length)} ${scope || ''} tasks`.replace(/\s+/g, ' ').trim();
  return `${head}: ${joinList(items)}.`;
}

export async function executeAction(
  rawAction: AgentAction,
  now: Date = new Date(),
  userId: string = DEFAULT_USER_ID
): Promise<AgentCommandResponse> {
  let action = rawAction;
  const ctx = await getContext(userId);

  // ---- CONFIRM / CANCEL pending action -----------------------------------
  if (action.intent === 'CONFIRM_ACTION') {
    if (!ctx.pendingConfirmation) {
      return finalize(
        ctx,
        action,
        [],
        [],
        "There's nothing waiting for confirmation right now.",
        undefined,
        userId
      );
    }
    const pending = ctx.pendingConfirmation;
    ctx.pendingConfirmation = null;

    if (pending.type === 'DELETE_TASK') {
      const deleted: string[] = [];
      const before = await getTasksByIds(pending.taskIds, userId);
      for (const id of pending.taskIds) {
        const ok = await deleteTask(id, userId);
        if (ok) deleted.push(id);
      }
      // Drop stale references to anything that just got deleted.
      const gone = new Set(deleted);
      ctx.lastListedTaskIds = ctx.lastListedTaskIds.filter((id) => !gone.has(id));
      ctx.lastCreatedTaskIds = ctx.lastCreatedTaskIds.filter((id) => !gone.has(id));
      ctx.lastUpdatedTaskIds = ctx.lastUpdatedTaskIds.filter((id) => !gone.has(id));
      const names = before.map((t) => `"${t.title}"`);
      let msg: string;
      if (!deleted.length) {
        msg = "I couldn't find that task anymore.";
      } else if (deleted.length === 1) {
        msg = `Deleted ${names[0]}.`;
      } else if (deleted.length <= 3) {
        msg = `Deleted ${countWord(deleted.length)} tasks: ${joinList(names)}.`;
      } else {
        msg = `Deleted ${countWord(deleted.length)} tasks.`;
      }
      return finalize(ctx, action, [], deleted, msg, undefined, userId);
    }

    if (pending.type === 'UPDATE_TASK') {
      // Re-run update from the stored proposed action.
      const proposed = pending.proposedAction;
      const result = await applyUpdate(proposed, ctx, now, true, userId);
      return result;
    }
  }

  if (action.intent === 'CANCEL_ACTION') {
    ctx.pendingConfirmation = null;
    ctx.pendingDraft = null;
    return finalize(ctx, action, [], [], 'Okay, cancelled.', undefined, userId);
  }

  // ---- CREATE -------------------------------------------------------------
  if (action.intent === 'CREATE_TASK') {
    const rawInputs = action.tasks ?? [];

    // Merge the standing draft into the first task if one is active and the
    // user is continuing the conversation (single-task slot filling).
    const draft = ctx.pendingDraft;
    let inputs: ParsedTaskInput[];
    if (draft && rawInputs.length <= 1) {
      const merged = mergeDraft(draft, rawInputs[0] ?? { title: '' });
      inputs = [merged];
    } else {
      inputs = rawInputs;
    }

    const valid = inputs.filter((t) => isNonEmpty(t?.title));
    if (!valid.length) {
      // Save whatever slots we have so the next turn can complete them.
      const partial = inputs[0] ?? {};
      ctx.pendingDraft = {
        intent: 'CREATE_TASK',
        title: isNonEmpty(partial.title) ? partial.title : null,
        timeExpression: partial.timeExpression ?? draft?.timeExpression ?? null,
        priority: partial.priority ?? draft?.priority ?? null
      };
      const prompt = ctx.pendingDraft.timeExpression
        ? `What task should I create for ${ctx.pendingDraft.timeExpression}?`
        : 'What task should I create?';
      return finalize(ctx, action, [], [], prompt, undefined, userId);
    }

    const created: Task[] = [];
    const duplicates: Task[] = [];
    for (const t of valid) {
      const title = t.title.trim();
      const when = parseNaturalTime(t.timeExpression ?? null, now);
      const scheduledAt = when ? when.toISOString() : null;

      const existing = await findDuplicateTask(title, scheduledAt, userId);
      if (existing) {
        duplicates.push(existing);
        continue;
      }
      const task = await createTask(
        {
          title,
          scheduledAt,
          timeLabel: t.timeExpression ?? null,
          priority: t.priority ?? 'normal'
        },
        userId
      );
      created.push(task);
    }

    const repeat = normalizeRepeat(action.repeat);
    let repeated: Task[] = [];
    if (repeat) {
      const seeds = created.length ? created : duplicates;
      for (const seed of seeds) {
        if (!seed.scheduledAt) continue;
        const more = await materializeRepeats(
          {
            title: seed.title,
            scheduledAt: seed.scheduledAt,
            timeLabel: seed.timeLabel ?? null,
            priority: seed.priority
          },
          repeat,
          userId
        );
        repeated = repeated.concat(more);
      }
    }

    ctx.pendingDraft = null;
    ctx.lastCreatedTaskIds = [...created, ...repeated].map((c) => c.id);

    let speak: string;
    if (repeat && repeated.length) {
      const base = (created[0] ?? duplicates[0])?.title ?? 'task';
      speak = `Done. "${base}" is now scheduled ${repeat.count} ${
        repeat.unit === 'week' ? 'weeks' : 'days'
      } in a row.`;
    } else if (created.length && duplicates.length) {
      speak = `${summarizeCreated(created)} I skipped ${joinList(
        duplicates.map((d) => `"${d.title}"`)
      )} since ${duplicates.length === 1 ? 'it already exists' : 'they already exist'}.`;
    } else if (!created.length && duplicates.length) {
      speak = `"${duplicates[0].title}" is already on your list${
        duplicates[0].scheduledAt
          ? ` for ${new Date(duplicates[0].scheduledAt).toLocaleString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              month: 'short',
              day: 'numeric'
            })}`
          : ''
      }.`;
    } else {
      speak = action.responseText?.trim() || summarizeCreated(created);
    }

    const allAffected = [...created, ...repeated, ...duplicates];
    return finalize(
      ctx,
      action,
      allAffected,
      allAffected.map((c) => c.id),
      speak,
      undefined,
      userId
    );
  }

  // ---- REPEAT (extend existing task into recurring) -----------------------
  if (action.intent === 'REPEAT_TASK') {
    ctx.pendingDraft = null;
    const repeat = normalizeRepeat(action.repeat);
    if (!repeat) {
      return finalize(ctx, action, [], [], 'How many days should I repeat it for?', undefined, userId);
    }
    const all = await listAllTasks(userId);
    const { matches, ambiguous } = matchTasks(action.target, all, ctx, now);
    if (!matches.length) {
      return finalize(ctx, action, [], [], "I couldn't find that task to repeat.", undefined, userId);
    }
    if (ambiguous) {
      const opts = matches.slice(0, 3).map(describeTaskForVoice);
      return finalize(
        ctx,
        action,
        matches,
        matches.map((t) => t.id),
        `I found a few matches: ${joinList(opts)}. Which one should I repeat?`,
        undefined,
        userId
      );
    }
    const seed = matches[0];
    if (!seed.scheduledAt) {
      return finalize(
        ctx,
        action,
        [seed],
        [seed.id],
        `"${seed.title}" has no scheduled time, so I can't repeat it. Set a time first.`,
        undefined,
        userId
      );
    }
    const repeated = await materializeRepeats(
      {
        title: seed.title,
        scheduledAt: seed.scheduledAt,
        timeLabel: seed.timeLabel ?? null,
        priority: seed.priority
      },
      repeat,
      userId
    );
    ctx.lastCreatedTaskIds = repeated.map((t) => t.id);
    const unitWord = repeat.unit === 'week' ? 'weeks' : 'days';
    const speak = repeated.length
      ? `Done. "${seed.title}" is now scheduled ${repeat.count} ${unitWord} in a row.`
      : `"${seed.title}" is already scheduled for those ${unitWord}.`;
    const affected = [seed, ...repeated];
    return finalize(ctx, action, affected, affected.map((t) => t.id), speak, undefined, userId);
  }

  // ---- READ ---------------------------------------------------------------
  if (action.intent === 'READ_TASKS') {
    ctx.pendingDraft = null;
    const tasks = await listTasksByFilter(action.filters, now, userId);
    ctx.lastListedTaskIds = tasks.map((t) => t.id);
    // If the filter returned nothing but the user has pending tasks elsewhere,
    // surface them with times so the reply isn't a misleading "no pending tasks".
    let fallbackTasks: Task[] = [];
    if (!tasks.length && (action.filters?.timeOfDay || action.filters?.date)) {
      fallbackTasks = await listTasksByFilter({ status: 'pending', date: 'all' }, now, userId);
    }
    const speak = summarizeAgenda(tasks, action.filters, fallbackTasks);
    return finalize(ctx, action, tasks, tasks.map((t) => t.id), speak, undefined, userId);
  }

  // ---- UPDATE -------------------------------------------------------------
  if (action.intent === 'UPDATE_TASK') {
    ctx.pendingDraft = null;
    return applyUpdate(action, ctx, now, false, userId);
  }

  // ---- COMPLETE -----------------------------------------------------------
  if (action.intent === 'COMPLETE_TASK') {
    ctx.pendingDraft = null;
    const all = await listAllTasks(userId);
    const { matches, ambiguous } = matchTasks(action.target, all, ctx, now);
    if (!matches.length) {
      return finalize(ctx, action, [], [], "I couldn't find that task.", undefined, userId);
    }
    if (ambiguous) {
      const opts = matches.slice(0, 3).map(describeTaskForVoice);
      return finalize(
        ctx,
        action,
        matches,
        matches.map((t) => t.id),
        `I found a few matches: ${joinList(opts)}. Which one is done?`,
        undefined,
        userId
      );
    }
    const target = matches[0];
    const updated = await updateTask(target.id, { status: 'completed' }, userId);
    ctx.lastUpdatedTaskIds = updated ? [updated.id] : [];
    return finalize(
      ctx,
      action,
      updated ? [updated] : [],
      updated ? [updated.id] : [],
      `Marked ${target.title} as done.`,
      undefined,
      userId
    );
  }

  // ---- DELETE (with confirmation) ----------------------------------------
  if (action.intent === 'DELETE_TASK') {
    ctx.pendingDraft = null;

    // True bulk delete only when scope='all' AND no specific title/hasTime narrowing.
    const t = action.target;
    const isTrueBulk =
      t?.scope === 'all' && !t.searchText?.trim() && !t.hasTime && !t.contextReference;

    if (isTrueBulk) {
      const filters = t!.filters ?? { status: 'pending' };
      const tasks = await listTasksByFilter(filters, now, userId);
      if (!tasks.length) {
        return finalize(
          ctx,
          action,
          [],
          [],
          `You have no ${filterScope(filters) || 'matching'} tasks to delete.`,
          undefined,
          userId
        );
      }
      const scopeText = filterScope(filters) || 'matching';
      const message =
        tasks.length === 1
          ? `That's one ${scopeText} task. Should I delete it?`
          : `That's ${countWord(tasks.length)} ${scopeText} tasks. Should I delete them all?`;
      const pending: PendingConfirmation = {
        type: 'DELETE_TASK',
        taskIds: tasks.map((t) => t.id),
        proposedAction: action,
        message
      };
      ctx.pendingConfirmation = pending;
      ctx.lastListedTaskIds = tasks.map((t) => t.id);
      return finalize(ctx, action, tasks, tasks.map((t) => t.id), message, pending, userId);
    }

    const all = await listAllTasks(userId);
    const { matches, ambiguous } = matchTasks(action.target, all, ctx, now);
    if (!matches.length) {
      return finalize(ctx, action, [], [], "I couldn't find that task to delete.", undefined, userId);
    }
    if (ambiguous) {
      const opts = matches.slice(0, 3).map(describeTaskForVoice);
      ctx.lastListedTaskIds = matches.map((m) => m.id);
      return finalize(
        ctx,
        action,
        matches,
        matches.map((t) => t.id),
        `I found a few matches: ${joinList(opts)}. Which one should I delete?`,
        undefined,
        userId
      );
    }
    const target = matches[0];
    const message = `I found ${describeTaskForVoice(target)}. Should I delete it?`;
    const pending: PendingConfirmation = {
      type: 'DELETE_TASK',
      taskIds: [target.id],
      proposedAction: action,
      message
    };
    ctx.pendingConfirmation = pending;
    return finalize(ctx, action, [target], [target.id], message, pending, userId);
  }

  // ---- UNKNOWN ------------------------------------------------------------
  const fallback =
    action.responseText?.trim() ||
    "I didn't quite catch that. Could you rephrase?";
  return finalize(ctx, action, [], [], fallback, undefined, userId);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function applyUpdate(
  action: AgentAction,
  ctx: ConversationContext,
  now: Date,
  isConfirmed: boolean,
  userId: string
): Promise<AgentCommandResponse> {
  const all = await listAllTasks(userId);
  const { matches, ambiguous } = matchTasks(action.target, all, ctx, now);

  if (!matches.length) {
    return finalize(ctx, action, [], [], "I couldn't find a matching task.", undefined, userId);
  }
  if (ambiguous && !isConfirmed) {
    const opts = matches.slice(0, 3).map(describeTaskForVoice);
    return finalize(
      ctx,
      action,
      matches,
      matches.map((t) => t.id),
      `I found a few matches: ${joinList(opts)}. Which one should I update?`,
      undefined,
      userId
    );
  }

  const target = matches[0];

  // Updates can come either from action.updates or from action.tasks[0].timeExpression.
  const u = action.updates ?? {};
  const fallbackTimeExpr =
    action.tasks?.[0]?.timeExpression ?? action.target?.timeExpression ?? null;
  const timeExpr = u.timeExpression ?? fallbackTimeExpr ?? null;
  const when = timeExpr ? parseNaturalTime(timeExpr, now) : null;

  if (timeExpr && !when) {
    return finalize(
      ctx,
      action,
      [target],
      [target.id],
      `I couldn't figure out the time "${timeExpr}". Can you say it differently?`,
      undefined,
      userId
    );
  }

  if (when && when.getTime() < now.getTime() - 60 * 1000) {
    return finalize(
      ctx,
      action,
      [target],
      [target.id],
      `That time is already in the past. Should I schedule it for the next available slot?`,
      undefined,
      userId
    );
  }

  const patch: Parameters<typeof updateTask>[1] = {};
  if (u.title) patch.title = u.title;
  if (when) {
    patch.scheduledAt = when.toISOString();
    patch.timeLabel = timeExpr;
  }
  if (u.status) patch.status = u.status;
  if (u.priority) patch.priority = u.priority;

  const updated = await updateTask(target.id, patch, userId);
  ctx.lastUpdatedTaskIds = updated ? [updated.id] : [];

  const speak =
    action.responseText?.trim() ||
    (updated
      ? `Done. Updated ${updated.title}${
          updated.scheduledAt
            ? ` to ${new Date(updated.scheduledAt).toLocaleString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                month: 'short',
                day: 'numeric'
              })}`
            : ''
        }.`
      : "I couldn't update that task.");

  return finalize(
    ctx,
    action,
    updated ? [updated] : [],
    updated ? [updated.id] : [],
    speak,
    undefined,
    userId
  );
}

function summarizeCreated(tasks: Task[]): string {
  if (tasks.length === 1) {
    const t = tasks[0];
    return t.scheduledAt
      ? `Done. I created "${t.title}" for ${new Date(t.scheduledAt).toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          month: 'short',
          day: 'numeric'
        })}.`
      : `Done. I created "${t.title}".`;
  }
  return `Done. I created ${tasks.length} tasks: ${joinList(
    tasks.map((t) => t.title)
  )}.`;
}

async function finalize(
  ctx: ConversationContext,
  action: AgentAction,
  tasks: Task[],
  affectedTaskIds: string[],
  responseText: string,
  pending: PendingConfirmation | undefined,
  userId: string
): Promise<AgentCommandResponse> {
  ctx.lastAction = action;
  ctx.lastAssistantResponse = responseText;
  if (pending !== undefined) ctx.pendingConfirmation = pending;
  await saveContext(ctx, userId);
  return {
    responseText,
    action,
    tasks,
    affectedTaskIds,
    pendingConfirmation: ctx.pendingConfirmation
  };
}
