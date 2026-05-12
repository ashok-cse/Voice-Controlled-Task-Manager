import { groq, MODELS } from '../groq';
import { AGENT_SYSTEM_PROMPT } from './agentPrompt';
import type { AgentAction, ConversationContext } from '../types';

function buildContextHint(ctx: ConversationContext): string {
  const lines: string[] = [];
  if (ctx.lastListedTaskIds.length) {
    lines.push(`Last listed task IDs (in order): ${ctx.lastListedTaskIds.join(', ')}`);
  }
  if (ctx.lastCreatedTaskIds.length) {
    lines.push(`Last created task IDs: ${ctx.lastCreatedTaskIds.join(', ')}`);
  }
  if (ctx.lastUpdatedTaskIds.length) {
    lines.push(`Last updated task IDs: ${ctx.lastUpdatedTaskIds.join(', ')}`);
  }
  if (ctx.pendingConfirmation) {
    lines.push(
      `Pending confirmation: ${ctx.pendingConfirmation.type} on tasks ${ctx.pendingConfirmation.taskIds.join(', ')}. ` +
        `Message: "${ctx.pendingConfirmation.message}". ` +
        `If user says yes/sure/ok, return CONFIRM_ACTION. If no/cancel, return CANCEL_ACTION.`
    );
  }
  if (ctx.pendingDraft) {
    lines.push(
      `Pending draft (incomplete CREATE_TASK from earlier turns): ` +
        `title=${JSON.stringify(ctx.pendingDraft.title ?? null)}, ` +
        `timeExpression=${JSON.stringify(ctx.pendingDraft.timeExpression ?? null)}, ` +
        `priority=${JSON.stringify(ctx.pendingDraft.priority ?? null)}. ` +
        `The user's next message most likely fills the missing field — merge it in and return a CREATE_TASK with both title and timeExpression.`
    );
  }
  return lines.length ? `Conversation context:\n${lines.join('\n')}` : 'No prior context.';
}

function safeJsonParse(raw: string): AgentAction | null {
  // Strip code fences if the model added them despite instructions.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as AgentAction;
  } catch {
    // Try to extract the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as AgentAction;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function parseIntent(
  transcript: string,
  context: ConversationContext,
  nowIso: string
): Promise<AgentAction> {
  const history = (context.recentMessages ?? []).slice(-8).map((m) => ({
    role: m.role,
    content: m.text
  }));

  const userPrompt = [
    `Current time (ISO): ${nowIso}`,
    buildContextHint(context),
    `User said: "${transcript}"`
  ].join('\n\n');

  const completion = await groq.chat.completions.create({
    model: MODELS.llm,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userPrompt }
    ]
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const parsed = safeJsonParse(raw);

  if (!parsed || !parsed.intent) {
    return {
      intent: 'UNKNOWN',
      responseText: "I didn't quite catch that. Could you say it again?"
    };
  }

  // Safety: force confirmation flag on deletes.
  if (parsed.intent === 'DELETE_TASK') {
    parsed.requiresConfirmation = true;
  }

  return parsed;
}
