import { groq, MODELS } from './groq';
import { parseIntent } from './agent/parseIntent';
import { executeAction } from './tasks/taskEngine';
import {
  appendMessage,
  getContext,
  listAllTasks,
  listRecentMessages,
  saveContext
} from './tasks/taskStore';
import { login, logout, resolveSession, signup, type AuthUser } from './auth';

interface WsRequest {
  id?: string;
  type: string;
  token?: string;
  payload?: Record<string, unknown>;
}

const PUBLIC_TYPES = new Set(['auth:signup', 'auth:login', 'auth:me']);

async function requireUser(msg: WsRequest): Promise<AuthUser> {
  const user = await resolveSession(msg.token);
  if (!user) throw new Error('Not authenticated');
  return user;
}

export async function handle(msg: WsRequest): Promise<unknown> {
  // ---- Auth -------------------------------------------------------------
  if (msg.type === 'auth:signup') {
    const email = (msg.payload?.email as string) ?? '';
    const password = (msg.payload?.password as string) ?? '';
    return await signup(email, password);
  }

  if (msg.type === 'auth:login') {
    const email = (msg.payload?.email as string) ?? '';
    const password = (msg.payload?.password as string) ?? '';
    return await login(email, password);
  }

  if (msg.type === 'auth:logout') {
    if (msg.token) await logout(msg.token);
    return { ok: true };
  }

  if (msg.type === 'auth:me') {
    const user = await resolveSession(msg.token);
    return { user };
  }

  // ---- Everything else requires a session -------------------------------
  if (!PUBLIC_TYPES.has(msg.type)) {
    // Will throw 'Not authenticated' if invalid/missing.
  }
  const user = await requireUser(msg);
  const userId = user.id;

  switch (msg.type) {
    case 'tasks:list': {
      const [tasks, messages] = await Promise.all([
        listAllTasks(userId),
        listRecentMessages(30, userId)
      ]);
      return { tasks, messages };
    }

    case 'agent:command': {
      const transcript = ((msg.payload?.transcript as string) ?? '').trim();
      if (!transcript) throw new Error('Empty transcript');

      const ctx = await getContext(userId);
      ctx.lastUserTranscript = transcript;
      await saveContext(ctx, userId);

      await appendMessage('user', transcript, userId);
      ctx.recentMessages = await listRecentMessages(10, userId);

      const now = new Date();
      let action;
      try {
        action = await parseIntent(transcript, ctx, now.toISOString());
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'parseIntent failed';
        console.error('[agent] parseIntent failed:', errMsg);
        await appendMessage(
          'assistant',
          'I am having trouble understanding that right now. Please try again in a simpler sentence.',
          userId
        );
        return {
          responseText:
            'I am having trouble understanding that right now. Please try again in a simpler sentence.',
          action: { intent: 'UNKNOWN' },
          tasks: await listAllTasks(userId),
          affectedTaskIds: [],
          pendingConfirmation: null
        };
      }

      const result = await executeAction(action, now, userId);
      await appendMessage('assistant', result.responseText, userId);
      const allTasks = await listAllTasks(userId);
      return { ...result, tasks: allTasks };
    }

    case 'stt': {
      const base64 = msg.payload?.audio as string | undefined;
      const mime = (msg.payload?.mime as string) ?? 'audio/webm';
      if (!base64) throw new Error('audio required');
      const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';
      const buf = Buffer.from(base64, 'base64');
      const file = new File([buf], `voice.${ext}`, { type: mime });
      const transcription = await groq.audio.transcriptions.create({
        file,
        model: MODELS.stt,
        response_format: 'json',
        language: 'en',
        temperature: 0
      });
      return { transcript: transcription.text ?? '' };
    }

    case 'tts': {
      const text = ((msg.payload?.text as string) ?? '').trim();
      if (!text) throw new Error('text required');
      const speech = await groq.audio.speech.create({
        model: MODELS.tts,
        voice: (msg.payload?.voice as string) ?? MODELS.ttsVoice,
        input: text,
        response_format: 'wav'
      });
      const arrayBuffer = await speech.arrayBuffer();
      const audio = Buffer.from(arrayBuffer).toString('base64');
      return { audio, mime: 'audio/wav' };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
