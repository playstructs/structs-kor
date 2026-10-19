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

/** Dev only: `?mock=1` answers from src/api/mock.ts (planned routes 404 as they do today). */
// typeof first: node tests have no import.meta.env; Vite still folds .DEV, so prod drops the mock.
export const MOCK = typeof import.meta.env !== 'undefined' && import.meta.env.DEV && (() => {
  try {
    const q = new URLSearchParams(location.search).get('mock');
    if (q != null) localStorage.setItem('structs-kor.mock', q);
    return localStorage.getItem('structs-kor.mock') === '1';
  } catch { return false; }
})();

/* While signing in, every other guild request waits. A request started before the login finished
 * can come back after it, carrying the old anonymous session's cookie, and overwrite the one the
 * login just set — the next read then says "login required". Sign-in's own calls go through. */
let gate: Promise<unknown> | null = null;
export function holdRequestsUntil<T>(p: Promise<T>): Promise<T> {
  gate = p;
  void p.catch(() => null).then(() => { if (gate === p) gate = null; });
  return p;
}
const BYPASS = 'x-kor-signin';
/* Requests on the wire (not counting sign-in's own), so a login can wait for them to land first. */
let inflight = 0;
let idleFns: (() => void)[] = [];
/** Resolves once no other guild request is in flight (or after `ms`). */
export function quiet(ms = 4000): Promise<void> {
  if (!inflight) return Promise.resolve();
  return new Promise((res) => { const t = setTimeout(res, ms); idleFns.push(() => { clearTimeout(t); res(); }); });
}
/** RequestInit for a call that is part of signing in (not held by the gate). */
export const signinInit = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), [BYPASS]: '1' } });

/** Whether guild calls carry the session cookie. Off once sign-in finds the browser won't keep it
 * (structs.xyz does the same): public routes and signed ones (chat, signup) need no cookie. */
export const net = { cookies: true };

export async function call<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const inSignin = new Headers(init.headers || {}).has(BYPASS);
  if (gate && !inSignin) await gate.catch(() => null);
  if (MOCK) {
    const hit = (await import('./mock')).mock<T>(path, init);
    if (hit) return hit;
    throw new ApiError('아직 없는 API입니다.', 'missing', 404, path);
  }
  const headers = new Headers(init.headers || {});
  headers.delete(BYPASS);
  headers.set('accept', 'application/json');
  if (bearer) headers.set('authorization', 'Bearer ' + bearer);
  let r: Response;
  if (!inSignin) inflight++;
  try {
    r = await fetch(`${endpoints.guildApi}/${path.replace(/^\/+/, '')}`, { ...init, headers, credentials: inSignin || net.cookies ? 'include' : 'omit', redirect: 'error' });
  } catch (e) {
    if (!inSignin && --inflight === 0) { const f = idleFns; idleFns = []; for (const g of f) g(); }
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('길드 서버에 연결할 수 없습니다.', 'network', 0, path);
  }
  if (!inSignin && --inflight === 0) { const f = idleFns; idleFns = []; for (const g of f) g(); }
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
