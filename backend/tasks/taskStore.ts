import { DEFAULT_USER_ID, query } from '../db';
import type {
  ConversationContext,
  ConversationMessage,
  PendingConfirmation,
  PendingDraft,
  Task,
  TaskFilters,
  TaskPriority,
  TaskStatus
} from '../types';
import { resolveDateFilter, TIME_OF_DAY_RANGES } from './timeParser';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: Date | null;
  due_date: Date | null;
  time_label: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  created_at: Date;
  updated_at: Date;
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    scheduledAt: r.scheduled_at ? r.scheduled_at.toISOString() : null,
    dueDate: r.due_date ? r.due_date.toISOString().slice(0, 10) : null,
    timeLabel: r.time_label,
    status: r.status,
    priority: r.priority,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString()
  };
}

export async function listAllTasks(userId: string = DEFAULT_USER_ID): Promise<Task[]> {
  const rows = await query<TaskRow>(
    `SELECT * FROM tasks WHERE user_id = $1
     ORDER BY scheduled_at NULLS LAST, created_at ASC`,
    [userId]
  );
  return rows.map(rowToTask);
}

export async function listTasksByFilter(
  filters: TaskFilters | undefined,
  now: Date = new Date(),
  userId: string = DEFAULT_USER_ID
): Promise<Task[]> {
  const clauses: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];

  const status = filters?.status ?? 'pending';
  if (status !== 'all') {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }

  const window = resolveDateFilter(filters?.date, now);
  if (window) {
    params.push(window.start.toISOString());
    clauses.push(`scheduled_at >= $${params.length}`);
    params.push(window.end.toISOString());
    clauses.push(`scheduled_at < $${params.length}`);
  }

  const rows = await query<TaskRow>(
    `SELECT * FROM tasks WHERE ${clauses.join(' AND ')}
     ORDER BY scheduled_at NULLS LAST, created_at ASC`,
    params
  );

  let tasks = rows.map(rowToTask);

  if (filters?.timeOfDay) {
    const range = TIME_OF_DAY_RANGES[filters.timeOfDay];
    if (range) {
      tasks = tasks.filter((t) => {
        if (!t.scheduledAt) return false;
        const d = new Date(t.scheduledAt);
        const minutes = d.getHours() * 60 + d.getMinutes();
        const startMin = range.start.h * 60 + range.start.m;
        const endMin = range.end.h * 60 + range.end.m;
        if (endMin >= 24 * 60) {
          // night wraps past midnight
          return minutes >= startMin || minutes <= endMin - 24 * 60;
        }
        return minutes >= startMin && minutes <= endMin;
      });
    }
  }

  return tasks;
}

export async function createTask(
  data: {
    title: string;
    scheduledAt: string | null;
    timeLabel: string | null;
    priority: TaskPriority;
  },
  userId: string = DEFAULT_USER_ID
): Promise<Task> {
  const rows = await query<TaskRow>(
    `INSERT INTO tasks (user_id, title, scheduled_at, time_label, priority)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, data.title, data.scheduledAt, data.timeLabel, data.priority]
  );
  return rowToTask(rows[0]);
}

export async function updateTask(
  id: string,
  patch: Partial<{
    title: string;
    scheduledAt: string | null;
    timeLabel: string | null;
    status: TaskStatus;
    priority: TaskPriority;
  }>,
  userId: string = DEFAULT_USER_ID
): Promise<Task | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    const col =
      key === 'scheduledAt' ? 'scheduled_at' : key === 'timeLabel' ? 'time_label' : key;
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }

  if (!sets.length) {
    const rows = await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1 AND user_id = $2`, [
      id,
      userId
    ]);
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  params.push(id, userId);
  const rows = await query<TaskRow>(
    `UPDATE tasks SET ${sets.join(', ')}
     WHERE id = $${params.length - 1} AND user_id = $${params.length}
     RETURNING *`,
    params
  );
  return rows[0] ? rowToTask(rows[0]) : null;
}

export async function deleteTask(
  id: string,
  userId: string = DEFAULT_USER_ID
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return rows.length > 0;
}

// ----------------------------------------------------------------------------
// Conversation messages + state
// ----------------------------------------------------------------------------

export async function appendMessage(
  role: 'user' | 'assistant',
  text: string,
  userId: string = DEFAULT_USER_ID
): Promise<ConversationMessage> {
  const rows = await query<{
    id: string;
    role: 'user' | 'assistant';
    text: string;
    created_at: Date;
  }>(
    `INSERT INTO conversation_messages (user_id, role, text)
     VALUES ($1, $2, $3)
     RETURNING id, role, text, created_at`,
    [userId, role, text]
  );
  const r = rows[0];
  return { id: r.id, role: r.role, text: r.text, createdAt: r.created_at.toISOString() };
}

