/* The Guild API session. Nearly every Guild API read is members-only, so the site signs in as the
 * commander: the wallet signs LOGIN_GUILD{g}ADDRESS{addr}DATETIME{ts} (ts from /api/timestamp,
 * valid 600 s).
 *
 *   1. REQ-AUTH-1: POST /auth/token → a bearer token. Works cross-site with no cookies, which is
 *      what a static site on 구조체.com calling beta.playstructs.com needs (Safari/Firefox block
 *      third-party cookies).
 *   2. Today: POST /auth/login sets a PHP session cookie. Fine through the dev relay (same-origin);
 *      in production it depends on the browser keeping a third-party cookie. */
import { GUILD_ID } from '../config';
import { wallet } from '../wallet/wallet';
import { guildApi } from './guild';
import { ApiError, MOCK, call, onAuthLost, setBearer, holdRequestsUntil, signinInit, quiet } from './http';

const login = (body: Record<string, unknown>) => call<null>('auth/login', signinInit({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
import { fellBack, isMissing, markMissing } from './requirements';

export type SessionState = 'out' | 'signing' | 'in' | 'failed';
interface Status { state: SessionState; playerId: string | null; why: string }

const TOKEN_KEY = 'structs-kor.token';

/** The guild accepted the login but the browser will not send its cookie back (cross-site tracking
 * protection: Safari and iOS by default, Firefox strict, Brave). Nothing in this page can fix that;
 * the player can, in their browser's settings, or the guild can, with token login (REQ-AUTH-1). */
export class CookieBlockedError extends Error {
  constructor() { super('이 브라우저가 길드 로그인 쿠키를 보내지 않습니다 (크로스 사이트 추적 방지).'); this.name = 'CookieBlockedError'; }
}
/** How to let the guild's cookie through, for this device. */
export function cookieHelp(): string[] {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  if (ios) return [
    'iPhone · iPad: 설정 › 앱 › Safari › 개인정보 보호 및 보안 › 「크로스 사이트 추적 방지」를 끄고 다시 시도하세요. (iOS 17 이하는 설정 › Safari)',
    '다른 앱(Notion, 카카오톡 등) 안에서 열었다면 Safari에서 직접 여세요.',
  ];
  if (/Firefox\//.test(ua)) return ['Firefox: 주소창의 방패 아이콘 › 이 사이트의 「향상된 추적 방지」를 끄고 다시 시도하세요.'];
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return ['Safari: 설정 › 개인정보 보호 › 「크로스 사이트 추적 방지」를 끄고 다시 시도하세요.'];
  return ['브라우저 설정에서 이 사이트의 서드파티 쿠키를 허용하고 다시 시도하세요.', 'PC의 Chrome이나 Edge, 또는 구조체 데스크톱 앱에서는 바로 됩니다.'];
}

/** Is the guild actually treating us as signed in, as this player? (A members-only read, sent
 * past the sign-in gate.) */
async function signedInAs(pid: string): Promise<boolean> {
  try { await call(`player/${encodeURIComponent(pid)}`, signinInit()); return true; } catch (e) { if (e instanceof ApiError && e.code === 'auth') return false; throw e; }
}
const fns = new Set<(s: Status) => void>();
let status: Status = { state: 'out', playerId: null, why: '' };
const set = (p: Partial<Status>) => { status = { ...status, ...p }; for (const f of fns) f(status); };

export const session = {
  get status() { return status; },
  get playerId() { return status.playerId; },
  onChange(f: (s: Status) => void) { fns.add(f); f(status); return () => fns.delete(f); },

  /** Resume a session this browser already holds (token or cookie). */
  async resume() {
    // Dev mock: signed in as this browser's commander if it enlisted against the mock, else the fixture.
    if (MOCK) { set({ state: 'in', playerId: mockAs() ?? wallet.commander?.playerId ?? '1-42', why: '' }); return; }
    const pid = wallet.commander?.playerId;
    if (!pid) return;
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) setBearer(t);
    } catch { /* storage refused */ }
    try { if (await signedInAs(pid)) { set({ state: 'in', playerId: pid, why: '' }); return; } setBearer(null); } catch { setBearer(null); }
    // No live session (an expired token, or Safari never kept the cookie): this device holds the
    // commander's key, so sign in again without asking. It's a signature, not a transaction.
    if (wallet.state === 'unlocked') await this.signIn().catch(() => null);
  },

  /** Sign in as the commander. The wallet must be unlocked. Other guild requests wait until it's done. */
  signIn(): Promise<void> { return holdRequestsUntil(this.doSignIn()); },
  async doSignIn(): Promise<void> {
    set({ state: 'signing', why: '' });
    try {
      const k = wallet.key(0);
      let pid = wallet.commander?.playerId ?? null;
      if (!pid) {
        pid = await call<{ player_id: string } | null>(`auth/player-address/${encodeURIComponent(k.address)}/guild/${encodeURIComponent(GUILD_ID)}/player-id`, signinInit()).then((r) => r.data?.player_id ?? null);
        if (!pid) throw new Error('이 길드에 등록된 사령관이 아닙니다. 먼저 입대하세요.');
        wallet.setPlayerId(0, pid);
      }
      // Let anything already on the wire land first: its response must not replace the login's cookie.
      await quiet();
      const ts = (await call<{ unix_timestamp: number }>('timestamp', signinInit())).data.unix_timestamp;
      const s = wallet.signMessage(0, `LOGIN_GUILD${GUILD_ID}ADDRESS${k.address}DATETIME${ts}`);
      const body = { address: k.address, signature: s.signature, pubkey: s.pubkey, guild_id: GUILD_ID, unix_timestamp: ts };
      let token: string | null = null;
      if (!isMissing('REQ-AUTH-1')) {
        try { token = (await call<{ access_token: string }>('auth/token', signinInit({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))).data.access_token; }
        catch (e) { if (e instanceof ApiError && e.code === 'missing') markMissing('REQ-AUTH-1'); else throw e; }
      }
      if (token) {
        setBearer(token);
        try { localStorage.setItem(TOKEN_KEY, token); } catch { /* fine */ }
      } else {
        fellBack('REQ-AUTH-1');
        await login(body);
      }
      // The session must actually hold, on a members-only read. A late response can have replaced the
      // cookie, and just after enlisting the guild may not have indexed the player yet: a few tries
      // (and one more login) before blaming the browser.
      let ok = false;
      for (let i = 0; i < 4 && !ok; i++) {
        if (i) await new Promise((r) => setTimeout(r, 2500));
        ok = await signedInAs(pid);
        if (!ok && i === 1 && !token) await login(body).catch(() => null);
      }
      if (!ok) throw token ? new Error('길드가 로그인 토큰을 받아들이지 않습니다. 다시 시도하세요.') : new CookieBlockedError();
      set({ state: 'in', playerId: pid, why: '' });
    } catch (e) {
      set({ state: 'failed', why: (e as Error).message });
      throw e;
    }
  },

  async signOut() {
    await guildApi.logout().catch(() => null);
    setBearer(null);
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* fine */ }
    set({ state: 'out', playerId: null, why: '' });
  },
};

/* A "login required" moments after signing in is the race above (a late response replaced the
 * cookie), not an expired session: sign in once more on our own. Later, or a second time, it's real. */
let signedAt = 0, healedAt = 0;
fns.add((s) => { if (s.state === 'in') { if (!signedAt) signedAt = Date.now(); } else signedAt = 0; });
onAuthLost(() => {
  if (status.state !== 'in') return;
  // At most once every two minutes: a heal that ends in another "login required" is the real thing.
  if (signedAt && Date.now() - signedAt < 60_000 && Date.now() - healedAt > 120_000 && wallet.state === 'unlocked') {
    healedAt = Date.now();
    void session.signIn().catch(() => set({ state: 'out', why: '세션이 만료되었습니다.' }));
    return;
  }
  set({ state: 'out', why: '세션이 만료되었습니다.' });
});

/** Dev mock only: `?as=1-7` signs this tab in as another fixture commander, so two tabs can be two
 * players (a live duel over the mock homeserver, which relays between tabs). Kept per tab. */
function mockAs(): string | null {
  try {
    const q = new URLSearchParams(location.search).get('as');
    if (q && /^1-\d{1,9}$/.test(q)) sessionStorage.setItem('structs-kor.mock.as', q);
    return sessionStorage.getItem('structs-kor.mock.as');
  } catch { return null; }
}
