export type TaskStatus = 'pending' | 'completed';
export type TaskPriority = 'low' | 'normal' | 'high';

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  scheduledAt: string | null;
  dueDate?: string | null;
  timeLabel?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export type Intent =
  | 'CREATE_TASK'
  | 'READ_TASKS'
  | 'UPDATE_TASK'
  | 'DELETE_TASK'
  | 'COMPLETE_TASK'
  | 'REPEAT_TASK'
  | 'CONFIRM_ACTION'
  | 'CANCEL_ACTION'
  | 'UNKNOWN';

export interface RepeatSpec {
  count: number;
  unit: 'day' | 'week';
}

export interface ParsedTaskInput {
  title: string;
  scheduledAt?: string | null;
  timeExpression?: string | null;
  priority?: TaskPriority;
}

export interface TaskTarget {
  taskId?: string;
  searchText?: string;
  timeExpression?: string;
  ordinal?: number;
  contextReference?: 'previous' | 'last' | 'that' | 'this' | 'second' | 'first';
  hasTime?: 'yes' | 'no';
  scope?: 'all';
  filters?: TaskFilters;
}

export interface TaskUpdates {
  title?: string;
  scheduledAt?: string | null;
  timeExpression?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
}

export interface TaskFilters {
  date?: 'today' | 'tomorrow' | 'this_week' | 'all';
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  status?: TaskStatus | 'all';
}

export interface AgentAction {
  intent: Intent;
  tasks?: ParsedTaskInput[];
  target?: TaskTarget;
  updates?: TaskUpdates;
  filters?: TaskFilters;
  repeat?: RepeatSpec;
  responseText?: string;
  requiresConfirmation?: boolean;
}

export interface PendingConfirmation {
  type: 'DELETE_TASK' | 'UPDATE_TASK';
  taskIds: string[];
  proposedAction: AgentAction;
  message: string;
}

export interface PendingDraft {
  intent: 'CREATE_TASK';
  title?: string | null;
  timeExpression?: string | null;
  priority?: TaskPriority | null;
}

export interface ConversationContext {
  lastUserTranscript: string | null;
  lastAssistantResponse: string | null;
  lastAction: AgentAction | null;
  lastCreatedTaskIds: string[];
  lastUpdatedTaskIds: string[];
  lastListedTaskIds: string[];
  pendingConfirmation: PendingConfirmation | null;
  pendingDraft: PendingDraft | null;
  recentMessages?: ConversationMessage[];
}

export interface AgentCommandResponse {
  responseText: string;
  action: AgentAction;
  tasks: Task[];
  affectedTaskIds: string[];
  pendingConfirmation: PendingConfirmation | null;
}
