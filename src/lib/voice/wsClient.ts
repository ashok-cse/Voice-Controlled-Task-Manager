type Pending = { resolve: (data: unknown) => void; reject: (err: Error) => void };

let socket: WebSocket | null = null;
let connectPromise: Promise<void> | null = null;
const pendings = new Map<string, Pending>();

const TOKEN_KEY = 'voicetask.session';

export function getToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function ensureConnection(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;

  connectPromise = new Promise<void>((resolve, reject) => {
    const s = new WebSocket(wsUrl());
    socket = s;

    s.addEventListener('open', () => resolve());
    s.addEventListener('error', () => {
      if (s.readyState !== WebSocket.OPEN) reject(new Error('WebSocket connection failed'));
    });
    s.addEventListener('close', () => {
      socket = null;
      connectPromise = null;
      for (const p of pendings.values()) p.reject(new Error('WebSocket closed'));
      pendings.clear();
    });
    s.addEventListener('message', (e) => {
      let msg: { id?: string; ok?: boolean; data?: unknown; error?: string } | null = null;
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
      } catch {
        return;
      }
      if (!msg?.id) return;
      const p = pendings.get(msg.id);
      if (!p) return;
      pendings.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'Request failed'));
    });
  });

  return connectPromise;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function wsRequest<T = unknown>(type: string, payload?: unknown): Promise<T> {
  await ensureConnection();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket not connected');
  }
  const id = makeId();
  const token = getToken();
  return new Promise<T>((resolve, reject) => {
    pendings.set(id, { resolve: resolve as (d: unknown) => void, reject });
    socket!.send(JSON.stringify({ id, type, token, payload }));
  });
}
