/* One round trip to the Guild API, envelope and all: `{ success, errors, data }`.
 * Cookies always ride along (the guild's sign-in is a session cookie). In relay mode that is a
 * same-origin cookie on localhost; in direct mode the guild must answer this origin with
 * Access-Control-Allow-Credentials (REQ-AUTH-1 asks for a token instead). */
import { endpoints } from '../config';

export interface Envelope<T> { success: boolean; errors: Record<string, string> | unknown[]; data: T; total?: number; meta?: Record<string, unknown> }

export type ApiErrorCode = 'auth' | 'missing' | 'http' | 'server' | 'network';
export class ApiError extends Error {
  constructor(message: string, readonly code: ApiErrorCode, readonly status = 0, readonly path = '') { super(message); this.name = 'ApiError'; }
}

type Q = Record<string, string | number | boolean | undefined | null>;
export function qs(q?: Q): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== '') p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  const s = p.toString();
  return s ? '?' + s : '';
}

let bearer: string | null = null;
/** REQ-AUTH-1: once the guild issues tokens, the session stores one here and cookies stop mattering. */
export function setBearer(t: string | null) { bearer = t; }

const authFns = new Set<() => void>();
export function onAuthLost(f: () => void) { authFns.add(f); return () => authFns.delete(f); }

export async function call<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const headers = new Headers(init.headers || {});
  headers.set('accept', 'application/json');
  if (bearer) headers.set('authorization', 'Bearer ' + bearer);
  let r: Response;
  try {
    r = await fetch(`${endpoints.guildApi}/${path.replace(/^\/+/, '')}`, { ...init, headers, credentials: 'include', redirect: 'error' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('길드 서버에 연결할 수 없습니다.', 'network', 0, path);
  }
  const body = (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => null) as Envelope<T> | null : null;
  const authErr = body && !Array.isArray(body.errors) && body.errors && 'authentication_error' in body.errors;
  if (r.status === 401 || authErr) { for (const f of authFns) f(); throw new ApiError('로그인이 필요합니다.', 'auth', 401, path); }
  // The Guild API answers "not found" rows as 200 + data:null, so a 404/405 means the route itself is missing.
  if (r.status === 404 || r.status === 405 || r.status === 501) throw new ApiError('아직 없는 API입니다.', 'missing', r.status, path);
  if (!body) throw new ApiError(`길드 API ${r.status}`, r.status >= 500 ? 'server' : 'http', r.status, path);
  if (!r.ok || !body.success) {
    const e = body.errors && !Array.isArray(body.errors) ? Object.values(body.errors).join('; ') : '';
    throw new ApiError(e || `길드 API ${r.status}`, r.status >= 500 ? 'server' : 'http', r.status, path);
  }
  return body;
}

export const get = <T>(path: string, q?: Q) => call<T>(path + qs(q)).then((b) => b.data);
export const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((b) => b.data);

/* A small stale-while-revalidate cache, per tab. Keys are paths. */
const memo = new Map<string, { at: number; v: Promise<unknown> }>();
export function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v as Promise<T>;
  const v = load();
  memo.set(key, { at: Date.now(), v });
  v.catch(() => memo.delete(key));
  return v;
}
export function invalidate(prefix = '') { for (const k of memo.keys()) if (k.startsWith(prefix)) memo.delete(k); }
