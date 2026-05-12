import { wsRequest, getToken, setToken } from './voice/wsClient';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const res = await wsRequest<AuthResponse>('auth:signup', { email, password });
  setToken(res.token);
  return res.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await wsRequest<AuthResponse>('auth:login', { email, password });
  setToken(res.token);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await wsRequest('auth:logout');
  } catch {
    /* ignore — clear token regardless */
  }
  setToken(null);
}

export async function currentUser(): Promise<AuthUser | null> {
  if (!getToken()) return null;
  try {
    const res = await wsRequest<{ user: AuthUser | null }>('auth:me');
    if (!res.user) setToken(null);
    return res.user;
  } catch {
    return null;
  }
}