export async function listRecentMessages(
  limit = 20,
  userId: string = DEFAULT_USER_ID
): Promise<ConversationMessage[]> {
  const rows = await query<{
    id: string;
    role: 'user' | 'assistant';
    text: string;
    created_at: Date;
  }>(
    `SELECT id, role, text, created_at FROM conversation_messages
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows
    .map((r) => ({
      id: r.id,
      role: r.role,
      text: r.text,
      createdAt: r.created_at.toISOString()
    }))
    .reverse();
}

interface StateRow {
  last_user_transcript: string | null;
  last_assistant_text: string | null;
  last_action: unknown;
  last_listed_task_ids: string[];
  last_created_task_ids: string[];
  last_updated_task_ids: string[];
  pending_confirmation: unknown;
  pending_draft: unknown;
}

export async function getContext(userId: string = DEFAULT_USER_ID): Promise<ConversationContext> {
  const rows = await query<StateRow>(
    `SELECT last_user_transcript, last_assistant_text, last_action,
            last_listed_task_ids, last_created_task_ids, last_updated_task_ids,
            pending_confirmation, pending_draft
     FROM conversation_state WHERE user_id = $1`,
    [userId]
  );
  const r = rows[0];
  if (!r) {
    return {
      lastUserTranscript: null,
      lastAssistantResponse: null,
      lastAction: null,
      lastListedTaskIds: [],
      lastCreatedTaskIds: [],
      lastUpdatedTaskIds: [],
      pendingConfirmation: null,
      pendingDraft: null
    };
  }
  return {
    lastUserTranscript: r.last_user_transcript,
    lastAssistantResponse: r.last_assistant_text,
    lastAction: (r.last_action as ConversationContext['lastAction']) ?? null,
    lastListedTaskIds: r.last_listed_task_ids ?? [],
    lastCreatedTaskIds: r.last_created_task_ids ?? [],
    lastUpdatedTaskIds: r.last_updated_task_ids ?? [],
    pendingConfirmation: (r.pending_confirmation as PendingConfirmation | null) ?? null,
    pendingDraft: (r.pending_draft as PendingDraft | null) ?? null
  };
}

export async function saveContext(
  ctx: ConversationContext,
  userId: string = DEFAULT_USER_ID
): Promise<void> {
  await query(
    `INSERT INTO conversation_state (
        user_id, last_user_transcript, last_assistant_text, last_action,
        last_listed_task_ids, last_created_task_ids, last_updated_task_ids,
        pending_confirmation, pending_draft, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (user_id) DO UPDATE SET
        last_user_transcript = EXCLUDED.last_user_transcript,
        last_assistant_text = EXCLUDED.last_assistant_text,
        last_action = EXCLUDED.last_action,
        last_listed_task_ids = EXCLUDED.last_listed_task_ids,
        last_created_task_ids = EXCLUDED.last_created_task_ids,
        last_updated_task_ids = EXCLUDED.last_updated_task_ids,
        pending_confirmation = EXCLUDED.pending_confirmation,
        pending_draft = EXCLUDED.pending_draft,
        updated_at = now()`,
    [
      userId,
      ctx.lastUserTranscript,
      ctx.lastAssistantResponse,
      ctx.lastAction ? JSON.stringify(ctx.lastAction) : null,
      ctx.lastListedTaskIds,
      ctx.lastCreatedTaskIds,
      ctx.lastUpdatedTaskIds,
      ctx.pendingConfirmation ? JSON.stringify(ctx.pendingConfirmation) : null,
      ctx.pendingDraft ? JSON.stringify(ctx.pendingDraft) : null
    ]
  );
}

export async function findDuplicateTask(
  title: string,
  scheduledAt: string | null,
  userId: string = DEFAULT_USER_ID
): Promise<Task | null> {
  const trimmed = title.trim().toLowerCase();
  if (!trimmed) return null;

  if (scheduledAt) {
    const t = new Date(scheduledAt);
    const start = new Date(t.getTime() - 5 * 60 * 1000).toISOString();
    const end = new Date(t.getTime() + 5 * 60 * 1000).toISOString();
    const rows = await query<TaskRow>(
      `SELECT * FROM tasks
       WHERE user_id = $1 AND status = 'pending'
         AND lower(title) = $2
         AND scheduled_at BETWEEN $3 AND $4
       ORDER BY created_at DESC LIMIT 1`,
      [userId, trimmed, start, end]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  const rows = await query<TaskRow>(
    `SELECT * FROM tasks
     WHERE user_id = $1 AND status = 'pending'
       AND lower(title) = $2
       AND scheduled_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId, trimmed]
  );
  return rows[0] ? rowToTask(rows[0]) : null;
}

export async function getTasksByIds(
  ids: string[],
  userId: string = DEFAULT_USER_ID
): Promise<Task[]> {
  if (!ids.length) return [];
  const rows = await query<TaskRow>(
    `SELECT * FROM tasks WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, ids]
  );
  return rows.map(rowToTask);
}
