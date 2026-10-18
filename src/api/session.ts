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
import { ApiError, MOCK, call, onAuthLost, setBearer } from './http';
import { fellBack, isMissing, markMissing } from './requirements';

export type SessionState = 'out' | 'signing' | 'in' | 'failed';
interface Status { state: SessionState; playerId: string | null; why: string }

const TOKEN_KEY = 'structs-kor.token';
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
      const t = sessionStorage.getItem(TOKEN_KEY);
      if (t) setBearer(t);
    } catch { /* storage refused */ }
    try { await guildApi.block(); set({ state: 'in', playerId: pid, why: '' }); } catch { setBearer(null); }
  },

  /** Sign in as the commander. The wallet must be unlocked. */
  async signIn(): Promise<void> {
    set({ state: 'signing', why: '' });
    try {
      const k = wallet.key(0);
      let pid = wallet.commander?.playerId ?? null;
      if (!pid) {
        pid = await guildApi.playerIdFor(k.address, GUILD_ID);
        if (!pid) throw new Error('이 길드에 등록된 사령관이 아닙니다. 먼저 입대하세요.');
        wallet.setPlayerId(0, pid);
      }
      const ts = (await guildApi.timestamp()).unix_timestamp;
      const s = wallet.signMessage(0, `LOGIN_GUILD${GUILD_ID}ADDRESS${k.address}DATETIME${ts}`);
      const body = { address: k.address, signature: s.signature, pubkey: s.pubkey, guild_id: GUILD_ID, unix_timestamp: ts };
      let token: string | null = null;
      if (!isMissing('REQ-AUTH-1')) {
        try { token = (await call<{ access_token: string }>('auth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).data.access_token; }
        catch (e) { if (e instanceof ApiError && e.code === 'missing') markMissing('REQ-AUTH-1'); else throw e; }
      }
      if (token) {
        setBearer(token);
        try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* fine */ }
      } else {
        fellBack('REQ-AUTH-1');
        await guildApi.login(body);
      }
      // The cookie must actually have stuck (a browser blocking third-party cookies drops it).
      await guildApi.block().catch(() => { throw new Error('브라우저가 길드 로그인 쿠키를 저장하지 않았습니다 (서드파티 쿠키 차단).'); });
      set({ state: 'in', playerId: pid, why: '' });
    } catch (e) {
      set({ state: 'failed', why: (e as Error).message });
      throw e;
    }
  },

  async signOut() {
    await guildApi.logout().catch(() => null);
    setBearer(null);
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* fine */ }
    set({ state: 'out', playerId: null, why: '' });
  },
};

onAuthLost(() => { if (status.state === 'in') set({ state: 'out', why: '세션이 만료되었습니다.' }); });

/** Dev mock only: `?as=1-7` signs this tab in as another fixture commander, so two tabs can be two
 * players (a live duel over the mock homeserver, which relays between tabs). Kept per tab. */
function mockAs(): string | null {
  try {
    const q = new URLSearchParams(location.search).get('as');
    if (q && /^1-\d{1,9}$/.test(q)) sessionStorage.setItem('structs-kor.mock.as', q);
    return sessionStorage.getItem('structs-kor.mock.as');
  } catch { return null; }
}
